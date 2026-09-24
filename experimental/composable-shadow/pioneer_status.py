#!/usr/bin/env python3
"""Observe existing Pioneer-X ESP32 micro-ROS state; never start or command it.

The public firmware publishes wheel ticks and estimated pose from its normal
loop. This reader subscribes only. ROS endpoint names and source checkout are
not authenticated physical-device identity; an owner must confirm hardware.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from uuid import uuid4

from collect import CollectionError, utc_now, write_output
from controller_state import canonical
from source_checkout import inspect_checkout

WHEEL_TOPIC = '/wheel_ticks'
POSE_TOPIC = '/posicion_estimada'
WHEEL_TYPE = 'std_msgs/msg/Int32MultiArray'
POSE_TYPE = 'geometry_msgs/msg/Point'
ESP32_NODE = '/robot_esp32_node'
REFERENCE_REPOSITORY = 'https://github.com/DaneelOlivawXJose/pioneer-ros2-diff-drive'
REFERENCE_COMMIT = '39f67a0697f8b28669c26edfe5ca2124348756d7'


def _endpoint(reader, topic, message_type):
    rows = reader.publishers(topic)
    if len(rows) != 1 or rows[0].get('type') != message_type or rows[0].get('node') != ESP32_NODE:
        raise CollectionError('pioneer_esp32_publisher_missing_or_ambiguous:' + topic + ':' + json.dumps(rows))
    gid = rows[0].get('gid')
    if not isinstance(gid, str) or len(gid) not in (32, 48):
        raise CollectionError('pioneer_publisher_gid_unavailable:' + topic)
    try:
        if not any(bytes.fromhex(gid)):
            raise CollectionError('pioneer_publisher_gid_unavailable:' + topic)
    except ValueError as error:
        raise CollectionError('pioneer_publisher_gid_invalid:' + topic) from error
    return rows[0]


def _wheel_sample(message):
    values = list(message.data)
    if len(values) != 2 or any(type(value) is not int or not -2**31 <= value < 2**31 for value in values):
        raise CollectionError('pioneer_invalid_wheel_ticks')
    return {'left': values[0], 'right': values[1]}


def _pose_sample(message):
    values = (message.x, message.y, message.z)
    if any(type(value) not in (float, int) or not math.isfinite(value) for value in values):
        raise CollectionError('pioneer_invalid_estimated_pose')
    return {'x': repr(float(values[0])), 'y': repr(float(values[1])), 'theta': repr(float(values[2]))}


def build_observation(reader, checkout):
    wheel_endpoint = _endpoint(reader, WHEEL_TOPIC, WHEEL_TYPE)
    pose_endpoint = _endpoint(reader, POSE_TOPIC, POSE_TYPE)
    wheel, wheel_gid, wheel_time = reader.once(WHEEL_TOPIC, WHEEL_TYPE)
    pose, pose_gid, pose_time = reader.once(POSE_TOPIC, POSE_TYPE)
    if wheel_gid != wheel_endpoint['gid'] or pose_gid != pose_endpoint['gid']:
        raise CollectionError('pioneer_sample_publisher_mismatch')
    if pose_time - wheel_time > 5_000_000_000 or pose_time < wheel_time:
        raise CollectionError('pioneer_samples_not_close_in_time')
    ticks, estimate = _wheel_sample(wheel), _pose_sample(pose)
    if (_endpoint(reader, WHEEL_TOPIC, WHEEL_TYPE) != wheel_endpoint or
            _endpoint(reader, POSE_TOPIC, POSE_TYPE) != pose_endpoint):
        raise CollectionError('pioneer_publisher_changed_during_capture')
    observation = {
        'schemaVersion': 1, 'kind': 'RlsokPioneerXEsp32Status', 'observedAt': utc_now(),
        'hardwareDispatch': False,
        'source': {'referenceRepository': REFERENCE_REPOSITORY,
                   'referenceCommit': REFERENCE_COMMIT,
                   'operatorSelectedCheckout': checkout,
                   'environment': reader.environment(),
                   'publishers': {'wheelTicks': wheel_endpoint, 'estimatedPose': pose_endpoint}},
        'wheelTicks': ticks, 'estimatedPose': estimate,
        'limits': {
            'proves': 'two state messages were observed on the selected ROS graph within five seconds',
            'doesNotProve': ['physical chassis identity', 'ESP32 or firmware identity',
                             'sensor accuracy', 'active tracker settings', 'motor command path',
                             'safe motion', 'owner acceptance'],
        },
    }
    observation['observationSha256'] = hashlib.sha256(canonical(observation).encode()).hexdigest()
    return observation


class Reader:
    def __enter__(self):
        import os
        import rclpy
        from rclpy.context import Context
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.utilities import get_rmw_implementation_identifier
        from rosidl_runtime_py.utilities import get_message
        self.os, self.rmw, self.get_message = os, get_rmw_implementation_identifier, get_message
        self.context = Context()
        rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node('rlsok_pioneer_status_' + uuid4().hex, context=self.context,
                enable_rosout=False, start_parameter_services=False, use_global_arguments=False)
            self.executor = SingleThreadedExecutor(context=self.context)
            self.executor.add_node(self.node)
        except Exception:
            self.context.shutdown()
            raise
        return self

    def __exit__(self, *_):
        try:
            self.executor.shutdown(timeout_sec=5)
            self.node.destroy_node()
        finally:
            self.context.shutdown()

    def environment(self):
        distro, domain = self.os.environ.get('ROS_DISTRO'), self.os.environ.get('ROS_DOMAIN_ID', '0')
        if not distro or not domain.isdigit() or not 0 <= int(domain) <= 232:
            raise CollectionError('pioneer_invalid_ros_environment')
        return {'rosDistro': distro, 'rmwImplementation': self.rmw(), 'domainId': int(domain)}

    def publishers(self, topic):
        deadline, pending = time.monotonic() + 15, []
        while time.monotonic() < deadline:
            rows = self.node.get_publishers_info_by_topic(topic)
            if rows:
                if len(rows) > 32:
                    raise CollectionError('pioneer_too_many_publishers:' + topic)
                pending = sorted([{'node': row.node_namespace.rstrip('/') + '/' + row.node_name,
                    'type': row.topic_type, 'gid': bytes(row.endpoint_gid).hex()} for row in rows],
                    key=lambda item: (item['node'], item['gid']))
                if all('_NODE_NAME_UNKNOWN_' not in item['node'] and
                       '_NODE_NAMESPACE_UNKNOWN_' not in item['node'] for item in pending):
                    return pending
            self.executor.spin_once(timeout_sec=0.1)
        return pending

    def once(self, topic, message_type):
        from rclpy.qos import QoSProfile, DurabilityPolicy, ReliabilityPolicy
        qos = QoSProfile(depth=1, durability=DurabilityPolicy.VOLATILE,
                         reliability=ReliabilityPolicy.BEST_EFFORT)
        received, deadline = [], time.monotonic() + 15

        def callback(message, info):
            if received:
                return
            raw = getattr(info, 'publisher_gid', None)
            raw = raw.get('data') if isinstance(raw, dict) else getattr(raw, 'data', raw)
            if not isinstance(raw, (bytes, bytearray)) or len(raw) not in (16, 24):
                raise CollectionError('pioneer_message_publisher_gid_unavailable')
            received.append((message, bytes(raw).hex(), time.monotonic_ns()))

        subscription = self.node.create_subscription(self.get_message(message_type), topic, callback, qos)
        try:
            while not received and time.monotonic() < deadline:
                self.executor.spin_once(timeout_sec=0.1)
            if not received:
                raise CollectionError('pioneer_sample_timeout:' + topic)
            return received[0]
        finally:
            self.node.destroy_subscription(subscription)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise CollectionError('output_already_exists')
        checkout = inspect_checkout(args.source_root)
        with Reader() as reader:
            observation = build_observation(reader, checkout)
        write_output(args.output, observation)
        print('OBSERVED | Pioneer-X ESP32 ROS state read only | hardware dispatch: NO')
        return 0
    except Exception as error:
        print(f'pioneer_status_capture_failed:{type(error).__name__}:{error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
