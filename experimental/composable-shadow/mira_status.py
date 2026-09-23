#!/usr/bin/env python3
"""Capture one PX4 VehicleStatus sample without publishing or calling services.

This proves only that a ROS 2 participant exposed the selected status topic at
capture time. It does not authenticate the flight controller or authorize
arming, Offboard mode, motion, or flight.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from uuid import uuid4

from collect import CollectionError, utc_now, write_output
from controller_state import canonical
from source_checkout import inspect_checkout

TOPIC = '/fmu/out/vehicle_status'
TYPE = 'px4_msgs/msg/VehicleStatus'
FIELDS = ('arming_state', 'nav_state', 'failsafe', 'pre_flight_checks_pass')


def build_observation(reader, source_checkout):
    publishers = reader.publishers(TOPIC)
    if len(publishers) != 1 or publishers[0]['type'] != TYPE:
        raise CollectionError('vehicle_status_publisher_missing_or_ambiguous:' + json.dumps(publishers))
    message = reader.once(TOPIC, TYPE)
    status = {}
    for field in FIELDS:
        if not hasattr(message, field):
            raise CollectionError('vehicle_status_field_missing:' + field)
        value = getattr(message, field)
        if type(value) not in (bool, int):
            raise CollectionError('vehicle_status_field_has_unsupported_type:' + field)
        status[field] = value
    observation = {
        'schemaVersion': 1,
        'kind': 'RlsokMiraVehicleStatus',
        'observedAt': utc_now(),
        'source': {
            'checkout': source_checkout,
            'topic': TOPIC,
            'messageType': TYPE,
            'environment': reader.environment(),
            'publisher': publishers[0],
        },
        'status': status,
    }
    observation['observationSha256'] = hashlib.sha256(canonical(observation).encode()).hexdigest()
    return observation


class Reader:
    def __enter__(self):
        import rclpy
        from rclpy.context import Context
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.qos import qos_profile_sensor_data
        from rclpy.utilities import get_rmw_implementation_identifier
        from rosidl_runtime_py.utilities import get_message
        import os
        self.rclpy, self.get_message = rclpy, get_message
        self.qos, self.rmw, self.os = qos_profile_sensor_data, get_rmw_implementation_identifier, os
        self.context = Context(); rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node('rlsok_mira_status_reader_' + uuid4().hex, context=self.context,
                enable_rosout=False, start_parameter_services=False, use_global_arguments=False)
            self.executor = SingleThreadedExecutor(context=self.context); self.executor.add_node(self.node)
        except Exception:
            self.context.shutdown(); raise
        self.deadline = time.monotonic() + 25
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
        pending = []
        while time.monotonic() < self.deadline:
            rows = self.node.get_publishers_info_by_topic(topic)
            if rows:
                if len(rows) > 32: raise CollectionError('too_many_vehicle_status_publishers')
                pending = sorted([{'node': r.node_namespace.rstrip('/') + '/' + r.node_name,
                    'type': r.topic_type, 'gid': bytes(r.endpoint_gid).hex()} for r in rows], key=lambda r: (r['node'], r['gid']))
                if all('_NODE_NAME_UNKNOWN_' not in row['node'] and
                       '_NODE_NAMESPACE_UNKNOWN_' not in row['node'] for row in pending):
                    return pending
            self.executor.spin_once(timeout_sec=0.1)
        return pending

    def once(self, topic, message_type):
        received = []
        subscription = self.node.create_subscription(self.get_message(message_type), topic, received.append, self.qos)
        try:
            while not received and time.monotonic() < self.deadline:
                self.executor.spin_once(timeout_sec=0.1)
            if len(received) != 1: raise CollectionError('vehicle_status_sample_timeout')
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
        print('OBSERVED | MIRA VehicleStatus read only | hardware dispatch: NO')
        return 0
    except Exception as error:
        print(f'mira_status_capture_failed:{type(error).__name__}:{error}', file=sys.stderr); return 2


if __name__ == '__main__': sys.exit(main())
