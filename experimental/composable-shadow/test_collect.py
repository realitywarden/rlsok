"""stdlib tests; ROS providers and generated message metadata are simulated."""

from __future__ import annotations

import ast
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("shadow_collect", HERE / "collect.py")
collect = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collect)
NOW = "2026-09-05T12:00:00.000Z"
OLD = "2026-09-01T10:00:00+08:00"
ACTION = "custom_msgs/action/MovePose"


def slot(kind, **values):
    return type(kind, (), values)()


def message(fields):
    return type("FakeMessage", (), {
        "SLOT_TYPES": tuple(value for _, value in fields),
        "get_fields_and_field_types": classmethod(lambda cls: dict((name, "unused") for name, _ in fields)),
    })


class FakeInterfaces:
    def __init__(self):
        self.messages = {"geometry_msgs/msg/Vector3": message([
            (axis, slot("BasicType", typename="double")) for axis in ("x", "y", "z")
        ])}
        self.action = SimpleNamespace(
            Goal=message([
                ("targets", slot("BoundedSequence", maximum_size=4,
                                 value_type=slot("NamespacedType", namespaces=("geometry_msgs", "msg"), name="Vector3"))),
                ("tool", slot("BoundedString", maximum_size=32)),
            ]),
            Result=message([("success", slot("BasicType", typename="boolean"))]),
            Feedback=message([("progress", slot("BasicType", typename="float"))]),
        )

    def describe(self, action_type):
        return collect.describe_interface(action_type, lambda _: self.action, self.messages.__getitem__)


class FakeProvider:
    def __init__(self):
        self.interfaces = FakeInterfaces()
        self.servers = {"/robot/move": (ACTION, 1)}
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.closed = True

    def environment(self):
        return {"rosDistro": "humble", "rmwImplementation": "rmw_fastrtps_cpp", "domainId": 17}

    def action_servers(self, endpoints):
        return {endpoint: value for endpoint, value in self.servers.items() if endpoint in endpoints}


def profile():
    return {
        "schemaVersion": 1, "id": "fanuc-reference", "mode": "shadow",
        "environment": {"rosDistro": "fictional", "rmwImplementation": "expected-only", "domainId": 99},
        "robot": {"deviceId": "cell-1", "model": "FANUC", "controller": "controller-1", "urdfSha256": "0" * 64},
        "jointOrder": ["joint_1"], "maxObservationAgeMs": 5000,
        "facts": [
            {"id": "calibration", "kind": "file_sha256", "path": "calibration.txt", "expected": "0" * 64},
            {"id": "tool", "kind": "json_value", "path": "state.json", "pointer": "/tool", "expected": "expected-only"},
        ],
        "paths": [{"id": "cartesian", "endpoint": "/robot/move", "actionType": ACTION,
                   "interfaceSha256": "0" * 64, "adapter": "cartesian_pose",
                   "fields": {"position": "/position", "orientation": "/orientation", "frame": "/frame", "expectedFrame": "world"},
                   "checks": ["calibration", "tool"]}],
    }


class FactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.config = profile()
        (self.root / "calibration.txt").write_bytes(b"measured calibration\n")
        (self.root / "state.json").write_text(json.dumps({"observedAt": OLD, "tool": "actual-tool"}), encoding="utf-8")

    def observation(self, provider=None):
        return collect.collect_observation(self.config, self.root, provider or FakeProvider(), lambda: NOW)

    def test_observed_facts_environment_and_hash_do_not_copy_expected(self):
        observation = self.observation()
        self.assertEqual(observation["environment"], FakeProvider().environment())
        self.assertEqual(observation["facts"][0]["value"], hashlib.sha256(b"measured calibration\n").hexdigest())
        self.assertEqual(observation["facts"][0]["observedAt"], NOW)
        self.assertEqual(observation["facts"][1]["value"], "actual-tool")
        self.assertNotEqual(observation["paths"][0]["interfaceSha256"], "0" * 64)

    def test_fact_changes_are_collected(self):
        before = self.observation()
        (self.root / "calibration.txt").write_bytes(b"changed")
        (self.root / "state.json").write_text(json.dumps({"observedAt": NOW, "tool": "replacement"}), encoding="utf-8")
        after = self.observation()
        self.assertNotEqual(before["facts"][0]["value"], after["facts"][0]["value"])
        self.assertEqual(after["facts"][1]["value"], "replacement")

    def test_stale_export_timestamp_is_preserved_exactly(self):
        observation = self.observation()
        self.assertEqual(observation["observedAt"], NOW)
        self.assertEqual(observation["facts"][1]["observedAt"], OLD)

    def test_future_timestamp_is_not_rewritten(self):
        future = "2099-01-01T00:00:00.000Z"
        (self.root / "state.json").write_text(json.dumps({"observedAt": future, "tool": "tool"}), encoding="utf-8")
        self.assertEqual(self.observation()["facts"][1]["observedAt"], future)

    def test_graph_timestamp_is_not_refreshed_after_slow_fact_collection(self):
        times = iter([OLD, NOW])
        observation = collect.collect_observation(self.config, self.root, FakeProvider(), lambda: next(times))
        self.assertEqual(observation["observedAt"], OLD)
        self.assertEqual(observation["facts"][0]["observedAt"], NOW)

    def test_missing_or_invalid_export_timestamp_fails(self):
        for timestamp in (None, "2026-09-05", "2026-13-01T00:00:00Z", "2026-09-05T00:00:00"):
            with self.subTest(timestamp=timestamp):
                (self.root / "state.json").write_text(json.dumps({"observedAt": timestamp, "tool": "tool"}), encoding="utf-8")
                with self.assertRaises(collect.CollectionError):
                    self.observation()

    def test_missing_nonstring_duplicate_and_nonfinite_json_fail(self):
        cases = [json.dumps({"observedAt": OLD, "tool": 42}), json.dumps({"observedAt": OLD}),
                 '{"observedAt":"' + OLD + '","tool":"first","tool":"second"}',
                 '{"observedAt":"' + OLD + '","tool":"tool","extra":NaN}']
        for data in cases:
            with self.subTest(data=data):
                (self.root / "state.json").write_text(data, encoding="utf-8")
                with self.assertRaises(collect.CollectionError):
                    self.observation()

    def test_rfc6901_escapes_arrays_and_invalid_indexes(self):
        document = {"a/b": {"~key": ["selected"]}}
        self.assertEqual(collect.json_pointer(document, "/a~1b/~0key/0"), "selected")
        for pointer in ("a", "/a~2b", "/a~1b/~0key/01", "/a~1b/~0key/-", "/a~1b/~0key/1"):
            with self.subTest(pointer=pointer), self.assertRaises(collect.CollectionError):
                collect.json_pointer(document, pointer)

    def test_path_traversal_and_absolute_paths_fail(self):
        for relative in ("../outside", "/etc/passwd", "C:/outside", "..\\outside", "state.json:stream", "."):
            with self.subTest(path=relative), self.assertRaises(collect.CollectionError):
                collect.read_fact_bytes(self.root, relative)

    def test_file_and_directory_symlinks_are_rejected(self):
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        source = Path(outside.name) / "source.txt"
        source.write_text("outside", encoding="utf-8")
        for target, destination, directory in ((self.root / "link.txt", source, False),
                                                (self.root / "linked", Path(outside.name), True)):
            try:
                target.symlink_to(destination, target_is_directory=directory)
            except OSError as error:
                self.skipTest(f"platform cannot create symlinks: {error}")
        for relative in ("link.txt", "linked/source.txt"):
            with self.subTest(path=relative), self.assertRaisesRegex(collect.CollectionError, "symlink|reparse"):
                collect.read_fact_bytes(self.root, relative)

    def test_link_and_reparse_metadata_are_rejected_without_platform_privileges(self):
        original = Path.lstat
        target = self.root / "calibration.txt"
        for mode, attributes in ((stat.S_IFLNK, 0), (stat.S_IFREG, 0x400)):
            def info(path, *args, **kwargs):
                return (SimpleNamespace(st_mode=mode, st_file_attributes=attributes)
                        if path == target else original(path, *args, **kwargs))
            with self.subTest(mode=mode), patch.object(Path, "lstat", info), \
                    self.assertRaisesRegex(collect.CollectionError, "symlink|reparse"):
                collect.read_fact_bytes(self.root, "calibration.txt")

    def test_missing_directory_and_large_files_fail(self):
        (self.root / "directory").mkdir()
        for relative in ("missing", "directory"):
            with self.subTest(path=relative), self.assertRaises(collect.CollectionError):
                collect.read_fact_bytes(self.root, relative)
        with self.assertRaisesRegex(collect.CollectionError, "exceeds"):
            collect.read_fact_bytes(self.root, "calibration.txt", limit=3)

    def test_actual_graph_type_and_duplicate_servers_are_preserved(self):
        provider = FakeProvider()
        provider.servers["/robot/move"] = ("another_msgs/action/Actual", 2)
        path = self.observation(provider)["paths"][0]
        self.assertEqual(path["actionType"], "another_msgs/action/Actual")
        self.assertEqual(path["serverCount"], 2)

    def test_absent_server_or_interface_load_failure_is_explicit(self):
        provider = FakeProvider()
        provider.servers.clear()
        self.assertEqual(self.observation(provider)['paths'], [])
        with patch.object(FakeInterfaces, "describe", side_effect=ImportError("missing custom type")):
            with self.assertRaisesRegex(ImportError, "missing custom type"):
                self.observation()

    def test_cli_writes_observation_and_closes_provider(self):
        config_file = self.root / "profile.json"
        config_file.write_text(json.dumps(self.config), encoding="utf-8")
        output = self.root / "observation.json"
        provider = FakeProvider()
        with patch.object(collect, "RosGraphProvider", return_value=provider):
            self.assertEqual(collect.main(["--profile", str(config_file), "--output", str(output)]), 0)
        self.assertTrue(provider.closed)
        self.assertEqual(json.loads(output.read_text())["collector"], "ros2-read-only/v1")

    def test_cli_failure_emits_error_and_no_output(self):
        config_file = self.root / "profile.json"
        config_file.write_text(json.dumps(self.config), encoding="utf-8")
        output = self.root / "observation.json"
        provider = FakeProvider()
        provider.action_servers = lambda _: (_ for _ in ()).throw(collect.CollectionError('graph query failed'))
        stderr = io.StringIO()
        with patch.object(collect, "RosGraphProvider", return_value=provider), redirect_stderr(stderr):
            self.assertEqual(collect.main(["--profile", str(config_file), "--output", str(output)]), 2)
        self.assertIn("graph query failed", stderr.getvalue())
        self.assertFalse(output.exists())

    def test_output_cannot_overwrite_fact_or_profile(self):
        config_file = self.root / "profile.json"
        config_file.write_text(json.dumps(self.config), encoding="utf-8")
        for output in (config_file, self.root / "state.json"):
            with self.subTest(output=output), redirect_stderr(io.StringIO()):
                before = output.read_bytes()
                self.assertEqual(collect.main(["--profile", str(config_file), "--output", str(output)]), 2)
                self.assertEqual(output.read_bytes(), before)


class InterfaceTests(unittest.TestCase):
    def test_hash_is_deterministic_and_covers_nested_type(self):
        interfaces = FakeInterfaces()
        first = interfaces.describe(ACTION)
        self.assertEqual(first, interfaces.describe(ACTION))
        interfaces.messages["geometry_msgs/msg/Vector3"] = message([
            (axis, slot("BasicType", typename="float")) for axis in ("x", "y", "z")
        ])
        self.assertNotEqual(first["interfaceSha256"], interfaces.describe(ACTION)["interfaceSha256"])
        canonical = json.dumps(first["typeTree"], sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
        self.assertEqual(first["interfaceSha256"], hashlib.sha256(canonical).hexdigest())

    def test_goal_result_feedback_order_and_bounds_change_hash(self):
        baseline = FakeInterfaces().describe(ACTION)["interfaceSha256"]
        for component in ("Goal", "Result", "Feedback"):
            with self.subTest(component=component):
                interfaces = FakeInterfaces()
                setattr(interfaces.action, component, message([("different", slot("BasicType", typename="uint32"))]))
                self.assertNotEqual(baseline, interfaces.describe(ACTION)["interfaceSha256"])
        interfaces = FakeInterfaces()
        interfaces.action.Goal = message([
            ("tool", slot("BoundedString", maximum_size=32)),
            ("targets", slot("BoundedSequence", maximum_size=4,
                             value_type=slot("NamespacedType", namespaces=("geometry_msgs", "msg"), name="Vector3"))),
        ])
        self.assertNotEqual(baseline, interfaces.describe(ACTION)["interfaceSha256"])
        for bound in (4, 5):
            interfaces.action.Goal = message([("data", slot("Array", size=bound, value_type=slot("BasicType", typename="float")))])
            if bound == 4:
                previous = interfaces.describe(ACTION)["interfaceSha256"]
            else:
                self.assertNotEqual(previous, interfaces.describe(ACTION)["interfaceSha256"])

    def test_all_container_and_string_variants_are_supported(self):
        interfaces = FakeInterfaces()
        interfaces.action.Goal = message([
            ("sequence", slot("UnboundedSequence", value_type=slot("BasicType", typename="uint8"))),
            ("text", slot("UnboundedString")), ("wide", slot("UnboundedWString")),
            ("limited", slot("BoundedWString", maximum_size=5)),
        ])
        fields = interfaces.describe(ACTION)["typeTree"]["definitions"][ACTION + "_Goal"]["fields"]
        self.assertEqual(fields[0]["type"]["maximumSize"], None)
        self.assertEqual(fields[2]["type"]["kind"], "wstring")
        self.assertEqual(fields[3]["type"]["maximumSize"], 5)

    def test_unknown_metadata_fails(self):
        interfaces = FakeInterfaces()
        interfaces.action.Goal = message([("opaque", object())])
        with self.assertRaisesRegex(collect.CollectionError, "unsupported ROS field"):
            interfaces.describe(ACTION)

    def test_describe_interface_never_initializes_ros(self):
        stdout = io.StringIO()
        with patch.object(collect, "RosInterfaces", return_value=FakeInterfaces()), \
                patch.object(collect, "RosGraphProvider", side_effect=AssertionError("must not initialize ROS")), \
                redirect_stdout(stdout):
            self.assertEqual(collect.main(["--describe-interface", ACTION]), 0)
        self.assertIn("interfaceSha256", json.loads(stdout.getvalue()))


class GraphTests(unittest.TestCase):
    def provider(self, nodes, server_data):
        provider = collect.RosGraphProvider(0.1)
        provider.node = SimpleNamespace(get_node_names_and_namespaces=lambda: nodes)
        provider.server_query = lambda _node, name, namespace: server_data[(name, namespace)]
        provider.executor = SimpleNamespace(spin_once=lambda *_args, **_kwargs: None)
        return provider

    def observe(self, provider):
        with patch.object(collect.time, "monotonic", side_effect=[0, 1]):
            return provider.action_servers({"/robot/move"})

    def test_counts_server_nodes_and_ignores_unselected_endpoints(self):
        nodes = [("one", "/"), ("two", "/")]
        provider = self.provider(nodes, {node: [("/robot/move", [ACTION]), ("/other", ["unused"])] for node in nodes})
        self.assertEqual(self.observe(provider), {"/robot/move": (ACTION, 2)})

    def test_discovery_spins_only_its_context_executor(self):
        provider = self.provider([("one", "/")], {("one", "/"): [("/robot/move", [ACTION])]})
        spins = []
        provider.executor = SimpleNamespace(spin_once=lambda **kwargs: spins.append(kwargs))
        with patch.object(collect.time, "monotonic", side_effect=[0, 0, 0, 1]):
            self.assertEqual(provider.action_servers({"/robot/move"}), {"/robot/move": (ACTION, 1)})
        self.assertEqual(spins, [{"timeout_sec": 0.1}])

    def test_duplicate_node_identity_fails(self):
        provider = self.provider([("same", "/"), ("same", "/")], {})
        with self.assertRaisesRegex(collect.CollectionError, "ambiguous"):
            self.observe(provider)

    def test_conflicting_types_and_graph_query_errors_fail(self):
        nodes = [("one", "/"), ("two", "/")]
        provider = self.provider(nodes, {nodes[0]: [("/robot/move", [ACTION])],
                                         nodes[1]: [("/robot/move", ["other_msgs/action/Type"])]})
        with self.assertRaisesRegex(collect.CollectionError, "conflicting types"):
            self.observe(provider)
        provider.server_query = lambda *_args: (_ for _ in ()).throw(RuntimeError("graph unavailable"))
        with self.assertRaisesRegex(RuntimeError, "graph unavailable"):
            self.observe(provider)

    def test_environment_uses_actual_rmw_and_domain_default(self):
        provider = collect.RosGraphProvider()
        provider.rmw_identifier = lambda: "actual_rmw"
        with patch.dict(os.environ, {"ROS_DISTRO": "humble", "RMW_IMPLEMENTATION": "wrong"}, clear=True):
            self.assertEqual(provider.environment(), {"rosDistro": "humble", "rmwImplementation": "actual_rmw", "domainId": 0})
        for domain in ("-1", "233", "garbage"):
            with patch.dict(os.environ, {"ROS_DISTRO": "humble", "ROS_DOMAIN_ID": domain}, clear=True), \
                    self.assertRaises(collect.CollectionError):
                provider.environment()

    def test_unavailable_ros_has_an_actionable_error(self):
        with patch.dict(sys.modules, {"rclpy": None}), \
                self.assertRaisesRegex(collect.CollectionError, "ROS 2 unavailable"):
            collect.RosGraphProvider().__enter__()

    def test_no_action_or_service_sending_api_is_referenced(self):
        tree = ast.parse((HERE / "collect.py").read_text(encoding="utf-8"))
        forbidden = {"ActionClient", "ActionServer", "send_goal", "send_goal_async", "cancel_goal", "cancel_goal_async",
                     "create_client", "create_publisher", "create_service", "call", "call_async", "publish"}
        references = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
        references.update(node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute))
        references.update(alias.name for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom)) for alias in node.names)
        self.assertFalse(forbidden & references)

    def test_real_provider_lifecycle_uses_only_read_only_ros_mocks(self):
        events = []
        context = SimpleNamespace(shutdown=lambda: events.append("shutdown"))
        node = SimpleNamespace(destroy_node=lambda: events.append("destroy"))

        def create_node(_name, **kwargs):
            self.assertFalse(kwargs["start_parameter_services"])
            self.assertFalse(kwargs["enable_rosout"])
            self.assertFalse(kwargs["use_global_arguments"])
            return node

        modules = {
            "rclpy": SimpleNamespace(init=lambda **kwargs: events.append("init"), create_node=create_node),
            "rclpy.action.graph": SimpleNamespace(get_action_server_names_and_types_by_node=lambda *_args: []),
            "rclpy.context": SimpleNamespace(Context=lambda: context),
            "rclpy.executors": SimpleNamespace(SingleThreadedExecutor=lambda **kwargs: SimpleNamespace(
                add_node=lambda value: self.assertIs(value, node),
                shutdown=lambda **kwargs: events.append("executor_shutdown"))),
            "rclpy.utilities": SimpleNamespace(get_rmw_implementation_identifier=lambda: "actual_rmw"),
        }
        with patch.dict(sys.modules, modules), patch.object(collect, "RosInterfaces", return_value=FakeInterfaces()):
            with collect.RosGraphProvider() as provider:
                self.assertIs(provider.node, node)
        self.assertEqual(events, ["init", "executor_shutdown", "destroy", "shutdown"])


if __name__ == "__main__":
    unittest.main()
