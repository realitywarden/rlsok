#!/usr/bin/env python3
"""Capture reBot Arm B601-RS state from an already-running real controller.

The reader only subscribes to the public joint-state and arm-status topics. It
does not open SocketCAN, publish a command, call a service, start bringup or
enable the arm. It rejects the public fake-driver node by requiring both
publishers to be the hardware controller node from the selected public source.
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

JOINT_TOPIC = '/rebotarm/joint_states'
JOINT_TYPE = 'sensor_msgs/msg/JointState'
STATUS_TOPIC = '/rebotarm/arm_status'
STATUS_TYPE = 'rebotarm_msgs/msg/ArmStatus'
HARDWARE_NODE = '/reBotArmController'
JOINTS = tuple(f'joint{index}' for index in range(1, 7))
MODES = ('mit', 'pos_vel', 'vel')
STATES = ('IDLE', 'TRAJ_RUNNING', 'LOWLEVEL_STREAMING', 'GRAVITY_COMP')


def finite(value, label):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise CollectionError('rebot_non_finite_value:' + label)
    return repr(float(value))


def endpoint(reader, topic, message_type):
    rows = reader.publishers(topic)
    if len(rows) != 1 or rows[0]['type'] != message_type or rows[0]['node'] != HARDWARE_NODE:
        raise CollectionError('rebot_hardware_publisher_missing_or_ambiguous:' + topic + ':' + json.dumps(rows))
    return rows[0]


def stamp(message):
    value = message.header.stamp
    if type(value.sec) is not int or type(value.nanosec) is not int:
        raise CollectionError('rebot_invalid_message_stamp')
    return {'sec': value.sec, 'nanosec': value.nanosec}


def build_observation(reader, source_commit):
    if len(source_commit) != 40 or any(character not in '0123456789abcdef' for character in source_commit):
        raise CollectionError('rebot_source_commit_must_be_full_lowercase_sha1')
    joint_endpoint = endpoint(reader, JOINT_TOPIC, JOINT_TYPE)
    status_endpoint = endpoint(reader, STATUS_TOPIC, STATUS_TYPE)
    joints = reader.once(JOINT_TOPIC, JOINT_TYPE, 'sensor')
    status = reader.once(STATUS_TOPIC, STATUS_TYPE, 'latched')

    names = list(joints.name)
    if len(names) != len(set(names)) or any(names.count(name) != 1 for name in JOINTS):
        raise CollectionError('rebot_expected_arm_joints_missing_or_ambiguous:' + json.dumps(names))
    if any(len(values) != len(names) for values in (joints.position, joints.velocity, joints.effort)):
        raise CollectionError('rebot_joint_state_arrays_do_not_match_names')
    status_names = list(status.joint_names)
    status_codes = list(status.per_joint_status_code)
    if status_names != list(JOINTS) or len(status_codes) != len(JOINTS):
        raise CollectionError('rebot_arm_status_joint_mapping_invalid')
    if status.mode not in MODES or status.state_machine not in STATES:
        raise CollectionError('rebot_arm_status_mode_or_state_invalid')
    if any(type(code) is not int or not 0 <= code <= 255 for code in status_codes):
        raise CollectionError('rebot_joint_status_code_invalid')

    arm_state = {}
    for name in JOINTS:
        index = names.index(name)
        arm_state[name] = {
            'position': finite(joints.position[index], name + '.position'),
            'velocity': finite(joints.velocity[index], name + '.velocity'),
            'effort': finite(joints.effort[index], name + '.effort'),
            'statusCode': status_codes[list(JOINTS).index(name)],
        }
    observation = {
        'schemaVersion': 1,
        'kind': 'RlsokReBotArmB601RsStatus',
        'observedAt': utc_now(),
        'operatorSelection': {'sourceCommit': source_commit, 'model': 'B601-RS', 'namespace': 'rebotarm'},
        'source': {
            'environment': reader.environment(),
            'jointStates': {'topic': JOINT_TOPIC, 'messageType': JOINT_TYPE, 'publisher': joint_endpoint},
            'armStatus': {'topic': STATUS_TOPIC, 'messageType': STATUS_TYPE, 'publisher': status_endpoint},
        },
        'jointStateStamp': stamp(joints),
        'armStatusStamp': stamp(status),
        'armStatus': {
            'mode': status.mode,
            'enabled': bool(status.enabled),
            'controlLoopActive': bool(status.control_loop_active),
            'stateMachine': status.state_machine,
            'errorCodes': list(status.error_codes),
        },
        'joints': arm_state,
        'limits': {
            'proves': 'the selected hardware-controller ROS state path produced both samples',
            'doesNotProve': ['physical arm identity', 'CAN peer identity', 'motor safety', 'permission to move', 'customer acceptance'],
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
        from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy, qos_profile_sensor_data
        from rclpy.utilities import get_rmw_implementation_identifier
        from rosidl_runtime_py.utilities import get_message
        self.get_message, self.os, self.rmw = get_message, os, get_rmw_implementation_identifier
        self.sensor_qos = qos_profile_sensor_data
        self.latched_qos = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL,
            reliability=ReliabilityPolicy.RELIABLE)
        self.context = Context(); rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node('rlsok_rebot_status_reader_' + uuid4().hex, context=self.context,
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
                if len(rows) > 32: raise CollectionError('too_many_rebot_state_publishers:' + topic)
                return sorted([{'node': r.node_namespace.rstrip('/') + '/' + r.node_name,
                    'type': r.topic_type, 'gid': bytes(r.endpoint_gid).hex()} for r in rows], key=lambda r: (r['node'], r['gid']))
            self.executor.spin_once(timeout_sec=0.1)
        return []

    def once(self, topic, message_type, qos):
        received, deadline = [], time.monotonic() + 20
        profile = self.sensor_qos if qos == 'sensor' else self.latched_qos
        subscription = self.node.create_subscription(self.get_message(message_type), topic, received.append, profile)
        try:
            while not received and time.monotonic() < deadline:
                self.executor.spin_once(timeout_sec=0.1)
            if len(received) != 1: raise CollectionError('rebot_state_sample_timeout:' + topic)
            return received[0]
        finally:
            self.node.destroy_subscription(subscription)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--source-commit', required=True)
    args = parser.parse_args(argv)
    try:
        if args.output.exists(): raise CollectionError('output_already_exists')
        with Reader() as reader: result = build_observation(reader, args.source_commit)
        write_output(args.output, result)
        print('OBSERVED | reBot Arm B601-RS state read only | hardware dispatch: NO')
        return 0
    except Exception as error:
        print(f'rebot_status_capture_failed:{type(error).__name__}:{error}', file=sys.stderr); return 2


if __name__ == '__main__': sys.exit(main())
