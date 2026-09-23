"""Focused no-ROS tests for the LelyRobot read-only observation."""
from types import SimpleNamespace
import inspect
import unittest
import lely_status

CHECKOUT = {'commit': '3' * 40, 'dirty': False, 'checkoutName': 'lely',
            'originRemotes': ['https://github.com/example/lely.git']}


def value(**fields):
    return SimpleNamespace(**fields)


class LelyStatusTests(unittest.TestCase):
    def reader(self, publishers=None, sample=None):
        rows = publishers or [{'node': '/arduino_bridge', 'type': lely_status.MESSAGE_TYPE, 'gid': 'aa'}]
        message = sample or value(
            header=value(stamp=value(sec=10, nanosec=20), frame_id='ultrasonic_left_link'),
            radiation_type=0, field_of_view=0.26, min_range=0.02, max_range=4.0, range=0.42)
        return value(
            publishers=lambda _: rows,
            once=lambda *_: message,
            environment=lambda: {'rosDistro': 'humble', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 0})

    def test_records_selected_sample_and_limits(self):
        result = lely_status.build_observation(self.reader(), CHECKOUT, 'python')
        self.assertEqual(result['kind'], 'RlsokLelyRobotUltrasonicStatus')
        self.assertEqual(result['measurement']['range'], '0.42')
        self.assertEqual(result['source']['publisher']['node'], '/arduino_bridge')
        self.assertEqual(result['operatorSelection']['sourceCheckout'], CHECKOUT)
        self.assertRegex(result['observationSha256'], r'^[a-f0-9]{64}$')

    def test_rejects_wrong_publisher_and_invalid_range(self):
        with self.assertRaisesRegex(lely_status.CollectionError, 'publisher_missing_or_ambiguous'):
            lely_status.build_observation(self.reader(publishers=[{'node': '/other', 'type': lely_status.MESSAGE_TYPE, 'gid': 'aa'}]), CHECKOUT, 'cpp')
        bad = value(header=value(stamp=value(sec=1, nanosec=2), frame_id='sensor'), radiation_type=0,
            field_of_view=0.2, min_range=0.1, max_range=1.0, range=2.0)
        with self.assertRaisesRegex(lely_status.CollectionError, 'outside_declared_bounds'):
            lely_status.build_observation(self.reader(sample=bad), CHECKOUT, 'python')

    def test_waits_for_transient_unknown_publisher_identity(self):
        unknown = value(node_namespace='_NODE_NAMESPACE_UNKNOWN_', node_name='_NODE_NAME_UNKNOWN_',
                        topic_type=lely_status.MESSAGE_TYPE, endpoint_gid=bytes([1]))
        resolved = value(node_namespace='/', node_name='arduino_bridge',
                         topic_type=lely_status.MESSAGE_TYPE, endpoint_gid=bytes([1]))
        observations = iter([[unknown], [resolved]])
        spins = []
        reader = lely_status.Reader.__new__(lely_status.Reader)
        reader.node = value(get_publishers_info_by_topic=lambda _: next(observations))
        reader.executor = value(spin_once=lambda timeout_sec: spins.append(timeout_sec))
        self.assertEqual(reader.publishers(lely_status.TOPIC)[0]['node'], '/arduino_bridge')
        self.assertEqual(spins, [0.1])

    def test_reader_has_no_command_service_or_serial_surface(self):
        source = inspect.getsource(lely_status.Reader)
        for forbidden in ('create_publisher', '.publish(', 'create_client', 'call_async', 'serial', '.write('):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__': unittest.main()
