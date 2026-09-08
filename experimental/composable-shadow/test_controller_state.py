"""Focused controller-export tests; no ROS service or hardware is used here."""
import ast
import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
import controller_state as state


class Reader:
    def __init__(self):
        self.items = [{'name': 'arm_controller', 'state': 'active', 'type': 'joint_trajectory_controller/JointTrajectoryController',
                       'claimed_interfaces': ['joint_a/position']}]
        self.calls = 0
    def environment(self): return {'rosDistro': 'jazzy', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 191}
    def controllers(self, _): return copy.deepcopy(self.items)
    def actions(self, _): return [{'endpoint': '/arm_controller/follow_joint_trajectory', 'type': 'control_msgs/action/FollowJointTrajectory'}]
    def parameters(self, _):
        self.calls += 1
        return {'joints': {'type': 9, 'value': ['joint_a']}, 'gain': {'type': 3, 'value': '0.25'}}


class ControllerTests(unittest.TestCase):
    def export(self, reader): return state.export_state(reader, '/controller_manager', 'arm_controller', '/arm_controller')

    def test_baseline_and_claimed_interface_change_have_different_digests(self):
        reader = Reader(); before = self.export(reader)
        reader.items[0]['claimed_interfaces'] = ['joint_b/position']; after = self.export(reader)
        self.assertNotEqual(before['configurationSha256'], after['configurationSha256'])
        self.assertEqual(before['configurationSha256'], hashlib.sha256(state.canonical(before['configuration']).encode()).hexdigest())
        self.assertNotIn('observedAt', before['configuration'])

    def test_absent_and_inactive_are_reported_without_inventing_active_values(self):
        reader = Reader(); reader.items = []
        absent = self.export(reader)
        self.assertIsNone(absent['configuration']['controller']); self.assertEqual(reader.calls, 0)
        reader = Reader(); reader.items[0]['state'] = 'inactive'
        self.assertEqual(self.export(reader)['configuration']['controller']['state'], 'inactive')

    def test_duplicate_target_and_mid_read_change_fail(self):
        reader = Reader(); reader.items *= 2
        with self.assertRaisesRegex(state.CollectionError, 'duplicate'): self.export(reader)
        reader = Reader()
        def changed(_):
            reader.items[0]['state'] = 'inactive'
            return {}
        reader.parameters = changed
        with self.assertRaisesRegex(state.CollectionError, 'changed during'): self.export(reader)

    def test_parameter_encoding_preserves_ros_numeric_and_unset_values(self):
        self.assertEqual(state.parameter_value(SimpleNamespace(type=2, integer_value=9223372036854775807)), {'type': 2, 'value': '9223372036854775807'})
        self.assertEqual(state.parameter_value(SimpleNamespace(type=3, double_value=-0.0)), {'type': 3, 'value': '-0.0'})
        self.assertEqual(state.parameter_value(SimpleNamespace(type=3, double_value=float('nan'))), {'type': 3, 'value': 'nan'})
        self.assertEqual(state.parameter_value(SimpleNamespace(type=8, double_array_value=[float('inf'),float('-inf')])), {'type': 8, 'value': ['inf','-inf']})
        self.assertEqual(state.parameter_value(SimpleNamespace(type=0)), {'type': 0, 'value': None})
        with self.assertRaises(state.CollectionError): state.parameter_value(SimpleNamespace(type=10))

    def test_exporter_contains_only_the_three_read_only_service_types(self):
        tree = ast.parse(Path(state.__file__).read_text())
        imports = {alias.name for item in ast.walk(tree) if isinstance(item, ast.ImportFrom) and item.module in ('controller_manager_msgs.srv', 'rcl_interfaces.srv') for alias in item.names}
        self.assertEqual(imports, {'ListControllers', 'ListParameters', 'GetParameters'})
        methods = {item.attr for item in ast.walk(tree) if isinstance(item, ast.Attribute)}
        self.assertFalse(methods & {'create_publisher', 'create_subscription', 'publish', 'send_goal_async', 'cancel_goal_async'})


if __name__ == '__main__': unittest.main()
