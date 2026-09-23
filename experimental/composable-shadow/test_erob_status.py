import types
import unittest

from collect import CollectionError
from erob_status import UNKNOWN_NODE, _description, _sample, build_observation


def description(real_plugin='erob_hardware/ErobHardwareInterface'):
    joints = ''.join(
        f'<joint name="L_Joint_{index}"><command_interface name="position"/>'
        '<state_interface name="position"/></joint>' for index in range(1, 8))
    return ('<robot name="shu_pr03"><ros2_control name="RealLeftArm" type="system">'
            f'<hardware><plugin>{real_plugin}</plugin></hardware>{joints}</ros2_control>'
            '<ros2_control name="MockRightArmAndHead" type="system">'
            '<hardware><plugin>mock_components/GenericSystem</plugin></hardware>'
            '</ros2_control></robot>')


class FakeReader:
    def __init__(self, plugin='erob_hardware/ErobHardwareInterface'):
        self.xml = description(plugin)
        self.endpoints = {
            '/joint_states': [{'node': '/joint_state_broadcaster',
                               'type': 'sensor_msgs/msg/JointState', 'gid': '01' * 16}],
            '/robot_description': [{'node': '/robot_state_publisher',
                                    'type': 'std_msgs/msg/String', 'gid': '02' * 16}],
        }

    def publishers(self, topic):
        return self.endpoints[topic]

    def once(self, topic, _type, transient=False):
        if topic == '/robot_description':
            return types.SimpleNamespace(data=self.xml), '02' * 16
        names = [f'L_Joint_{index}' for index in range(1, 8)]
        return types.SimpleNamespace(name=names, position=[0.1 * index for index in range(7)]), '01' * 16

    def environment(self):
        return {'rosDistro': 'humble', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 0}


class ErobStatusTests(unittest.TestCase):
    def test_real_left_arm_path_with_mock_right_arm(self):
        result = build_observation(FakeReader(), {'commit': 'a' * 40, 'dirty': False})
        self.assertEqual(len(result['leftJointPositions']), 7)
        self.assertEqual(result['liveDescription']['realSystem'], 'RealLeftArm')
        self.assertFalse(result['hardwareDispatch'])
        self.assertEqual(len(result['observationSha256']), 64)

    def test_fake_only_or_wrong_real_plugin_rejected(self):
        with self.assertRaisesRegex(CollectionError, 'hardware_plugin_mismatch'):
            build_observation(FakeReader('mock_components/GenericSystem'), {})

    def test_missing_left_joint_rejected(self):
        with self.assertRaisesRegex(CollectionError, 'left_joint_sample_incomplete'):
            _sample(types.SimpleNamespace(name=['L_Joint_1'], position=[0.0]))

    def test_non_finite_position_rejected(self):
        names = [f'L_Joint_{index}' for index in range(1, 8)]
        with self.assertRaisesRegex(CollectionError, 'non_finite_joint_position'):
            _sample(types.SimpleNamespace(name=names, position=[float('nan')] * 7))

    def test_ambiguous_publisher_rejected(self):
        reader = FakeReader()
        reader.endpoints['/joint_states'].append(dict(reader.endpoints['/joint_states'][0]))
        with self.assertRaisesRegex(CollectionError, 'publisher_missing_or_ambiguous'):
            build_observation(reader, {})

    def test_unresolved_ros_node_name_is_explicitly_preserved(self):
        reader = FakeReader()
        reader.endpoints['/joint_states'][0]['node'] = UNKNOWN_NODE
        result = build_observation(reader, {})
        self.assertEqual(result['publishers']['jointStates']['node'], UNKNOWN_NODE)

    def test_mismatched_message_gid_rejected(self):
        reader = FakeReader()
        reader.endpoints['/joint_states'][0]['gid'] = '03' * 16
        with self.assertRaisesRegex(CollectionError, 'joint_sample_publisher_mismatch'):
            build_observation(reader, {})

    def test_description_requires_seven_exact_real_left_joints(self):
        with self.assertRaisesRegex(CollectionError, 'real_left_joint_mapping_mismatch'):
            _description(types.SimpleNamespace(data=description().replace('L_Joint_7', 'L_Joint_8')))


if __name__ == '__main__':
    unittest.main()
