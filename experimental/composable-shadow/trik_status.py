#!/usr/bin/env python3
"""Capture TRIK wheel and odometry state from an already-running ROS graph.

The reader only creates subscriptions.  It does not connect to the TRIK TCP
server, publish cmd_vel, call controller services, activate controllers or
write zeroes to the motors.  The result is an owner-run observation of the ROS
state path, not authenticated brick identity or permission to move.
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

JOINT_TOPIC = '/joint_states'
JOINT_TYPE = 'sensor_msgs/msg/JointState'
ODOM_TOPIC = '/diff_drive_controller/odom'
ODOM_TYPE = 'nav_msgs/msg/Odometry'
WHEELS = ('base_left_wheel_joint', 'base_right_wheel_joint')


def finite(value, label):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise CollectionError('trik_non_finite_value:' + label)
    # Preserve ROS floating-point values as portable text.  The shared
    # canonical encoder deliberately rejects JSON floats because runtimes may
    # serialize the same binary value differently.
    return repr(float(value))


def publisher(reader, topic, message_type):
    rows = reader.publishers(topic)
    if len(rows) != 1 or rows[0]['type'] != message_type:
        raise CollectionError('trik_publisher_missing_or_ambiguous:' + topic + ':' + json.dumps(rows))
    return rows[0]


def stamp(message):
    value = message.header.stamp
    if type(value.sec) is not int or type(value.nanosec) is not int:
        raise CollectionError('trik_invalid_message_stamp')
    return {'sec': value.sec, 'nanosec': value.nanosec}


def build_observation(reader, source_checkout):
    joint_publisher = publisher(reader, JOINT_TOPIC, JOINT_TYPE)
    odom_publisher = publisher(reader, ODOM_TOPIC, ODOM_TYPE)
    joints = reader.once(JOINT_TOPIC, JOINT_TYPE)
    odom = reader.once(ODOM_TOPIC, ODOM_TYPE)

    names = list(joints.name)
    if len(names) != len(set(names)) or any(names.count(name) != 1 for name in WHEELS):
        raise CollectionError('trik_expected_wheel_joints_missing_or_ambiguous:' + json.dumps(names))
    if len(joints.position) != len(names) or len(joints.velocity) != len(names):
        raise CollectionError('trik_joint_state_arrays_do_not_match_names')
    wheel_state = {}
    for name in WHEELS:
        index = names.index(name)
        wheel_state[name] = {
            'position': finite(joints.position[index], name + '.position'),
            'velocity': finite(joints.velocity[index], name + '.velocity'),
        }

    pose, twist = odom.pose.pose, odom.twist.twist
    observation = {
        'schemaVersion': 1,
        'kind': 'RlsokTrikDriveStatus',
        'observedAt': utc_now(),
        'source': {
            'checkout': source_checkout,
            'environment': reader.environment(),
            'jointStates': {'topic': JOINT_TOPIC, 'messageType': JOINT_TYPE, 'publisher': joint_publisher},
            'odometry': {'topic': ODOM_TOPIC, 'messageType': ODOM_TYPE, 'publisher': odom_publisher},
        },
        'jointStateStamp': stamp(joints),
        'odometryStamp': stamp(odom),
        'frames': {'odometry': odom.header.frame_id, 'body': odom.child_frame_id},
        'wheels': wheel_state,
        'odometry': {
            'position': {key: finite(getattr(pose.position, key), 'position.' + key) for key in ('x', 'y', 'z')},
            'orientation': {key: finite(getattr(pose.orientation, key), 'orientation.' + key) for key in ('x', 'y', 'z', 'w')},
            'linearVelocity': {key: finite(getattr(twist.linear, key), 'linear_velocity.' + key) for key in ('x', 'y', 'z')},
            'angularVelocity': {key: finite(getattr(twist.angular, key), 'angular_velocity.' + key) for key in ('x', 'y', 'z')},
        },
    }
    if not observation['frames']['odometry'] or not observation['frames']['body']:
        raise CollectionError('trik_odometry_frame_missing')
    observation['observationSha256'] = hashlib.sha256(canonical(observation).encode()).hexdigest()
    return observation


class Reader:
    def __enter__(self):
        import os
        import rclpy
        from rclpy.context import Context
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.qos import qos_profile_sensor_data
        from rclpy.utilities import get_rmw_implementation_identifier
        from rosidl_runtime_py.utilities import get_message
        self.rclpy, self.get_message = rclpy, get_message
        self.qos, self.rmw, self.os = qos_profile_sensor_data, get_rmw_implementation_identifier, os
        self.context = Context(); rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node('rlsok_trik_status_reader_' + uuid4().hex, context=self.context,
                enable_rosout=False, start_parameter_services=False, use_global_arguments=False)
            self.executor = SingleThreadedExecutor(context=self.context); self.executor.add_node(self.node)
        except Exception:
            self.context.shutdown(); raise
        return self

    def __exit__(self, *_):
        try:
            self.executor.shutdown(timeout_sec=5); self.node.destroy_node()
        finally:
            self.context.shutdown()

    def environment(self):
        distro, domain = self.os.environ.get('ROS_DISTRO'), self.os.environ.get('ROS_DOMAIN_ID', '0')
        if not distro or not domain.isdigit() or not 0 <= int(domain) <= 232:
            raise CollectionError('invalid ROS environment')
        return {'rosDistro': distro, 'rmwImplementation': self.rmw(), 'domainId': int(domain)}

    def publishers(self, topic):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            rows = self.node.get_publishers_info_by_topic(topic)
            if rows:
                if len(rows) > 32: raise CollectionError('too_many_trik_state_publishers:' + topic)
                return sorted([{'node': r.node_namespace.rstrip('/') + '/' + r.node_name,
                    'type': r.topic_type, 'gid': bytes(r.endpoint_gid).hex()} for r in rows], key=lambda r: (r['node'], r['gid']))
            self.executor.spin_once(timeout_sec=0.1)
        return []

    def once(self, topic, message_type):
        received, deadline = [], time.monotonic() + 20
        subscription = self.node.create_subscription(self.get_message(message_type), topic, received.append, self.qos)
        try:
            while not received and time.monotonic() < deadline:
                self.executor.spin_once(timeout_sec=0.1)
            if len(received) != 1: raise CollectionError('trik_state_sample_timeout:' + topic)
            return received[0]
        finally:
            self.node.destroy_subscription(subscription)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--source-root', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.output.exists(): raise CollectionError('output_already_exists')
        source_checkout = inspect_checkout(args.source_root)
        with Reader() as reader: result = build_observation(reader, source_checkout)
        write_output(args.output, result)
        print('OBSERVED | TRIK wheel and odometry state read only | hardware dispatch: NO')
        return 0
    except Exception as error:
        print(f'trik_status_capture_failed:{type(error).__name__}:{error}', file=sys.stderr); return 2


if __name__ == '__main__': sys.exit(main())
