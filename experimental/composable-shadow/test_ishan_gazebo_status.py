"""Focused no-ROS tests for Ishan's read-only Gazebo observation."""
from types import SimpleNamespace
import inspect
import unittest

import ishan_gazebo_status as status

CHECKOUT = {'commit': '6' * 40, 'dirty': False, 'checkoutName': 'warehouse',
            'originRemotes': ['https://github.com/example/warehouse.git']}


def value(**fields):
    return SimpleNamespace(**fields)


class IshanGazeboStatusTests(unittest.TestCase):
    def reader(self, subscribers=None, publishers=None, odom=None):
        bridge_cmd = [{'node': status.BRIDGE_NODE, 'type': status.CMD_TYPE,
                       'gid': '00112233445566778899aabb01'}]
        bridge_odom = [{'node': status.BRIDGE_NODE, 'type': status.ODOM_TYPE,
                        'gid': '00112233445566778899aabb02'}]
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
        result = status.build_observation(self.reader(), CHECKOUT)
        self.assertEqual(result['kind'], 'RlsokIshanWarehouseGazeboStatus')
        self.assertEqual(result['observerVersion'], '5')
        self.assertEqual(result['source']['commandBoundary']['subscriber']['node'], '/ros_gz_bridge')
        self.assertEqual(
            result['source']['commandBoundary']['subscriber']['nodeIdentity'],
            'verified',
        )
        self.assertEqual(result['frames'], {'odometry': 'odom', 'body': 'base_link_1'})
        self.assertEqual(result['dispatch']['rlsokCommandsSent'], 0)
        self.assertEqual(result['sourceCheckout'], CHECKOUT)
        self.assertEqual(result['source']['bridgeEvidence']['method'], 'ros_node_name')
        self.assertRegex(result['observationSha256'], r'^[a-f0-9]{64}$')

    def test_rejects_ambiguous_or_wrong_bridge(self):
        duplicated = [
            {'node': '/ros_gz_bridge', 'type': status.CMD_TYPE, 'gid': '00' * 13},
            {'node': '/other', 'type': status.CMD_TYPE, 'gid': '11' * 13},
        ]
        with self.assertRaisesRegex(status.CollectionError, 'ambiguous'):
            status.build_observation(self.reader(subscribers=duplicated), CHECKOUT)
        wrong = [{'node': '/other', 'type': status.ODOM_TYPE, 'gid': '22' * 13}]
        with self.assertRaisesRegex(status.CollectionError, 'unexpected_bridge'):
            status.build_observation(self.reader(publishers=wrong), CHECKOUT)

    def test_regression_uses_ros_graph_node_not_executable_name(self):
        executable_name = [
            {'node': '/parameter_bridge', 'type': status.CMD_TYPE, 'gid': '00' * 13}
        ]
        with self.assertRaisesRegex(status.CollectionError, 'unexpected_bridge'):
            status.build_observation(
                self.reader(subscribers=executable_name), CHECKOUT
            )

        live_graph_name = [
            {'node': '/ros_gz_bridge', 'type': status.CMD_TYPE, 'gid': '00' * 13}
        ]
        result = status.build_observation(
            self.reader(subscribers=live_graph_name), CHECKOUT
        )
        self.assertEqual(
            result['source']['commandBoundary']['subscriber']['node'],
            '/ros_gz_bridge',
        )

    def test_accepts_exact_rmw_unknown_identity_without_inventing_bridge_name(self):
        anonymous = [{
            'node': status.UNKNOWN_RMW_NODE,
            'nodeNamespace': status.UNKNOWN_RMW_NAMESPACE,
            'nodeName': status.UNKNOWN_RMW_NAME,
            'type': status.CMD_TYPE,
            'gid': '00112233445566778899aabb01',
        }]
        anonymous_odom = [{
            'node': status.UNKNOWN_RMW_NODE,
            'nodeNamespace': '/' + status.UNKNOWN_RMW_NAMESPACE + '/',
            'nodeName': '/' + status.UNKNOWN_RMW_NAME,
            'type': status.ODOM_TYPE,
            'gid': '00112233445566778899aabb02',
        }]
        result = status.build_observation(
            self.reader(subscribers=anonymous, publishers=anonymous_odom),
            CHECKOUT,
        )
        endpoint = result['source']['commandBoundary']['subscriber']
        self.assertEqual(endpoint['node'], status.UNKNOWN_RMW_NODE)
        self.assertEqual(endpoint['nodeIdentity'], 'middleware_unknown')
        self.assertEqual(
            result['source']['bridgeEvidence'],
            {'method': 'dds_participant_gid', 'value': '00112233445566778899aabb'},
        )

    def test_rejects_unknown_endpoints_from_different_dds_participants(self):
        anonymous = [{
            'node': status.UNKNOWN_RMW_NODE,
            'type': status.CMD_TYPE,
            'gid': '00112233445566778899aabb01',
        }]
        other_participant = [{
            'node': status.UNKNOWN_RMW_NODE,
            'type': status.ODOM_TYPE,
            'gid': 'ffeeddccbbaa99887766554402',
        }]
        with self.assertRaisesRegex(status.CollectionError, 'participant_mismatch'):
            status.build_observation(
                self.reader(subscribers=anonymous, publishers=other_participant),
                CHECKOUT,
            )

    def test_reader_has_no_command_or_service_surface(self):
        source = inspect.getsource(status.Reader)
        for forbidden in ('create_publisher', '.publish(', 'create_client', 'call_async'):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
