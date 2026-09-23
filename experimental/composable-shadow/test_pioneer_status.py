import types
import unittest

from collect import CollectionError
from pioneer_status import build_observation


class FakeReader:
    def __init__(self):
        self.endpoints = {
            '/wheel_ticks': [{'node': '/robot_esp32_node', 'type': 'std_msgs/msg/Int32MultiArray', 'gid': '01' * 16}],
            '/posicion_estimada': [{'node': '/robot_esp32_node', 'type': 'geometry_msgs/msg/Point', 'gid': '02' * 16}],
        }
        self.wheel = types.SimpleNamespace(data=[12, 13])
        self.pose = types.SimpleNamespace(x=1.0, y=2.0, z=0.5)
        self.second_time = 2_000_000_000

    def publishers(self, topic):
        return self.endpoints[topic]

    def once(self, topic, _type):
        if topic == '/wheel_ticks':
            return self.wheel, '01' * 16, 1_000_000_000
        return self.pose, '02' * 16, self.second_time

    def environment(self):
        return {'rosDistro': 'jazzy', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 0}


class PioneerStatusTests(unittest.TestCase):
    def test_two_existing_state_topics_observed(self):
        result = build_observation(FakeReader(), {'commit': 'a' * 40, 'dirty': False})
        self.assertEqual(result['wheelTicks'], {'left': 12, 'right': 13})
        self.assertEqual(result['estimatedPose']['theta'], '0.5')
        self.assertFalse(result['hardwareDispatch'])

    def test_wrong_publisher_rejected(self):
        reader = FakeReader()
        reader.endpoints['/wheel_ticks'][0]['node'] = '/mock'
        with self.assertRaisesRegex(CollectionError, 'publisher_missing_or_ambiguous'):
            build_observation(reader, {})

    def test_wrong_tick_shape_rejected(self):
        reader = FakeReader()
        reader.wheel.data = [12]
        with self.assertRaisesRegex(CollectionError, 'invalid_wheel_ticks'):
            build_observation(reader, {})

    def test_non_finite_pose_rejected(self):
        reader = FakeReader()
        reader.pose.z = float('nan')
        with self.assertRaisesRegex(CollectionError, 'invalid_estimated_pose'):
            build_observation(reader, {})

    def test_stale_pair_rejected(self):
        reader = FakeReader()
        reader.second_time = 7_000_000_001
        with self.assertRaisesRegex(CollectionError, 'samples_not_close'):
            build_observation(reader, {})


if __name__ == '__main__':
    unittest.main()
