"""Focused tests for node export discovery and conflicting downstream publishers."""
import copy
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import node_settings


def reader(extra=False):
    tick = [0.0]
    def endpoint(node, gid): return SimpleNamespace(node_namespace='/', node_name=node, topic_type='trajectory_msgs/msg/JointTrajectory', endpoint_gid=[gid]*16)
    pubs = [endpoint('hexapod_gait', 1)] + ([endpoint('bypass', 3)] if extra else [])
    subs = [endpoint('leg_controller', 2)]
    obj = SimpleNamespace(deadline=1, environment=lambda: {'rosDistro': 'jazzy', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 224},
        parameters=lambda _: {'cycle_time': {'type': 3, 'value': '1.0'}},
        node=SimpleNamespace(get_publishers_info_by_topic=lambda _: pubs if tick[0] else [], get_subscriptions_info_by_topic=lambda _: subs if tick[0] else []),
        executor=SimpleNamespace(spin_once=lambda **_: tick.__setitem__(0, tick[0]+0.1)))
    return obj, tick


class NodeSettingsTests(unittest.TestCase):
    def test_discovery_lag_waits_but_never_fabricates_or_ignores_conflicting_publishers(self):
        r, tick = reader()
        with patch.object(node_settings.time, 'monotonic', side_effect=lambda: tick[0]):
            result = node_settings.export_settings(r, '/hexapod_gait', ('/leg_controller', '/leg_controller/joint_trajectory', 'trajectory_msgs/msg/JointTrajectory'))
        self.assertGreater(tick[0], 0)
        self.assertEqual(result['configuration']['downstream']['publishers'][0]['node'], '/hexapod_gait')
        r, tick = reader(True)
        with patch.object(node_settings.time, 'monotonic', side_effect=lambda: tick[0]):
            with self.assertRaisesRegex(node_settings.CollectionError, 'missing_or_ambiguous'):
                node_settings.export_settings(r, '/hexapod_gait', ('/leg_controller', '/leg_controller/joint_trajectory', 'trajectory_msgs/msg/JointTrajectory'))

    def test_mid_read_parameter_change_is_rejected(self):
        r, _ = reader(); values = iter([{'cycle_time': {'type': 3, 'value': '1.0'}}, {'cycle_time': {'type': 3, 'value': '2.0'}}])
        r.parameters = lambda _: copy.deepcopy(next(values))
        with self.assertRaisesRegex(node_settings.CollectionError, 'changed_during_read'):
            node_settings.export_settings(r, '/hexapod_gait')


if __name__ == '__main__': unittest.main()
