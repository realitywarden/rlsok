"""Focused no-ROS tests for the reBot Arm B601-RS state observer."""
from types import SimpleNamespace
import inspect
import unittest
import rebot_status


def value(**fields):
    return SimpleNamespace(**fields)


class ReBotStatusTests(unittest.TestCase):
    def reader(self, publishers=None, joints=None, status=None):
        rows = publishers or {
            rebot_status.JOINT_TOPIC: [{'node': rebot_status.HARDWARE_NODE, 'type': rebot_status.JOINT_TYPE, 'gid': 'aa'}],
            rebot_status.STATUS_TOPIC: [{'node': rebot_status.HARDWARE_NODE, 'type': rebot_status.STATUS_TYPE, 'gid': 'bb'}],
        }
        header = value(stamp=value(sec=10, nanosec=20))
        joint_message = joints or value(header=header, name=list(rebot_status.JOINTS),
            position=[0.1] * 6, velocity=[0.0] * 6, effort=[0.2] * 6)
        status_message = status or value(header=header, joint_names=list(rebot_status.JOINTS),
            per_joint_status_code=[0] * 6, mode='mit', enabled=True, control_loop_active=True,
            state_machine='IDLE', error_codes=[])
        messages = {rebot_status.JOINT_TOPIC: joint_message, rebot_status.STATUS_TOPIC: status_message}
        return value(
            publishers=lambda topic: rows[topic],
            once=lambda topic, *_: messages[topic],
            environment=lambda: {'rosDistro': 'jazzy', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 0})

    def test_records_hardware_controller_state(self):
        result = rebot_status.build_observation(self.reader(), 'dadefb0d0681501c41e6311ccc09045f836decd6')
        self.assertEqual(result['kind'], 'RlsokReBotArmB601RsStatus')
        self.assertEqual(set(result['joints']), set(rebot_status.JOINTS))
        self.assertEqual(result['armStatus']['stateMachine'], 'IDLE')
        self.assertRegex(result['observationSha256'], r'^[a-f0-9]{64}$')

    def test_rejects_fake_driver_and_invalid_mapping(self):
        fake = {
            rebot_status.JOINT_TOPIC: [{'node': '/fake_rebotarm_rs_driver', 'type': rebot_status.JOINT_TYPE, 'gid': 'aa'}],
            rebot_status.STATUS_TOPIC: [{'node': '/fake_rebotarm_rs_driver', 'type': rebot_status.STATUS_TYPE, 'gid': 'bb'}],
        }
        with self.assertRaisesRegex(rebot_status.CollectionError, 'hardware_publisher'):
            rebot_status.build_observation(self.reader(publishers=fake), 'dadefb0d0681501c41e6311ccc09045f836decd6')
        bad = value(header=value(stamp=value(sec=1, nanosec=2)), joint_names=['joint1'],
            per_joint_status_code=[0], mode='mit', enabled=False, control_loop_active=False,
            state_machine='IDLE', error_codes=[])
        with self.assertRaisesRegex(rebot_status.CollectionError, 'joint_mapping'):
            rebot_status.build_observation(self.reader(status=bad), 'dadefb0d0681501c41e6311ccc09045f836decd6')

    def test_reader_has_no_command_service_or_can_surface(self):
        source = inspect.getsource(rebot_status.Reader)
        for forbidden in ('create_publisher', '.publish(', 'create_client', 'call_async', 'socketcan', 'can0', '.write('):
            self.assertNotIn(forbidden, source.lower())


if __name__ == '__main__': unittest.main()
