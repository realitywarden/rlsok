#!/usr/bin/env python3
"""Capture both live Gen3 bridges from an already-running wearable rig.

This reader subscribes to the project's existing session, telemetry and joint
state topics. It never opens a Kortex session, calls a ROS service, publishes
a target, starts bringup or changes an arm. The public mock launch is rejected
because it does not provide the two high-level bridge session/telemetry paths.
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

SESSION_TOPIC = '/real/session_state'
TELEMETRY_TOPICS = {'left': '/real/telemetry_left', 'right': '/real/telemetry_right'}
JOINT_TOPIC = '/real/joint_states'
STRING_TYPE = 'std_msgs/msg/String'
JOINT_TYPE = 'sensor_msgs/msg/JointState'
ARMS = ('left', 'right')
BRIDGE_NODES = {arm: f'/kortex_highlevel_bridge_{arm}' for arm in ARMS}
JOINTS = {arm: tuple(f'{arm}_joint_{index}' for index in range(1, 8)) for arm in ARMS}


def finite(value, label):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise CollectionError('dual_kinova_non_finite_value:' + label)
    return repr(float(value))


def parse_json(message, label):
    try:
        value = json.loads(message.data)
    except (AttributeError, TypeError, json.JSONDecodeError) as error:
        raise CollectionError('dual_kinova_invalid_json:' + label) from error
    if type(value) is not dict:
        raise CollectionError('dual_kinova_json_must_be_object:' + label)
    return value


def endpoint_set(reader, topic, message_type, expected_nodes):
    rows = reader.publishers(topic)
    if (len(rows) != len(expected_nodes) or {row['node'] for row in rows} != set(expected_nodes)
            or any(row['type'] != message_type for row in rows)):
        raise CollectionError(
            'dual_kinova_expected_publishers_missing_or_ambiguous:' + topic + ':' + json.dumps(rows))
    return rows


def build_observation(reader, source_commit):
    if len(source_commit) != 40 or any(character not in '0123456789abcdef' for character in source_commit):
        raise CollectionError('dual_kinova_source_commit_must_be_full_lowercase_sha1')

    bridge_nodes = tuple(BRIDGE_NODES.values())
    session_endpoints = endpoint_set(reader, SESSION_TOPIC, STRING_TYPE, bridge_nodes)
    joint_endpoints = endpoint_set(reader, JOINT_TOPIC, JOINT_TYPE, bridge_nodes)
    telemetry_endpoints = {}
    for arm in ARMS:
        telemetry_endpoints[arm] = endpoint_set(
            reader, TELEMETRY_TOPICS[arm], STRING_TYPE, (BRIDGE_NODES[arm],))[0]

    session_messages = reader.until(
        SESSION_TOPIC, STRING_TYPE,
        lambda messages: {parse_json(message, 'session').get('arm') for message in messages} >= set(ARMS))
    sessions = {}
    for message in session_messages:
        value = parse_json(message, 'session')
        arm = value.get('arm')
        if arm not in ARMS:
            continue
        if type(value.get('connected')) is not bool or type(value.get('recoveries')) is not int:
            raise CollectionError('dual_kinova_invalid_session_state:' + arm)
        sessions[arm] = {
            'connected': value['connected'],
            'error': str(value.get('error', '')),
            'recoveries': value['recoveries'],
        }
    if set(sessions) != set(ARMS) or any(not value['connected'] for value in sessions.values()):
        raise CollectionError('dual_kinova_both_sessions_must_be_connected:' + json.dumps(sessions))

    telemetry = {}
    for arm in ARMS:
        value = parse_json(reader.once(TELEMETRY_TOPICS[arm], STRING_TYPE), 'telemetry_' + arm)
        if value.get('arm') != arm or type(value.get('faulted')) is not bool:
            raise CollectionError('dual_kinova_invalid_telemetry:' + arm)
        telemetry[arm] = {
            'faulted': value['faulted'],
            'faultWhy': str(value.get('fault_why', '')),
            'heat': str(value.get('heat', 'unknown')),
            'heatWhy': str(value.get('heat_why', '')),
            'gripperCommand': None if value.get('gripper_cmd') is None else finite(value['gripper_cmd'], arm + '.gripper_cmd'),
            'gripperPosition': None if value.get('gripper_pos') is None else finite(value['gripper_pos'], arm + '.gripper_pos'),
            'inContact': value.get('in_contact') if type(value.get('in_contact')) is bool else None,
            'contactWhy': str(value.get('contact_why', '')),
        }

    joint_messages = reader.until(
        JOINT_TOPIC, JOINT_TYPE,
        lambda messages: all(any(set(JOINTS[arm]) <= set(message.name) for message in messages) for arm in ARMS))
    joints = {}
    stamps = {}
    for arm in ARMS:
        candidates = [message for message in joint_messages if set(JOINTS[arm]) <= set(message.name)]
        if len(candidates) != 1:
            raise CollectionError('dual_kinova_joint_sample_missing_or_ambiguous:' + arm)
        message = candidates[0]
        names = list(message.name)
        if len(names) != len(set(names)) or len(message.position) != len(names):
            raise CollectionError('dual_kinova_invalid_joint_mapping:' + arm)
        joints[arm] = {
            name: {'position': finite(message.position[names.index(name)], name + '.position')}
            for name in JOINTS[arm]
        }
        stamp = message.header.stamp
        if type(stamp.sec) is not int or type(stamp.nanosec) is not int:
            raise CollectionError('dual_kinova_invalid_joint_stamp:' + arm)
        stamps[arm] = {'sec': stamp.sec, 'nanosec': stamp.nanosec}

    observation = {
        'schemaVersion': 1,
        'kind': 'RlsokWearableDualKinovaStatus',
        'observedAt': utc_now(),
        'operatorSelection': {
            'sourceCommit': source_commit,
            'publicReferenceCommit': '06538a1e2dd04696e7645279b722e4930f0777e9',
            'arms': list(ARMS),
        },
        'source': {
            'environment': reader.environment(),
            'sessionState': {'topic': SESSION_TOPIC, 'messageType': STRING_TYPE, 'publishers': session_endpoints},
            'jointStates': {'topic': JOINT_TOPIC, 'messageType': JOINT_TYPE, 'publishers': joint_endpoints},
            'telemetry': {
                arm: {'topic': TELEMETRY_TOPICS[arm], 'messageType': STRING_TYPE,
                      'publisher': telemetry_endpoints[arm]} for arm in ARMS
            },
        },
        'sessions': sessions,
        'telemetry': telemetry,
        'jointStateStamps': stamps,
        'joints': joints,
        'limits': {
            'proves': 'both selected high-level bridge ROS paths reported connected sessions, telemetry and seven-joint state',
            'doesNotProve': ['physical arm identity', 'Kortex peer authentication', 'network address ownership',
                             'permission to move', 'motion safety', 'customer acceptance'],
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
        from rclpy.qos import QoSProfile, ReliabilityPolicy
        from rclpy.utilities import get_rmw_implementation_identifier
        from rosidl_runtime_py.utilities import get_message
        self.get_message, self.os, self.rmw = get_message, os, get_rmw_implementation_identifier
        self.qos = QoSProfile(depth=20, reliability=ReliabilityPolicy.RELIABLE)
        self.context = Context(); rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node('rlsok_dual_kinova_status_reader_' + uuid4().hex,
                context=self.context, enable_rosout=False, start_parameter_services=False,
                use_global_arguments=False)
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
                if len(rows) > 32: raise CollectionError('too_many_dual_kinova_publishers:' + topic)
                return sorted([{'node': row.node_namespace.rstrip('/') + '/' + row.node_name,
                    'type': row.topic_type, 'gid': bytes(row.endpoint_gid).hex()} for row in rows],
                    key=lambda row: (row['node'], row['gid']))
            self.executor.spin_once(timeout_sec=0.1)
        return []

    def until(self, topic, message_type, complete):
        received, deadline = [], time.monotonic() + 20
        subscription = self.node.create_subscription(self.get_message(message_type), topic, received.append, self.qos)
        try:
            while not complete(received) and time.monotonic() < deadline:
                self.executor.spin_once(timeout_sec=0.1)
            if not complete(received):
                raise CollectionError('dual_kinova_state_sample_timeout:' + topic)
            return received
        finally:
            self.node.destroy_subscription(subscription)

    def once(self, topic, message_type):
        return self.until(topic, message_type, lambda messages: bool(messages))[0]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--source-commit', required=True)
    args = parser.parse_args(argv)
    try:
        if args.output.exists(): raise CollectionError('output_already_exists')
        with Reader() as reader: result = build_observation(reader, args.source_commit)
        write_output(args.output, result)
        print('OBSERVED | wearable dual Kinova state read only | hardware dispatch: NO')
        return 0
    except Exception as error:
        print(f'dual_kinova_status_capture_failed:{type(error).__name__}:{error}', file=sys.stderr)
        return 2


if __name__ == '__main__': sys.exit(main())
