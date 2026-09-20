#!/usr/bin/env python3
"""Observe Ishan's warehouse Gazebo command boundary without publishing.

The reader verifies that one ros_gz parameter bridge subscribes to /cmd_vel
and publishes /odom, then records one existing odometry sample.  It never
creates a publisher, sends Twist, launches Gazebo, or calls a service.  This
is evidence about an already-running simulation, not physical robot evidence.
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

CMD_TOPIC = '/cmd_vel'
CMD_TYPE = 'geometry_msgs/msg/Twist'
ODOM_TOPIC = '/odom'
ODOM_TYPE = 'nav_msgs/msg/Odometry'
# ros_gz_bridge's Humble / Fortress parameter_bridge executable reports its
# graph node as /ros_gz_bridge.  The executable name is not the node name.
BRIDGE_NODE = '/ros_gz_bridge'
UNKNOWN_RMW_NODE = '/_NODE_NAMESPACE_UNKNOWN_/_NODE_NAME_UNKNOWN_'
OBSERVER_VERSION = '4'


def finite(value, label):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise CollectionError('ishan_gazebo_non_finite_value:' + label)
    return repr(float(value))


def endpoint(reader, direction, topic, message_type):
    rows = getattr(reader, direction)(topic)
    if len(rows) != 1 or rows[0]['type'] != message_type:
        raise CollectionError(
            'ishan_gazebo_endpoint_missing_or_ambiguous:'
            + direction + ':' + topic + ':' + json.dumps(rows)
        )
    node = rows[0]['node']
    if node not in (BRIDGE_NODE, UNKNOWN_RMW_NODE):
        raise CollectionError(
            'ishan_gazebo_unexpected_bridge:' + direction + ':' + node
        )
    result = dict(rows[0])
    # Fast DDS may expose a valid ros_gz_bridge endpoint without participant
    # node metadata. Preserve that uncertainty instead of inventing a node
    # identity or rejecting the otherwise unique, correctly typed endpoint.
    result['nodeIdentity'] = (
        'middleware_unknown' if node == UNKNOWN_RMW_NODE else 'verified'
    )
    return result


def stamp(message):
    value = message.header.stamp
    if type(value.sec) is not int or type(value.nanosec) is not int:
        raise CollectionError('ishan_gazebo_invalid_message_stamp')
    return {'sec': value.sec, 'nanosec': value.nanosec}


def build_observation(reader, source_checkout):
    command_subscriber = endpoint(reader, 'subscribers', CMD_TOPIC, CMD_TYPE)
    odometry_publisher = endpoint(reader, 'publishers', ODOM_TOPIC, ODOM_TYPE)
    odom = reader.once(ODOM_TOPIC, ODOM_TYPE)
    if odom.header.frame_id != 'odom' or not odom.child_frame_id:
        raise CollectionError('ishan_gazebo_unexpected_odometry_frames')

    pose, twist = odom.pose.pose, odom.twist.twist
    result = {
        'schemaVersion': 1,
        'kind': 'RlsokIshanWarehouseGazeboStatus',
        'observerVersion': OBSERVER_VERSION,
        'observedAt': utc_now(),
        'sourceCommit': source_checkout['commit'],
        'sourceCheckout': source_checkout,
        'source': {
            'repository': 'ishan-xy/ros_mobile_robot',
            'environment': reader.environment(),
            'commandBoundary': {
                'topic': CMD_TOPIC,
                'messageType': CMD_TYPE,
                'subscriber': command_subscriber,
            },
            'odometry': {
                'topic': ODOM_TOPIC,
                'messageType': ODOM_TYPE,
                'publisher': odometry_publisher,
            },
        },
        'odometryStamp': stamp(odom),
        'frames': {'odometry': odom.header.frame_id, 'body': odom.child_frame_id},
        'odometry': {
            'position': {
                key: finite(getattr(pose.position, key), 'position.' + key)
                for key in ('x', 'y', 'z')
            },
            'orientation': {
                key: finite(getattr(pose.orientation, key), 'orientation.' + key)
                for key in ('x', 'y', 'z', 'w')
            },
            'linearVelocity': {
                key: finite(getattr(twist.linear, key), 'linear_velocity.' + key)
                for key in ('x', 'y', 'z')
            },
            'angularVelocity': {
                key: finite(getattr(twist.angular, key), 'angular_velocity.' + key)
                for key in ('x', 'y', 'z')
            },
        },
        'dispatch': {
            'rlsokPublishersCreated': 0,
            'rlsokCommandsSent': 0,
            'note': 'Graph discovery and one odometry subscription only.',
        },
    }
    result['observationSha256'] = hashlib.sha256(canonical(result).encode()).hexdigest()
    return result


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
        self.context = Context()
        rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node(
                'rlsok_ishan_gazebo_reader_' + uuid4().hex,
                context=self.context,
                enable_rosout=False,
                start_parameter_services=False,
                use_global_arguments=False,
            )
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
        distro = self.os.environ.get('ROS_DISTRO')
        domain = self.os.environ.get('ROS_DOMAIN_ID', '0')
        if not distro or not domain.isdigit() or not 0 <= int(domain) <= 232:
            raise CollectionError('invalid ROS environment')
        return {
            'rosDistro': distro,
            'rmwImplementation': self.rmw(),
            'domainId': int(domain),
        }

    @staticmethod
    def _rows(values):
        return sorted([
            {
                'node': value.node_namespace.rstrip('/') + '/' + value.node_name,
                'type': value.topic_type,
                'gid': bytes(value.endpoint_gid).hex(),
            }
            for value in values
        ], key=lambda row: (row['node'], row['gid']))

    def _endpoints(self, method, topic):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            values = method(topic)
            if values:
                if len(values) > 32:
                    raise CollectionError('too_many_ishan_gazebo_endpoints:' + topic)
                return self._rows(values)
            self.executor.spin_once(timeout_sec=0.1)
        return []

    def subscribers(self, topic):
        return self._endpoints(self.node.get_subscriptions_info_by_topic, topic)

    def publishers(self, topic):
        return self._endpoints(self.node.get_publishers_info_by_topic, topic)

    def once(self, topic, message_type):
        received = []
        deadline = time.monotonic() + 20
        subscription = self.node.create_subscription(
            self.get_message(message_type), topic, received.append, self.qos
        )
        try:
            while not received and time.monotonic() < deadline:
                self.executor.spin_once(timeout_sec=0.1)
            if len(received) != 1:
                raise CollectionError('ishan_gazebo_odometry_timeout')
            return received[0]
        finally:
            self.node.destroy_subscription(subscription)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', action='version', version=OBSERVER_VERSION)
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise CollectionError('output_already_exists')
        source_checkout = inspect_checkout(args.source_root)
        with Reader() as reader:
            result = build_observation(reader, source_checkout)
        write_output(args.output, result)
        print('OBSERVED | Ishan warehouse Gazebo boundary read only | hardware dispatch: NO')
        return 0
    except Exception as error:
        print(
            f'ishan_gazebo_status_capture_failed:{type(error).__name__}:{error}',
            file=sys.stderr,
        )
        return 2


if __name__ == '__main__':
    sys.exit(main())
