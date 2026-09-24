import types
import unittest

from collect import CollectionError
from stepit_status import _description, _joint_sample, build_observation


def description(dummy='false', ids=('0', '1')):
    return ('<robot name="stepit"><ros2_control name="stepit_ros2_control" type="system">'
            '<hardware><plugin>stepit_driver/StepitHardware</plugin>'
            f'<param name="use_dummy">{dummy}</param></hardware>'
            + ''.join(f'<joint name="joint{index + 1}"><param name="id">{motor_id}</param></joint>'
                      for index, motor_id in enumerate(ids)) + '</ros2_control></robot>')


class FakeReader:
    def __init__(self, dummy='false'):
        self.xml = description(dummy)
        self.endpoints = {
            '/joint_states': [{'node': '/joint_state_broadcaster', 'type': 'sensor_msgs/msg/JointState', 'gid': '01' * 16}],
            '/robot_description': [{'node': '/robot_state_publisher', 'type': 'std_msgs/msg/String', 'gid': '02' * 16}],
        }

    def publishers(self, topic):
        return self.endpoints[topic]

    def once(self, topic, _message_type, transient=False):
        if topic == '/robot_description':
            return types.SimpleNamespace(data=self.xml), '02' * 16
        return types.SimpleNamespace(name=['joint1', 'joint2'], position=[1.0, 2.0],
                                     velocity=[0.0, 0.0]), '01' * 16

    def environment(self):
        return {'rosDistro': 'jazzy', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 0}


class StepItStatusTests(unittest.TestCase):
    def test_non_dummy_observation_records_live_source(self):
        result = build_observation(FakeReader(), {'commit': 'a' * 40, 'dirty': True})
        self.assertEqual(result['liveDescription']['declaredMode'], 'real')
        self.assertEqual(result['liveDescription']['jointToMotorId'], {'joint1': 0, 'joint2': 1})
        self.assertFalse(result['hardwareDispatch'])
        self.assertEqual(len(result['observationSha256']), 64)

    def test_default_dummy_path_is_rejected(self):
        with self.assertRaisesRegex(CollectionError, 'dummy_or_unverified'):
            build_observation(FakeReader('true'), {'commit': 'a' * 40})

    def test_missing_or_duplicate_motor_id_is_rejected(self):
        with self.assertRaises(CollectionError):
            _description(types.SimpleNamespace(data=description(ids=('0', '0'))))

    def test_incomplete_joint_state_is_rejected(self):
        with self.assertRaises(CollectionError):
            _joint_sample(types.SimpleNamespace(name=['joint1', 'joint2'], position=[1.0],
                                                velocity=[0.0, 0.0]), {'joint1': 0, 'joint2': 1})

    def test_ambiguous_publisher_is_rejected(self):
        reader = FakeReader()
        reader.endpoints['/joint_states'].append(reader.endpoints['/joint_states'][0])
        with self.assertRaisesRegex(CollectionError, 'publisher_missing_or_ambiguous'):
            build_observation(reader, {'commit': 'a' * 40})


if __name__ == '__main__':
    unittest.main()
