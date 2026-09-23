#!/usr/bin/env python3
"""Read an already-running EROB left-arm ROS graph without controlling hardware.

Never launch the arm for this check. The public hardware launch can activate the
EtherCAT interface; this process only subscribes to two existing ROS topics.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
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
JOINTS = tuple(f'L_Joint_{index}' for index in range(1, 8))
EXPECTED_PLUGIN = 'erob_hardware/ErobHardwareInterface'
UNKNOWN_NODE = '/_NODE_NAMESPACE_UNKNOWN_/_NODE_NAME_UNKNOWN_'


def _publisher(reader, topic, expected_type, expected_node):
    rows = reader.publishers(topic)
    if len(rows) != 1 or rows[0].get('type') != expected_type:
        raise CollectionError('erob_publisher_missing_or_ambiguous:' + topic + ':' + json.dumps(rows))
    row = rows[0]
    if row.get('node') not in (expected_node, UNKNOWN_NODE):
        raise CollectionError('erob_unexpected_publisher:' + topic + ':' + json.dumps(row))
    gid = row.get('gid')
    if not isinstance(gid, str) or len(gid) not in (32, 48):
        raise CollectionError('erob_publisher_gid_unavailable:' + topic)
    try:
        if not any(bytes.fromhex(gid)):
            raise ValueError('zero gid')
    except ValueError as error:
        raise CollectionError('erob_publisher_gid_unavailable:' + topic) from error
    return row


def _description(message):
    try:
        raw = message.data
        root = ET.fromstring(raw)
    except (AttributeError, TypeError, ValueError, ET.ParseError) as error:
        raise CollectionError('erob_invalid_live_robot_description') from error
    if root.tag != 'robot' or root.get('name') != 'shu_pr03':
        raise CollectionError('erob_unexpected_robot_description')
    systems = root.findall('./ros2_control')
    if len(systems) != 2:
        raise CollectionError('erob_hardware_systems_missing_or_ambiguous')
    by_name = {system.get('name'): system for system in systems}
    if len(by_name) != 2 or set(by_name) != {'RealLeftArm', 'MockRightArmAndHead'}:
        raise CollectionError('erob_hardware_system_names_mismatch')
    real, mock = by_name['RealLeftArm'], by_name['MockRightArmAndHead']
    if (real.get('type') != 'system' or real.findtext('./hardware/plugin') != EXPECTED_PLUGIN or
            mock.findtext('./hardware/plugin') != 'mock_components/GenericSystem'):
        raise CollectionError('erob_hardware_plugin_mismatch')
    joints = real.findall('./joint')
    names = [joint.get('name') for joint in joints]
    if len(names) != 7 or set(names) != set(JOINTS):
        raise CollectionError('erob_real_left_joint_mapping_mismatch')
    for joint in joints:
        state = [item.get('name') for item in joint.findall('./state_interface')]
        command = [item.get('name') for item in joint.findall('./command_interface')]
        if state != ['position'] or command != ['position']:
            raise CollectionError('erob_real_left_interface_mismatch')
    return {'robotName': 'shu_pr03', 'realSystem': 'RealLeftArm',
            'declaredHardwarePlugin': EXPECTED_PLUGIN,
            'mockSystem': 'MockRightArmAndHead', 'leftJoints': list(JOINTS),
            'robotDescriptionSha256': hashlib.sha256(raw.encode()).hexdigest()}


def _sample(message):
    try:
        names = list(message.name)
        positions = list(message.position)
    except (AttributeError, TypeError) as error:
        raise CollectionError('erob_invalid_joint_sample') from error
    if len(names) != len(set(names)) or len(positions) != len(names) or not set(JOINTS).issubset(names):
        raise CollectionError('erob_left_joint_sample_incomplete')
    if len(names) > 64:
        raise CollectionError('erob_unexpected_joint_count')
    values = {}
    for name in JOINTS:
        try:
            value = float(positions[names.index(name)])
        except (TypeError, ValueError, OverflowError) as error:
            raise CollectionError('erob_invalid_joint_position') from error
        if not math.isfinite(value):
            raise CollectionError('erob_non_finite_joint_position')
        values[name] = repr(value)
    return values


def build_observation(reader, checkout):
    joint_endpoint = _publisher(reader, JOINT_TOPIC, JOINT_TYPE, '/joint_state_broadcaster')
    description_endpoint = _publisher(reader, DESCRIPTION_TOPIC, DESCRIPTION_TYPE, '/robot_state_publisher')
    description_message, description_gid = reader.once(DESCRIPTION_TOPIC, DESCRIPTION_TYPE, transient=True)
    if description_gid != description_endpoint['gid']:
        raise CollectionError('erob_description_sample_publisher_mismatch')
    description = _description(description_message)
    joint_message, joint_gid = reader.once(JOINT_TOPIC, JOINT_TYPE)
    if joint_gid != joint_endpoint['gid']:
        raise CollectionError('erob_joint_sample_publisher_mismatch')
    sample = _sample(joint_message)
    if (_publisher(reader, JOINT_TOPIC, JOINT_TYPE, '/joint_state_broadcaster') != joint_endpoint or
            _publisher(reader, DESCRIPTION_TOPIC, DESCRIPTION_TYPE, '/robot_state_publisher') != description_endpoint):
        raise CollectionError('erob_publisher_changed_during_capture')
    observation = {
        'schemaVersion': 1, 'kind': 'RlsokErobLeftArmLiveStatus',
        'observedAt': utc_now(), 'hardwareDispatch': False,
        'operatorSourceCheckout': checkout, 'rosEnvironment': reader.environment(),
        'liveDescription': description,
        'publishers': {'jointStates': joint_endpoint, 'robotDescription': description_endpoint},
        'leftJointPositions': sample,
        'limits': {
            'proves': 'a ROS joint sample was received with a live description declaring the EROB real-left-arm plugin',
            'doesNotProve': ['the source checkout was loaded by the running process',
                             'EtherCAT OP state', 'physical arm identity', 'fresh motor movement',
                             'safe motion', 'command authorization', 'owner acceptance'],
        },
    }
    observation['observationSha256'] = hashlib.sha256(canonical(observation).encode()).hexdigest()
    return observation


class Reader:
    def __enter__(self):
        import rclpy
        from rclpy.context import Context
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.utilities import get_rmw_implementation_identifier
        from rosidl_runtime_py.utilities import get_message
        self.rmw, self.get_message = get_rmw_implementation_identifier, get_message
        self.context = Context()
        rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node('rlsok_erob_reader_' + uuid4().hex, context=self.context,
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
        distro, domain = os.environ.get('ROS_DISTRO'), os.environ.get('ROS_DOMAIN_ID', '0')
        if distro != 'humble' or not domain.isdigit() or not 0 <= int(domain) <= 232:
            raise CollectionError('erob_expected_ros_humble_environment')
        return {'rosDistro': distro, 'rmwImplementation': self.rmw(), 'domainId': int(domain)}

    def publishers(self, topic):
        deadline, pending = time.monotonic() + 15, []
        while time.monotonic() < deadline:
            rows = self.node.get_publishers_info_by_topic(topic)
            if rows:
                if len(rows) > 32:
                    raise CollectionError('erob_too_many_publishers:' + topic)
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
                raise CollectionError('erob_message_publisher_gid_unavailable')
            received.append((message, bytes(raw).hex()))

        subscription = self.node.create_subscription(self.get_message(message_type), topic, callback, qos)
        try:
            while not received and time.monotonic() < deadline:
                self.executor.spin_once(timeout_sec=0.1)
            if not received:
                raise CollectionError('erob_sample_timeout:' + topic)
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
        source = inspect_checkout(args.source_root)
        # The local origin can contain credentials; it is not needed in the
        # owner-shareable first-connection report.
        checkout = {'commit': source['commit'], 'dirty': source['dirty']}
        with Reader() as reader:
            observation = build_observation(reader, checkout)
        write_output(args.output, observation)
        print('OBSERVED | EROB left-arm ROS status | hardware dispatch: NO')
        return 0
    except Exception as error:
        print(f'erob_status_capture_failed:{type(error).__name__}:{error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
