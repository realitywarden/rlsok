#!/usr/bin/env python3
"""Capture one LelyRobot ultrasonic sample from an already-running ROS graph.

The reader creates one ROS subscription only. It does not open the serial port,
publish cmd_vel, call services, start bringup or write a stop command. The
result shows the selected ROS sensor path produced a sample; it does not
authenticate the Arduino, firmware, motor controller or physical robot.
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

TOPIC = '/ultrasonic_left'
MESSAGE_TYPE = 'sensor_msgs/msg/Range'
EXPECTED_NODE = '/arduino_bridge'
VARIANTS = ('python', 'cpp')


def finite(value, label):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise CollectionError('lely_non_finite_value:' + label)
    return repr(float(value))


def publisher(reader):
    rows = reader.publishers(TOPIC)
    if len(rows) != 1 or rows[0]['type'] != MESSAGE_TYPE or rows[0]['node'] != EXPECTED_NODE:
        raise CollectionError('lely_publisher_missing_or_ambiguous:' + json.dumps(rows))
    return rows[0]


def stamp(message):
    value = message.header.stamp
    if type(value.sec) is not int or type(value.nanosec) is not int:
        raise CollectionError('lely_invalid_message_stamp')
    return {'sec': value.sec, 'nanosec': value.nanosec}


def build_observation(reader, source_checkout, bridge_variant):
    if bridge_variant not in VARIANTS:
        raise CollectionError('lely_bridge_variant_invalid')
    endpoint = publisher(reader)
    sample = reader.once(TOPIC, MESSAGE_TYPE)
    values = {
        'fieldOfView': finite(sample.field_of_view, 'field_of_view'),
        'minimumRange': finite(sample.min_range, 'min_range'),
        'maximumRange': finite(sample.max_range, 'max_range'),
        'range': finite(sample.range, 'range'),
    }
    minimum, maximum, measured = float(sample.min_range), float(sample.max_range), float(sample.range)
    if minimum < 0 or maximum <= minimum or measured < minimum or measured > maximum:
        raise CollectionError('lely_range_outside_declared_bounds')
    if sample.radiation_type not in (0, 1) or not sample.header.frame_id:
        raise CollectionError('lely_range_metadata_invalid')
    observation = {
        'schemaVersion': 1,
        'kind': 'RlsokLelyRobotUltrasonicStatus',
        'observedAt': utc_now(),
        'operatorSelection': {
            'sourceCommit': source_checkout['commit'],
            'sourceCheckout': source_checkout,
            'bridgeVariant': bridge_variant,
        },
        'source': {
            'environment': reader.environment(),
            'topic': TOPIC,
            'messageType': MESSAGE_TYPE,
            'publisher': endpoint,
        },
        'sampleStamp': stamp(sample),
        'frameId': sample.header.frame_id,
        'radiationType': sample.radiation_type,
        'measurement': values,
        'limits': {
            'proves': 'one selected ROS ultrasonic sample path was live',
            'doesNotProve': ['Arduino identity', 'firmware identity', 'motor safety', 'command delivery', 'physical acceptance'],
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
        from rclpy.qos import qos_profile_sensor_data
        from rclpy.utilities import get_rmw_implementation_identifier
        from rosidl_runtime_py.utilities import get_message
        self.rclpy, self.get_message = rclpy, get_message
        self.qos, self.rmw, self.os = qos_profile_sensor_data, get_rmw_implementation_identifier, os
        self.context = Context(); rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node('rlsok_lely_status_reader_' + uuid4().hex, context=self.context,
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
        pending = []
        while time.monotonic() < deadline:
            rows = self.node.get_publishers_info_by_topic(topic)
            if rows:
                if len(rows) > 32: raise CollectionError('too_many_lely_sensor_publishers')
                pending = sorted([{'node': r.node_namespace.rstrip('/') + '/' + r.node_name,
                    'type': r.topic_type, 'gid': bytes(r.endpoint_gid).hex()} for r in rows], key=lambda r: (r['node'], r['gid']))
                if all('_NODE_NAME_UNKNOWN_' not in row['node'] and
                       '_NODE_NAMESPACE_UNKNOWN_' not in row['node'] for row in pending):
                    return pending
            self.executor.spin_once(timeout_sec=0.1)
        return pending

    def once(self, topic, message_type):
        received, deadline = [], time.monotonic() + 20
        subscription = self.node.create_subscription(self.get_message(message_type), topic, received.append, self.qos)
        try:
            while not received and time.monotonic() < deadline:
                self.executor.spin_once(timeout_sec=0.1)
            if len(received) != 1: raise CollectionError('lely_sensor_sample_timeout')
            return received[0]
        finally:
            self.node.destroy_subscription(subscription)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--bridge-variant', required=True, choices=VARIANTS)
    args = parser.parse_args(argv)
    try:
        if args.output.exists(): raise CollectionError('output_already_exists')
        source_checkout = inspect_checkout(args.source_root)
        with Reader() as reader: result = build_observation(reader, source_checkout, args.bridge_variant)
        write_output(args.output, result)
        print('OBSERVED | LelyRobot ultrasonic ROS path read only | hardware dispatch: NO')
        return 0
    except Exception as error:
        print(f'lely_status_capture_failed:{type(error).__name__}:{error}', file=sys.stderr); return 2


if __name__ == '__main__': sys.exit(main())
