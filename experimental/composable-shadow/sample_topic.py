#!/usr/bin/env python3
"""Read one explicitly selected ROS 2 topic message for local setup only.

This is separate from the graph-only evidence collector. It creates one
subscription but never a publisher, action client, or service client. A sample
is not proof of physical meaning, units, receiver identity, or hardware state.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import sys
import time
from uuid import uuid4

from collect import ENDPOINT, MESSAGE_TYPE, describe_interface


def sample_once(topic: str, message_type: str, fingerprint: str, seconds: float) -> dict:
    if not ENDPOINT.fullmatch(topic) or not MESSAGE_TYPE.fullmatch(message_type):
        raise ValueError("invalid_topic_or_message_type")
    if len(fingerprint) != 64 or any(char not in "0123456789abcdef" for char in fingerprint):
        raise ValueError("invalid_interface_fingerprint")
    if not 0.1 <= seconds <= 10:
        raise ValueError("sample_timeout_out_of_range")
    try:
        import rclpy
        from rclpy.context import Context
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.qos import qos_profile_sensor_data
        from rosidl_runtime_py.convert import message_to_ordereddict
        from rosidl_runtime_py.utilities import get_action, get_message
    except ImportError as error:
        raise ValueError("ros2_sample_runtime_unavailable: source ROS 2 and the selected interface workspace") from error

    description = describe_interface(message_type, get_action, get_message)
    if description["interfaceSha256"] != fingerprint:
        raise ValueError("installed_message_definition_changed_since_discovery")
    context = Context()
    rclpy.init(context=context)
    node = None
    executor = None
    try:
        node = rclpy.create_node("rlsok_local_sample_" + uuid4().hex[:12], context=context)
        executor = SingleThreadedExecutor(context=context)
        executor.add_node(node)
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            types = [types for name, types in node.get_topic_names_and_types() if name == topic]
            if types:
                if len(types) != 1 or types[0] != [message_type]:
                    raise ValueError("live_topic_type_changed_since_discovery")
                break
            executor.spin_once(timeout_sec=min(0.1, max(0, deadline - time.monotonic())))
        else:
            raise ValueError("selected_topic_not_visible_in_live_graph")

        received = []
        subscription = node.create_subscription(get_message(message_type), topic,
                                                lambda message: received.append(message), qos_profile_sensor_data)
        try:
            while time.monotonic() < deadline and not received:
                executor.spin_once(timeout_sec=min(0.1, max(0, deadline - time.monotonic())))
            if not received:
                raise ValueError("no_message_received: check publisher, QoS or timeout; enter an example manually")
            payload = dict(message_to_ordereddict(received[0]))
            result = {"schemaVersion": 1, "kind": "RlsokLocalTopicSample", "topic": topic,
                      "messageType": message_type, "interfaceSha256": fingerprint,
                      "observedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                      "payload": payload}
            encoded = json.dumps(result, ensure_ascii=True, allow_nan=False).encode("utf-8")
            if len(encoded) > 1024 * 1024:
                raise ValueError("sample_exceeds_1MiB")
            return result
        finally:
            node.destroy_subscription(subscription)
    finally:
        if executor is not None:
            executor.shutdown()
        if node is not None:
            node.destroy_node()
        context.shutdown()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--topic", required=True)
    parser.add_argument("--message-type", required=True)
    parser.add_argument("--interface-sha256", required=True)
    parser.add_argument("--timeout-seconds", type=float, default=4.0)
    args = parser.parse_args()
    try:
        print(json.dumps(sample_once(args.topic, args.message_type, args.interface_sha256,
                                     args.timeout_seconds), ensure_ascii=True, allow_nan=False))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
