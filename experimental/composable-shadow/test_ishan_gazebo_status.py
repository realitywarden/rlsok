"""Focused no-ROS tests for Ishan's read-only Gazebo observation."""
from types import SimpleNamespace
import inspect
import unittest

import ishan_gazebo_status as status


def value(**fields):
    return SimpleNamespace(**fields)


class IshanGazeboStatusTests(unittest.TestCase):
    def reader(self, subscribers=None, publishers=None, odom=None):
        bridge_cmd = [{'node': status.BRIDGE_NODE, 'type': status.CMD_TYPE, 'gid': 'aa'}]
        bridge_odom = [{'node': status.BRIDGE_NODE, 'type': status.ODOM_TYPE, 'gid': 'bb'}]
        header = value(stamp=value(sec=10, nanosec=20), frame_id='odom')
        sample = odom or value(
            header=header,
            child_frame_id='base_link_1',
            pose=value(pose=value(
                position=value(x=1.0, y=2.0, z=0.0),
                orientation=value(x=0.0, y=0.0, z=0.0, w=1.0),
            )),
            twist=value(twist=value(
                linear=value(x=0.1, y=0.0, z=0.0),
                angular=value(x=0.0, y=0.0, z=0.2),
            )),
        )
        return value(
            subscribers=lambda _: subscribers or bridge_cmd,
            publishers=lambda _: publishers or bridge_odom,
            once=lambda *_: sample,
            environment=lambda: {
                'rosDistro': 'humble',
                'rmwImplementation': 'rmw_fastrtps_cpp',
                'domainId': 0,
            },
        )

    def test_records_exact_bridge_and_odometry_without_dispatch(self):
        result = status.build_observation(self.reader(), 'e3cadc4182f3cbc0fc2cde0eee2db0fba4939366')
        self.assertEqual(result['kind'], 'RlsokIshanWarehouseGazeboStatus')
        self.assertEqual(result['source']['commandBoundary']['subscriber']['node'], '/parameter_bridge')
        self.assertEqual(result['frames'], {'odometry': 'odom', 'body': 'base_link_1'})
        self.assertEqual(result['dispatch']['rlsokCommandsSent'], 0)
        self.assertRegex(result['observationSha256'], r'^[a-f0-9]{64}$')

    def test_rejects_ambiguous_or_wrong_bridge(self):
        duplicated = [
            {'node': '/parameter_bridge', 'type': status.CMD_TYPE, 'gid': 'aa'},
            {'node': '/other', 'type': status.CMD_TYPE, 'gid': 'bb'},
        ]
        with self.assertRaisesRegex(status.CollectionError, 'ambiguous'):
            status.build_observation(self.reader(subscribers=duplicated), 'e3cadc4182f3cbc0fc2cde0eee2db0fba4939366')
        wrong = [{'node': '/other', 'type': status.ODOM_TYPE, 'gid': 'cc'}]
        with self.assertRaisesRegex(status.CollectionError, 'unexpected_bridge'):
            status.build_observation(self.reader(publishers=wrong), 'e3cadc4182f3cbc0fc2cde0eee2db0fba4939366')

    def test_reader_has_no_command_or_service_surface(self):
        source = inspect.getsource(status.Reader)
        for forbidden in ('create_publisher', '.publish(', 'create_client', 'call_async'):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
