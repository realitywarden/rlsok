#!/usr/bin/env python3
"""Collect a local, read-only ROS 2 Shadow observation (Python 3.10+).

No action client, command publisher, message subscription or service request is created. Humble's
graph API counts *server nodes*, not multiple same-name servers inside one node.
This is a graph/file snapshot, not a hardware or remote implementation attestation.

Interface fingerprint v1: SHA-256 of UTF-8 JSON for typeTree, with sorted object
keys, separators (',', ':'), and ensure_ascii=True. Ordered field arrays preserve
wire field order. Message or Goal/Result/Feedback and every nested definition are
included, including array, sequence and string bounds. Comments, constants,
default values and implementation code are intentionally outside this fingerprint.

ROS API references:
https://github.com/ros2/rclpy/blob/jazzy/rclpy/rclpy/node.py
https://github.com/ros2/rclpy/blob/humble/rclpy/rclpy/action/graph.py
https://github.com/ros2/rosidl_runtime_py/blob/humble/rosidl_runtime_py/utilities.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import stat
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4


MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_PROFILE_BYTES = 1024 * 1024
MAX_DEFINITIONS = 512
MAX_INTERFACE_FIELDS = 8192
INTERFACE_ALGORITHM = "rosidl-action-fields-tree/v1"
ACTION_TYPE = re.compile(r"[a-z][a-z0-9_]*/action/[A-Z][A-Za-z0-9]*\Z")
MESSAGE_TYPE = re.compile(r"[a-z][a-z0-9_]*/msg/[A-Z][A-Za-z0-9]*\Z")
NODE_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
ENDPOINT = re.compile(r"/(?:[A-Za-z_][A-Za-z0-9_]*)(?:/[A-Za-z_][A-Za-z0-9_]*)*\Z")
TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})\Z")


class CollectionError(ValueError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def require_text(value: Any, label: str, maximum: int = 512) -> str:
    if (not isinstance(value, str) or not value or len(value) > maximum
            or value.strip() != value or re.search(r"[\x00-\x1f]", value)):
        raise CollectionError(f"{label}: expected a bounded, nonempty string without control characters")
    return value


def require_timestamp(value: Any) -> str:
    if not isinstance(value, str) or not TIMESTAMP.fullmatch(value):
        raise CollectionError("json_value requires an observedAt timestamp with a timezone")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise CollectionError("invalid observedAt timestamp") from error
    return value  # Keep the export's timestamp, including stale or future values.


def decode_json(data: bytes) -> Any:
    def unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise CollectionError("duplicate JSON object key")
            result[key] = value
        return result

    def invalid_constant(_value: str) -> Any:
        raise CollectionError("non-finite JSON number")

    try:
        return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique_pairs,
                          parse_constant=invalid_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise CollectionError("invalid UTF-8 JSON") from error


def json_pointer(document: Any, pointer: Any) -> str:
    if not isinstance(pointer, str) or (pointer and not pointer.startswith("/")):
        raise CollectionError("json_value requires an RFC 6901 pointer")
    current = document
    for token in pointer.split("/")[1:] if pointer else []:
        if re.search(r"~(?![01])", token):
            raise CollectionError("invalid JSON pointer escape")
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and token in current:
            current = current[token]
        elif isinstance(current, list) and re.fullmatch(r"0|[1-9][0-9]*", token):
            try:
                current = current[int(token)]
            except (IndexError, ValueError) as error:
                raise CollectionError("JSON pointer is missing") from error
        else:
            raise CollectionError("JSON pointer is missing")
    if not isinstance(current, str):
        raise CollectionError("json_value selected value must be a string")
    return require_text(current, "json_value selected value")


def relative_parts(value: Any) -> tuple[str, ...]:
    value = require_text(value, "fact.path", 1024)
    # Portable paths also reject Windows drives, ADS, UNC and separators on POSIX.
    if "\\" in value or ":" in value or "\x00" in value:
        raise CollectionError("fact.path must be a portable relative path")
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or PureWindowsPath(value).is_absolute():
        raise CollectionError("fact.path must stay within the profile directory")
    if not candidate.parts or any(part == ".." for part in candidate.parts):
        raise CollectionError("fact.path must stay within the profile directory")
    return candidate.parts


def _is_link(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    )


def _checked_path(root: Path, parts: tuple[str, ...]) -> Path:
    current = root
    for part in parts:
        current = current / part
        if _is_link(current.lstat()):
            raise CollectionError("fact path contains a symlink or reparse point")
    try:
        current.resolve(strict=True).relative_to(root)
    except ValueError as error:
        raise CollectionError("fact path escapes the profile directory") from error
    return current


def _windows_descriptor_path(fd: int) -> Path:
    # Verify the actual opened object, closing the Windows path-check/open race.
    import ctypes
    import msvcrt
    from ctypes import wintypes

    get_path = ctypes.WinDLL("kernel32", use_last_error=True).GetFinalPathNameByHandleW
    get_path.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    get_path.restype = wintypes.DWORD
    buffer = ctypes.create_unicode_buffer(32768)
    length = get_path(msvcrt.get_osfhandle(fd), buffer, len(buffer), 0)
    if not length or length >= len(buffer):
        raise CollectionError("cannot verify opened fact path")
    result = buffer.value
    if result.startswith("\\\\?\\UNC\\"):
        result = "\\\\" + result[8:]
    elif result.startswith("\\\\?\\"):
        result = result[4:]
    return Path(result)


def read_fact_bytes(root: Path, relative: str, limit: int = MAX_FILE_BYTES) -> bytes:
    root = root.resolve(strict=True)
    parts = relative_parts(relative)
    descriptors: list[int] = []
    try:
        checked = _checked_path(root, parts)
        if os.open in os.supports_dir_fd and hasattr(os, "O_NOFOLLOW"):
            directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            directory_fd = os.open(root, directory_flags)
            descriptors.append(directory_fd)
            for part in parts[:-1]:
                directory_fd = os.open(part, directory_flags, dir_fd=directory_fd)
                descriptors.append(directory_fd)
            fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=directory_fd)
        else:
            fd = os.open(checked, os.O_RDONLY | getattr(os, "O_BINARY", 0))
        descriptors.append(fd)
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise CollectionError("fact path must be a regular file")
        if os.name == "nt":
            opened = _windows_descriptor_path(fd)
            try:
                opened.relative_to(root)
            except ValueError as error:
                raise CollectionError("opened fact path escapes the profile directory") from error
            if opened != checked:
                raise CollectionError("fact path changed during opening")
        elif os.open not in os.supports_dir_fd or not hasattr(os, "O_NOFOLLOW"):
            raise CollectionError("this platform cannot securely open fact files")
        if before.st_size > limit:
            raise CollectionError(f"fact file exceeds {limit} bytes")
        chunks: list[bytes] = []
        length = 0
        while length <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - length))
            if not chunk:
                break
            chunks.append(chunk)
            length += len(chunk)
        if length > limit:
            raise CollectionError(f"fact file exceeds {limit} bytes")
        after = os.fstat(fd)
        if (before.st_size, before.st_mtime_ns, before.st_ino, before.st_dev) != (
            after.st_size, after.st_mtime_ns, after.st_ino, after.st_dev
        ):
            raise CollectionError("fact file changed during collection")
        # Also catch a file or directory swapped for a link while reading.
        latest = _checked_path(root, parts).stat()
        if (latest.st_ino, latest.st_dev) != (after.st_ino, after.st_dev):
            raise CollectionError("fact file was replaced during collection")
        return b"".join(chunks)
    except OSError as error:
        raise CollectionError(f"cannot read fact file ({error.__class__.__name__})") from error
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def collect_fact(fact: dict[str, Any], root: Path, now: Callable[[], str]) -> dict[str, Any]:
    fact_id = require_text(fact.get("id"), "fact.id")
    kind = fact.get("kind")
    try:
        data = read_fact_bytes(root, fact.get("path"))
        if kind == "file_sha256":
            value, observed_at = hashlib.sha256(data).hexdigest(), now()
        elif kind == "json_value":
            document = decode_json(data)
            if not isinstance(document, dict):
                raise CollectionError("json_value export must be an object")
            observed_at = require_timestamp(document.get("observedAt"))
            value = json_pointer(document, fact.get("pointer"))
        else:
            raise CollectionError("unsupported fact kind")
        return {"id": fact_id, "kind": kind, "value": value, "observedAt": observed_at}
    except CollectionError as error:
        raise CollectionError(f"fact {fact_id}: {error}") from error


def describe_interface(action_type: str, get_action: Callable, get_message: Callable) -> dict[str, Any]:
    if not isinstance(action_type, str) or not (ACTION_TYPE.fullmatch(action_type) or MESSAGE_TYPE.fullmatch(action_type)):
        raise CollectionError("interface type must be package/action/Type or package/msg/Type")
    definitions: dict[str, Any] = {}
    field_count = 0

    def message(name: str, message_class: Any, depth: int) -> dict[str, str]:
        nonlocal field_count
        if name in definitions:
            return {"kind": "message", "name": name}
        if depth > 64 or len(definitions) >= MAX_DEFINITIONS:
            raise CollectionError("interface definition tree is too large")
        names = list(message_class.get_fields_and_field_types())
        slots = message_class.SLOT_TYPES
        if len(names) != len(slots) or len(set(names)) != len(names):
            raise CollectionError("inconsistent generated ROS field metadata")
        field_count += len(names)
        if field_count > MAX_INTERFACE_FIELDS:
            raise CollectionError("interface contains too many fields")
        definitions[name] = {"fields": []}
        definitions[name]["fields"] = [
            {"name": require_text(field, "interface field"), "type": slot_type(slot, depth + 1)}
            for field, slot in zip(names, slots)
        ]
        return {"kind": "message", "name": name}

    def slot_type(slot: Any, depth: int) -> dict[str, Any]:
        if depth > 64:
            raise CollectionError("interface definition tree is too deep")
        kind = type(slot).__name__
        if kind == "BasicType":
            return {"kind": "primitive", "name": slot.typename}
        if kind == "NamespacedType":
            name = "/".join((*slot.namespaces, slot.name))
            return message(name, get_message(name), depth)
        if kind in ("Array", "BoundedSequence", "UnboundedSequence"):
            result = {"kind": "array" if kind == "Array" else "sequence",
                      "element": slot_type(slot.value_type, depth + 1)}
            if kind == "Array":
                result["size"] = slot.size
            else:
                result["maximumSize"] = slot.maximum_size if kind == "BoundedSequence" else None
            return result
        if kind in ("BoundedString", "UnboundedString", "BoundedWString", "UnboundedWString"):
            return {"kind": "wstring" if "WString" in kind else "string",
                    "maximumSize": slot.maximum_size if kind.startswith("Bounded") else None}
        raise CollectionError(f"unsupported ROS field metadata: {kind}")

    is_message = MESSAGE_TYPE.fullmatch(action_type) is not None
    if is_message:
        tree = {"algorithm": "rosidl-message-fields-tree/v1", "messageType": action_type,
                "components": {"Message": message(action_type, get_message(action_type), 0)},
                "definitions": definitions}
    else:
        action = get_action(action_type)
        tree = {"algorithm": INTERFACE_ALGORITHM, "actionType": action_type,
                "components": {component: message(f"{action_type}_{component}", getattr(action, component), 0)
                               for component in ("Goal", "Result", "Feedback")},
                "definitions": definitions}
    encoded = json.dumps(tree, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                         allow_nan=False).encode("utf-8")
    return {"messageType" if is_message else "actionType": action_type, "interfaceSha256": hashlib.sha256(encoded).hexdigest(),
            "typeTree": tree}


class RosInterfaces:
    def __init__(self) -> None:
        try:
            from rosidl_runtime_py.utilities import get_action, get_message
        except ImportError as error:
            raise CollectionError("ROS interface runtime unavailable; source ROS 2 and the interface workspace") from error
        self.get_action, self.get_message = get_action, get_message

    def describe(self, action_type: str) -> dict[str, Any]:
        return describe_interface(action_type, self.get_action, self.get_message)


class RosGraphProvider:
    """Only graph inspection; no action clients or remote service calls."""

    def __init__(self, discovery_seconds: float = 3.0) -> None:
        if not math.isfinite(discovery_seconds) or not 0.1 <= discovery_seconds <= 30:
            raise CollectionError("discovery-seconds must be between 0.1 and 30")
        self.discovery_seconds = discovery_seconds
        self.node = None
        self.executor = None
        self.graph_ready = False

    def __enter__(self) -> RosGraphProvider:
        try:
            import rclpy
            from rclpy.action.graph import get_action_server_names_and_types_by_node
            from rclpy.context import Context
            from rclpy.executors import SingleThreadedExecutor
            from rclpy.utilities import get_rmw_implementation_identifier
        except ImportError as error:
            raise CollectionError("ROS 2 unavailable; source the ROS 2 installation before collecting") from error

        self.rclpy = rclpy
        self.context = Context()
        self.server_query = get_action_server_names_and_types_by_node
        self.rmw_identifier = get_rmw_implementation_identifier
        self.interfaces = RosInterfaces()
        rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node(
                f"rlsok_shadow_observer_{uuid4().hex}", context=self.context,
                use_global_arguments=False, enable_rosout=False, start_parameter_services=False,
            )
            self.executor = SingleThreadedExecutor(context=self.context)
            self.executor.add_node(self.node)
        except Exception:
            self.__exit__()
            raise
        return self

    def __exit__(self, *_exc: Any) -> None:
        try:
            try:
                if self.executor is not None:
                    self.executor.shutdown(timeout_sec=5.0)
            finally:
                if self.node is not None:
                    self.node.destroy_node()
        finally:
            self.context.shutdown()

    def environment(self) -> dict[str, Any]:
        distro = require_text(os.environ.get("ROS_DISTRO"), "actual ROS_DISTRO")
        domain = os.environ.get("ROS_DOMAIN_ID", "0")
        if not re.fullmatch(r"[0-9]{1,10}", domain):
            raise CollectionError("actual ROS_DOMAIN_ID must be a nonnegative integer")
        if not 0 <= int(domain) <= 232:
            raise CollectionError("actual ROS_DOMAIN_ID must be between 0 and 232")
        return {"rosDistro": distro, "rmwImplementation": require_text(
            self.rmw_identifier(), "actual RMW implementation"), "domainId": int(domain)}

    def action_servers(self, endpoints: set[str] | None) -> dict[str, tuple[str, int]]:
        deadline = time.monotonic() + self.discovery_seconds
        while time.monotonic() < deadline:
            self.executor.spin_once(timeout_sec=min(0.1, max(0.0, deadline - time.monotonic())))
        self.graph_ready = True
        nodes = self.node.get_node_names_and_namespaces()
        if len(nodes) > 4096 or len(set(nodes)) != len(nodes):
            raise CollectionError("ROS graph node identities are ambiguous or excessive")
        servers: dict[str, list[str]] = {endpoint: [] for endpoint in endpoints or set()}
        for name, namespace in nodes:
            # Any per-node query failure fails collection rather than hiding a server.
            seen: set[str] = set()
            for endpoint, types in self.server_query(self.node, name, namespace):
                if endpoints is not None and endpoint not in endpoints:
                    continue
                if not ENDPOINT.fullmatch(endpoint) or any(not ACTION_TYPE.fullmatch(value) for value in types):
                    raise CollectionError("invalid action graph name or type")
                if endpoint in seen or len(types) != 1:
                    raise CollectionError("action server graph has ambiguous types or entries")
                seen.add(endpoint)
                servers.setdefault(endpoint, []).append(types[0])
                if endpoints is None and len(servers) > 128:
                    raise CollectionError("catalog exceeds 128 endpoints; use a smaller isolated ROS domain")
        result: dict[str, tuple[str, int]] = {}
        for endpoint, types in servers.items():
            if len(set(types)) > 1:
                raise CollectionError(f"action endpoint has conflicting types: {endpoint}")
            if types:
                result[endpoint] = (types[0], len(types))
        return result

    def topic_subscribers(self, endpoints: set[str] | None) -> dict[str, dict[str, Any]]:
        if not self.graph_ready:
            deadline = time.monotonic() + self.discovery_seconds
            while time.monotonic() < deadline:
                self.executor.spin_once(timeout_sec=min(0.1, max(0.0, deadline - time.monotonic())))
            self.graph_ready = True
        nodes = self.node.get_node_names_and_namespaces()
        if len(nodes) > 4096 or len(nodes) != len(set(nodes)):
            raise CollectionError("ROS graph node identities are ambiguous or excessive")
        result: dict[str, dict[str, Any]] = {}
        for endpoint, types in self.node.get_topic_names_and_types():
            if endpoints is not None and endpoint not in endpoints:
                continue
            if not ENDPOINT.fullmatch(endpoint):
                raise CollectionError("invalid topic endpoint")
            if endpoint in result or len(types) != 1 or not MESSAGE_TYPE.fullmatch(types[0]):
                raise CollectionError("topic graph has ambiguous types or entries")
            if len(result) >= 128:
                raise CollectionError("catalog exceeds 128 topics; use a smaller isolated ROS domain")
            subscribers: dict[tuple[str, str], int] = {}
            infos = self.node.get_subscriptions_info_by_topic(endpoint)
            if len(infos) > 4096:
                raise CollectionError("too many topic subscriptions")
            for info in infos:
                name, namespace = info.node_name, info.node_namespace
                if (not NODE_NAME.fullmatch(name) or (namespace != "/" and not ENDPOINT.fullmatch(namespace))
                        or info.topic_type != types[0]):
                    raise CollectionError("invalid or conflicting subscription metadata")
                identity = (name, namespace)
                subscribers[identity] = subscribers.get(identity, 0) + 1
            result[endpoint] = {"messageType": types[0], "subscribers": [
                {"name": name, "namespace": namespace, "count": count}
                for (name, namespace), count in sorted(subscribers.items())]}
        return result


def discover_interfaces(provider: Any) -> dict[str, Any]:
    environment = provider.environment()
    graph = provider.action_servers(None)
    observed_at = utc_now()
    descriptions: dict[str, dict[str, Any]] = {}
    actions: list[dict[str, Any]] = []
    for endpoint, (action_type, count) in sorted(graph.items()):
        if action_type not in descriptions:
            try:
                description = provider.interfaces.describe(action_type)
                descriptions[action_type] = {key: description[key] for key in ("interfaceSha256", "typeTree")}
            except Exception:
                # A missing installed definition is visible but cannot be selected.
                # Do not expose exception details that could contain local paths.
                descriptions[action_type] = {"unavailable": "Installed action definition could not be read. Source its interface workspace and rediscover."}
        actions.append({"endpoint": endpoint, "actionType": action_type,
                        "serverCount": count, **descriptions[action_type]})
    topics = []
    for endpoint, metadata in sorted(provider.topic_subscribers(None).items()):
        message_type = metadata["messageType"]
        if message_type not in descriptions:
            try:
                description = provider.interfaces.describe(message_type)
                descriptions[message_type] = {key: description[key] for key in ("interfaceSha256", "typeTree")}
            except Exception:
                descriptions[message_type] = {"unavailable": "Installed message definition could not be read. Source its interface workspace and rediscover."}
        topics.append({"endpoint": endpoint, **metadata, **descriptions[message_type]})
    catalog = {"schemaVersion": 1, "kind": "RlsokInterfaceCatalog", "collector": "ros2-read-only/v1",
               "observedAt": observed_at, "environment": environment, "actions": actions, "topics": topics,
               "limitations": ["Local graph metadata only; not hardware identity or remote implementation attestation.",
                               "Counts visible server nodes; same-name servers inside one node cannot be distinguished.",
                               "No action client, command publisher or service request is created.",
                               "Installed definitions do not establish units, command semantics or physical compatibility."]}
    if len(json.dumps(catalog, indent=2, ensure_ascii=True).encode("utf-8")) > 1024 * 1024:
        raise CollectionError("catalog exceeds 1 MiB; reduce the isolated graph/interface size")
    return catalog


def validate_profile(profile: Any) -> dict[str, Any]:
    if (not isinstance(profile, dict) or type(profile.get("schemaVersion")) is not int
            or profile["schemaVersion"] != 1 or profile.get("mode") != "shadow"):
        raise CollectionError("profile must be schemaVersion 1, mode shadow")
    require_text(profile.get("id"), "profile.id")
    for key, limit in (("facts", 64), ("paths", 32)):
        entries = profile.get(key)
        if not isinstance(entries, list) or not entries or len(entries) > limit:
            raise CollectionError(f"profile.{key} must have 1 to {limit} entries")
        ids = [require_text(entry.get("id"), f"{key}.id") if isinstance(entry, dict)
               else None for entry in entries]
        if None in ids or len(ids) != len(set(ids)):
            raise CollectionError(f"profile.{key} has invalid or duplicate ids")
    for fact in profile["facts"]:
        relative_parts(fact.get("path"))
        if fact.get("kind") not in ("file_sha256", "json_value"):
            raise CollectionError("unsupported fact kind")
    for path in profile["paths"]:
        if not ENDPOINT.fullmatch(require_text(path.get("endpoint"), "path.endpoint")):
            raise CollectionError("action endpoint must be a fully qualified ROS name")
        if path.get("adapter") == "topic_twist":
            if path.get("messageType") not in ("geometry_msgs/msg/Twist", "geometry_msgs/msg/TwistStamped"):
                raise CollectionError("unsupported topic message semantics")
            node = path.get("subscriber", {})
            if (not isinstance(node, dict) or not NODE_NAME.fullmatch(require_text(node.get("name"), "subscriber.name"))
                    or (node.get("namespace") != "/" and not ENDPOINT.fullmatch(require_text(node.get("namespace"), "subscriber.namespace")))):
                raise CollectionError("invalid subscriber identity")
        elif not ACTION_TYPE.fullmatch(require_text(path.get("actionType"), "path.actionType")):
            raise CollectionError("actionType must be package/action/Type")
    if len({path["endpoint"] for path in profile["paths"]}) != len(profile["paths"]):
        raise CollectionError("profile.paths has duplicate endpoints")
    return profile


def collect_observation(profile: dict[str, Any], root: Path, provider: Any,
                        now: Callable[[], str] = utc_now) -> dict[str, Any]:
    validate_profile(profile)
    environment = provider.environment()
    action_endpoints = {path["endpoint"] for path in profile["paths"] if path.get("adapter") != "topic_twist"}
    topic_endpoints = {path["endpoint"] for path in profile["paths"] if path.get("adapter") == "topic_twist"}
    graph = provider.action_servers(action_endpoints) if action_endpoints else {}
    topics = provider.topic_subscribers(topic_endpoints) if topic_endpoints else {}
    graph_observed_at = now()
    paths: list[dict[str, Any]] = []
    for path in profile["paths"]:
        if path.get("adapter") == "topic_twist":
            metadata = topics.get(path["endpoint"])
            if metadata is None:
                raise CollectionError(f"topic not observed: {path['id']}")
            target = path["subscriber"]
            matches = [node for node in metadata["subscribers"] if node["name"] == target["name"] and node["namespace"] == target["namespace"]]
            count = sum(node["count"] for node in matches)
            description = provider.interfaces.describe(metadata["messageType"])
            paths.append({"id": path["id"], "endpoint": path["endpoint"], "messageType": metadata["messageType"],
                          "interfaceSha256": description["interfaceSha256"], "subscriber": target, "subscriberCount": count})
            continue
        if path["endpoint"] not in graph:
            raise CollectionError(f"action server not observed: {path['id']}")
        actual_type, count = graph[path["endpoint"]]
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise CollectionError(f"invalid action server count: {path['id']}")
        description = provider.interfaces.describe(actual_type)
        paths.append({"id": path["id"], "endpoint": path["endpoint"], "actionType": actual_type,
                      "interfaceSha256": description["interfaceSha256"], "serverCount": count})
    facts = [collect_fact(fact, root, now) for fact in profile["facts"]]
    return {"schemaVersion": 1, "profileId": profile["id"], "observedAt": graph_observed_at,
            "collector": "ros2-read-only/v1", "environment": environment, "facts": facts, "paths": paths}


def write_output(path: Path, observation: dict[str, Any]) -> None:
    if path.is_symlink() or (path.exists() and _is_link(path.lstat())):
        raise CollectionError("output must not be a symlink or reparse point")
    content = (json.dumps(observation, indent=2, ensure_ascii=True, allow_nan=False) + "\n").encode("utf-8")
    descriptor, temporary = tempfile.mkstemp(prefix=".shadow-observation-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        # Atomic creation without replacing prior evidence, including a file
        # another process created after the CLI's initial existence check.
        os.link(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def fingerprint_controller(document: Any) -> dict[str, Any]:
    """Normalize an operator's active-state export; never read a profile.

    This validates an export's shape, not the truth/completeness of controller
    observations. The exporter must bind selected IDs and all active parameters.
    """
    if not isinstance(document, dict) or document.get("schemaVersion") != 1:
        raise CollectionError("controller export requires schemaVersion 1")
    observed_at = require_timestamp(document.get("observedAt"))
    software = require_text(document.get("controllerSoftware"), "controllerSoftware")
    revision = require_text(document.get("stackRevision"), "stackRevision")
    source = require_text(document.get("source"), "source")
    if document.get("activeStateReadOnly") is not True:
        raise CollectionError("exporter must declare activeStateReadOnly: true")

    def fingerprint(name: str) -> str:
        state = document.get(name)
        if not isinstance(state, dict) or set(state) != {"selectedId", "parameters"}:
            raise CollectionError(f"{name} requires selectedId and complete parameters")
        selected = state["selectedId"]
        if not ((type(selected) is int and selected >= 0) or isinstance(selected, str)):
            raise CollectionError(f"{name}.selectedId must be a nonnegative integer or string")
        if isinstance(selected, str):
            require_text(selected, f"{name}.selectedId")
        if not isinstance(state["parameters"], dict) or not state["parameters"]:
            raise CollectionError(f"{name}.parameters must be a nonempty object including units/conventions")
        encoded = json.dumps(state, sort_keys=True, separators=(",", ":"),
                             ensure_ascii=True, allow_nan=False).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    return {"observedAt": observed_at, "controllerSoftware": software,
            "stackRevision": revision, "source": source,
            "fingerprintAlgorithm": "selected-state-python-json/v1",
            "toolConfigurationSha256": fingerprint("tool"),
            "frameConfigurationSha256": fingerprint("frame")}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument("--profile", type=Path)
    operation.add_argument("--describe-interface", metavar="PACKAGE/ACTION/TYPE")
    operation.add_argument("--fingerprint-controller", type=Path)
    operation.add_argument("--discover", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--discovery-seconds", type=float, default=3.0)
    args = parser.parse_args(argv)
    if (args.profile is not None or args.fingerprint_controller is not None or args.discover) and args.output is None:
        parser.error("--profile / --fingerprint-controller / --discover requires --output")
    if args.describe_interface and args.output is not None:
        parser.error("--describe-interface writes JSON to stdout; omit --output")
    try:
        if args.discover:
            with RosGraphProvider(args.discovery_seconds) as provider:
                catalog = discover_interfaces(provider)
            write_output(args.output, catalog)
            return 0
        if args.describe_interface:
            print(json.dumps(RosInterfaces().describe(args.describe_interface), indent=2, sort_keys=True))
            return 0
        if args.fingerprint_controller is not None:
            source = args.fingerprint_controller.absolute()
            document = decode_json(read_fact_bytes(source.parent, source.name))
            write_output(args.output, fingerprint_controller(document))
            return 0
        profile_path = args.profile.resolve(strict=True)
        profile = validate_profile(decode_json(read_fact_bytes(
            profile_path.parent, profile_path.name, MAX_PROFILE_BYTES)))
        protected = {profile_path}
        protected.update(profile_path.parent.joinpath(*relative_parts(fact["path"])).resolve()
                         for fact in profile["facts"])
        if args.output.resolve() in protected:
            raise CollectionError("output must not overwrite the profile or a fact source")
        with RosGraphProvider(args.discovery_seconds) as provider:
            observation = collect_observation(profile, profile_path.parent, provider)
        write_output(args.output, observation)
        return 0
    except Exception as error:
        # Never emit a success-shaped observation after a missing/failed read.
        print(f"collection_failed: {error.__class__.__name__}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
