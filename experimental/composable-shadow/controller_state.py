#!/usr/bin/env python3
"""Export ROS controller state through ListControllers/ListParameters/GetParameters only.

No controller switching, parameter changes, action goals or motion publications.
This is a bounded read sequence, not an atomic or authenticated hardware snapshot.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from typing import Any
from uuid import uuid4
from collect import CollectionError, utc_now, write_output

NODE = re.compile(r"/(?:[A-Za-z_][A-Za-z0-9_]*/)*[A-Za-z_][A-Za-z0-9_]*\Z")
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")


def canonical(value: Any) -> str:
    # Parameter numbers are strings; controller metadata permits integral values only.
    def check(item):
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str): raise CollectionError("invalid state key")
                check(child)
        elif isinstance(item, (list, tuple)):
            for child in item: check(child)
        elif type(item) is int:
            if abs(item) > 9007199254740991: raise CollectionError("state integer outside portable range")
        elif item is not None and type(item) not in (str, bool):
            raise CollectionError("unsupported controller metadata value")
    check(value)
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    if len(encoded.encode()) > 2 * 1024 * 1024: raise CollectionError("controller export exceeds 2MiB")
    return encoded


def parameter_value(value: Any) -> dict[str, Any]:
    kind = int(value.type)
    def number(item):
        # ROS controllers use inf/-inf/nan as legitimate optional-limit defaults.
        # Keep their type and exact special value as text, never invalid JSON numbers.
        return repr(float(item))
    if kind == 0: data = None  # PARAMETER_NOT_SET is an observed state, not a guessed value.
    elif kind == 1: data = bool(value.bool_value)
    elif kind == 2: data = str(value.integer_value)
    elif kind == 3: data = number(value.double_value)
    elif kind == 4: data = str(value.string_value)
    elif kind == 5: data = [str(int(item) if isinstance(item, int) else int.from_bytes(item, 'little')) for item in value.byte_array_value]
    elif kind == 6: data = list(value.bool_array_value)
    elif kind == 7: data = [str(item) for item in value.integer_array_value]
    elif kind == 8: data = [number(item) for item in value.double_array_value]
    elif kind == 9: data = list(value.string_array_value)
    else: raise CollectionError("controller parameter has an unknown type")
    return {"type": kind, "value": data}


def select_controller(controllers: list[dict], name: str) -> dict | None:
    if len(controllers) > 256: raise CollectionError("too many controllers")
    matches = [controller for controller in controllers if controller.get('name') == name]
    if len(matches) > 1: raise CollectionError("duplicate selected controller")
    return matches[0] if matches else None


def export_state(reader: Any, manager: str, controller: str, node: str) -> dict:
    if not NODE.fullmatch(manager) or not NODE.fullmatch(node) or not NAME.fullmatch(controller):
        raise CollectionError("use absolute ROS node names and a controller basename")
    observed = utc_now()  # Start of the read sequence, never the time a saved file is re-read.
    first = select_controller(reader.controllers(manager), controller)
    parameters = reader.parameters(node) if first is not None else {}
    actions = reader.actions(node) if first is not None else []
    second = select_controller(reader.controllers(manager), controller)
    if canonical(first) != canonical(second): raise CollectionError("controller changed during export; retry the read")
    configuration = {"schemaVersion": 1, "source": {"controllerManager": manager, "controllerName": controller,
        "controllerNode": node, "environment": reader.environment()}, "controller": first, "parameters": parameters, "actionServers": actions}
    return {"schemaVersion": 1, "kind": "RlsokRosControllerState", "observedAt": observed,
            "configuration": configuration, "configurationSha256": hashlib.sha256(canonical(configuration).encode()).hexdigest()}


class RosStateReader:
    def __enter__(self):
        import rclpy
        from rclpy.context import Context
        from rclpy.executors import SingleThreadedExecutor
        from controller_manager_msgs.srv import ListControllers
        from rcl_interfaces.srv import ListParameters, GetParameters
        from rosidl_runtime_py.convert import message_to_ordereddict
        from rclpy.utilities import get_rmw_implementation_identifier
        self.rclpy, self.convert = rclpy, message_to_ordereddict
        self.list_controllers, self.list_parameters, self.get_parameters = ListControllers, ListParameters, GetParameters
        self.rmw = get_rmw_implementation_identifier
        self.context = Context()
        rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node('rlsok_controller_reader_' + uuid4().hex, context=self.context,
                                         enable_rosout=False, start_parameter_services=False, use_global_arguments=False)
            self.executor = SingleThreadedExecutor(context=self.context)
            self.executor.add_node(self.node)
        except Exception:
            self.context.shutdown()
            raise
        self.deadline = time.monotonic() + 25
        return self

    def __exit__(self, *_):
        try:
            self.executor.shutdown(timeout_sec=5)
            self.node.destroy_node()
        finally: self.context.shutdown()

    def environment(self):
        distro, domain = os.environ.get('ROS_DISTRO'), os.environ.get('ROS_DOMAIN_ID', '0')
        if not distro or not domain.isdigit() or not 0 <= int(domain) <= 232: raise CollectionError("invalid ROS environment")
        return {'rosDistro': distro, 'rmwImplementation': self.rmw(), 'domainId': int(domain)}

    def wait_for_server_node(self, endpoint):
        # Service readiness and per-node graph discovery can arrive separately.
        # Wait only for an absent graph entry; duplicates still fail immediately.
        while time.monotonic() < self.deadline:
            nodes = self.node.get_node_names_and_namespaces()
            if len(nodes) > 4096 or len(set(nodes)) != len(nodes): raise CollectionError("ambiguous ROS node identities")
            servers = sum(1 for name, namespace in nodes
                          if any(service == endpoint for service, _ in self.node.get_service_names_and_types_by_node(name, namespace)))
            if servers == 1: return
            if servers > 1: raise CollectionError(f"read-only service has multiple visible server nodes: {endpoint}")
            self.executor.spin_once(timeout_sec=min(0.1, max(0.0, self.deadline - time.monotonic())))
        raise CollectionError(f"read-only service has no visible server node before deadline: {endpoint}")

    def request(self, service_type, endpoint, request):
        client = self.node.create_client(service_type, endpoint)
        try:
            while time.monotonic() < self.deadline and not client.wait_for_service(timeout_sec=0.1): pass
            remaining = self.deadline - time.monotonic()
            if remaining <= 0: raise CollectionError(f"read-only service unavailable: {endpoint}")
            self.wait_for_server_node(endpoint)
            remaining = self.deadline - time.monotonic()
            if remaining <= 0: raise CollectionError(f"read-only service unavailable: {endpoint}")
            future = client.call_async(request)
            self.executor.spin_until_future_complete(future, timeout_sec=remaining)
            if not future.done() or future.cancelled(): raise CollectionError(f"read-only service timed out: {endpoint}")
            result = future.result()
            if result is None: raise CollectionError(f"read-only service failed: {endpoint}")
            return result
        finally:
            self.node.destroy_client(client)

    def controllers(self, manager):
        response = self.request(self.list_controllers, manager + '/list_controllers', self.list_controllers.Request())
        return [dict(self.convert(controller)) for controller in response.controller]

    def actions(self, node):
        from rclpy.action.graph import get_action_server_names_and_types_by_node
        namespace, name = node.rsplit('/', 1)
        graph = get_action_server_names_and_types_by_node(self.node, name, namespace or '/')
        if len(graph) > 128 or len({endpoint for endpoint, _ in graph}) != len(graph): raise CollectionError("ambiguous controller action graph")
        if any(len(types) != 1 for _, types in graph): raise CollectionError("ambiguous controller action types")
        return [{'endpoint': endpoint, 'type': types[0]} for endpoint, types in sorted(graph)]

    def parameters(self, node):
        request = self.list_parameters.Request(); request.depth = 0; request.prefixes = []
        names = list(self.request(self.list_parameters, node + '/list_parameters', request).result.names)
        if len(names) > 512 or len(set(names)) != len(names): raise CollectionError("invalid controller parameter name set")
        values = {}
        for offset in range(0, len(names), 64):
            batch = sorted(names)[offset:offset + 64]
            request = self.get_parameters.Request(); request.names = batch
            response = self.request(self.get_parameters, node + '/get_parameters', request)
            if len(response.values) != len(batch): raise CollectionError("incomplete controller parameter read")
            values.update({name: parameter_value(value) for name, value in zip(batch, response.values)})
        return values


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manager', required=True); parser.add_argument('--controller', required=True)
    parser.add_argument('--node', required=True); parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.output.exists(): raise CollectionError("output already exists; keep prior exports")
        with RosStateReader() as reader:
            result = export_state(reader, args.manager, args.controller, args.node)
        write_output(args.output, result)
        return 0
    except Exception as error:
        print(f"controller_export_failed: {type(error).__name__}: {error}", file=sys.stderr)
        return 2


if __name__ == '__main__': sys.exit(main())
