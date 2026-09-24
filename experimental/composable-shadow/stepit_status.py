#!/usr/bin/env python3
"""Observe an already-running StepIt ROS graph without opening serial or dispatching commands.

The public sample robot defaults to use_dummy=true. A joint-state message alone
is therefore never accepted as evidence of the real-hardware path.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from uuid import uuid4

from collect import CollectionError, utc_now, write_output
from controller_state import canonical
from source_checkout import inspect_checkout

JOINT_TOPIC = '/joint_states'
DESCRIPTION_TOPIC = '/robot_description'
JOINT_TYPE = 'sensor_msgs/msg/JointState'
DESCRIPTION_TYPE = 'std_msgs/msg/String'
JOINT_NODE = '/joint_state_broadcaster'
DESCRIPTION_NODE = '/robot_state_publisher'


def _publisher(reader, topic, expected_type, expected_node):
    rows = reader.publishers(topic)
    if len(rows) != 1 or rows[0].get('type') != expected_type or rows[0].get('node') != expected_node:
        raise CollectionError('stepit_publisher_missing_or_ambiguous:' + topic + ':' + json.dumps(rows))
    gid = rows[0].get('gid')
    if not isinstance(gid, str) or len(gid) not in (32, 48) or not any(bytes.fromhex(gid)):
        raise CollectionError('stepit_publisher_gid_unavailable:' + topic)
    return rows[0]


def _description(message):
    try:
        root = ET.fromstring(message.data)
    except (TypeError, ValueError, ET.ParseError) as error:
        raise CollectionError('stepit_invalid_live_robot_description') from error
    if root.tag != 'robot' or root.get('name') != 'stepit':
        raise CollectionError('stepit_unexpected_robot_description')
    systems = root.findall('./ros2_control')
    if len(systems) != 1 or systems[0].get('type') != 'system':
        raise CollectionError('stepit_hardware_system_missing_or_ambiguous')
    hardware = systems[0].find('./hardware')
    if hardware is None or hardware.findtext('./plugin') != 'stepit_driver/StepitHardware':
        raise CollectionError('stepit_hardware_plugin_mismatch')
    params = hardware.findall('./param')
    values = {}
    for param in params:
        key = param.get('name')
        if not key or key in values:
            raise CollectionError('stepit_invalid_hardware_parameters')
        values[key] = (param.text or '').strip()
    # A fake StepIt driver can publish perfectly plausible joint states.
    if values.get('use_dummy', '').lower() != 'false':
        raise CollectionError('stepit_dummy_or_unverified_hardware_mode')
    joints = systems[0].findall('./joint')
    if not joints or len(joints) > 32:
        raise CollectionError('stepit_invalid_joint_count')
    mapping = {}
    for joint in joints:
        name = joint.get('name')
        ids = [p.text for p in joint.findall('./param') if p.get('name') == 'id']
        if not name or name in mapping or len(ids) != 1 or not ids[0] or not ids[0].strip().isdigit():
            raise CollectionError('stepit_invalid_joint_id_mapping')
        motor_id = int(ids[0].strip())
        if motor_id in mapping.values():
            raise CollectionError('stepit_duplicate_motor_id')
        mapping[name] = motor_id
    if set(mapping.values()) != set(range(len(mapping))):
        raise CollectionError('stepit_motor_ids_not_contiguous')
    return {'robotName': 'stepit', 'hardwarePlugin': 'stepit_driver/StepitHardware',
            'declaredMode': 'real', 'jointToMotorId': mapping,
            'robotDescriptionSha256': hashlib.sha256(message.data.encode()).hexdigest()}


def _joint_sample(message, expected):
    names = list(message.name)
    if len(names) != len(expected) or set(names) != set(expected) or len(names) != len(set(names)):
        raise CollectionError('stepit_joint_names_not_exact')
    positions, velocities = list(message.position), list(message.velocity)
    if len(positions) != len(names) or len(velocities) != len(names):
        raise CollectionError('stepit_joint_state_fields_incomplete')
    values = {}
    for index, name in enumerate(names):
        if not math.isfinite(positions[index]) or not math.isfinite(velocities[index]):
            raise CollectionError('stepit_non_finite_joint_state')
        values[name] = {'position': repr(float(positions[index])),
                        'velocity': repr(float(velocities[index]))}
    return values


def build_observation(reader, checkout):
    joint_endpoint = _publisher(reader, JOINT_TOPIC, JOINT_TYPE, JOINT_NODE)
    description_endpoint = _publisher(reader, DESCRIPTION_TOPIC, DESCRIPTION_TYPE, DESCRIPTION_NODE)
    description_message, description_gid = reader.once(DESCRIPTION_TOPIC, DESCRIPTION_TYPE, transient=True)
    if description_gid != description_endpoint['gid']:
        raise CollectionError('stepit_description_sample_publisher_mismatch')
    live_description = _description(description_message)
    joint_message, joint_gid = reader.once(JOINT_TOPIC, JOINT_TYPE)
    if joint_gid != joint_endpoint['gid']:
        raise CollectionError('stepit_joint_sample_publisher_mismatch')
    sample = _joint_sample(joint_message, live_description['jointToMotorId'])
    if (_publisher(reader, JOINT_TOPIC, JOINT_TYPE, JOINT_NODE) != joint_endpoint or
            _publisher(reader, DESCRIPTION_TOPIC, DESCRIPTION_TYPE, DESCRIPTION_NODE) != description_endpoint):
        raise CollectionError('stepit_publisher_changed_during_capture')
    observation = {
        'schemaVersion': 1, 'kind': 'RlsokStepItLiveJointStatus', 'observedAt': utc_now(),
        'hardwareDispatch': False, 'operatorSourceCheckout': checkout,
        'rosEnvironment': reader.environment(),
        'liveDescription': live_description,
        'publishers': {'jointStates': joint_endpoint, 'robotDescription': description_endpoint},
        'jointState': sample,
        'limits': {
            'proves': 'ROS joint-state data was observed beside a live description declaring non-dummy StepIt hardware',
            'doesNotProve': ['physical motor identity', 'serial-port identity', 'firmware identity',
                             'safe motion', 'command authorization', 'owner acceptance'],
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
            self.node = rclpy.create_node('rlsok_stepit_reader_' + uuid4().hex, context=self.context,
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
            raise CollectionError('stepit_invalid_ros_environment')
        return {'rosDistro': distro, 'rmwImplementation': self.rmw(), 'domainId': int(domain)}

    def publishers(self, topic):
        deadline, pending = time.monotonic() + 15, []
        while time.monotonic() < deadline:
            rows = self.node.get_publishers_info_by_topic(topic)
            if rows:
                if len(rows) > 32:
                    raise CollectionError('stepit_too_many_publishers:' + topic)
                pending = sorted([{'node': row.node_namespace.rstrip('/') + '/' + row.node_name,
                    'type': row.topic_type, 'gid': bytes(row.endpoint_gid).hex()} for row in rows],
                    key=lambda item: (item['node'], item['gid']))
                if all('_NODE_NAME_UNKNOWN_' not in item['node'] and
                       '_NODE_NAMESPACE_UNKNOWN_' not in item['node'] for item in pending):
                    return pending
            self.executor.spin_once(timeout_sec=0.1)
        return pending

    def once(self, topic, message_type, transient=False):
        from rclpy.qos import QoSProfile, DurabilityPolicy, ReliabilityPolicy
        qos = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL if transient
                         else DurabilityPolicy.VOLATILE, reliability=ReliabilityPolicy.RELIABLE)
        received, deadline = [], time.monotonic() + 15

        def callback(message, info):
            if received:
                return
            raw = getattr(info, 'publisher_gid', None)
            raw = raw.get('data') if isinstance(raw, dict) else getattr(raw, 'data', raw)
            if not isinstance(raw, (bytes, bytearray)) or len(raw) not in (16, 24):
                raise CollectionError('stepit_message_publisher_gid_unavailable')
            received.append((message, bytes(raw).hex()))

        subscription = self.node.create_subscription(self.get_message(message_type), topic, callback, qos)
        try:
            while not received and time.monotonic() < deadline:
                self.executor.spin_once(timeout_sec=0.1)
            if not received:
                raise CollectionError('stepit_sample_timeout:' + topic)
            return received[0]
        finally:
            self.node.destroy_subscription(subscription)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise CollectionError('output_already_exists')
        checkout = inspect_checkout(args.source_root)
        with Reader() as reader:
            observation = build_observation(reader, checkout)
        write_output(args.output, observation)
        print('OBSERVED | StepIt non-dummy ROS joint-state path | hardware dispatch: NO')
        return 0
    except Exception as error:
        print(f'stepit_status_capture_failed:{type(error).__name__}:{error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
