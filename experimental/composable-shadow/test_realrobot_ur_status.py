import math
import tempfile
import unittest
from pathlib import Path

from collect import CollectionError
from realrobot_ur_status import build_observation, selected_config


class FakeReceive:
    def __init__(self, timestamps=(10.0, 10.25), positions=None):
        self.timestamps = iter(timestamps)
        self.positions = positions if positions is not None else [0.0] * 6

    def getTimestamp(self):
        return next(self.timestamps)

    def getRobotMode(self):
        return 7

    def getSafetyMode(self):
        return 1

    def getActualQ(self):
        return self.positions

    def getActualQd(self):
        return [0.0] * 6

    def getActualTCPPose(self):
        return [0.0] * 6

    def getSpeedScaling(self):
        return 0.5


SELECTED = {'model': 'ur7e', 'backend': 'ur_rtde'}
CHECKOUT = {'commit': 'a' * 40, 'dirty': False}


class RealRobotStatusTests(unittest.TestCase):
    def test_advancing_receive_only_observation_omits_pose_and_host(self):
        result = build_observation(FakeReceive(), SELECTED, CHECKOUT, pause=lambda _: None)
        self.assertFalse(result['hardwareDispatch'])
        self.assertEqual(result['robotTelemetry']['jointCount'], 6)
        self.assertEqual(result['robotTelemetry']['rtdeTimestampSecond'], 10.25)
        self.assertNotIn('jointPositions', result['robotTelemetry'])
        self.assertEqual(len(result['observationSha256']), 64)

    def test_stale_sample_rejected(self):
        with self.assertRaisesRegex(CollectionError, 'timestamp_not_advancing'):
            build_observation(FakeReceive((10.0, 10.0)), SELECTED, CHECKOUT, pause=lambda _: None)

    def test_nonfinite_joint_rejected(self):
        with self.assertRaisesRegex(CollectionError, 'invalid_joint_positions'):
            build_observation(FakeReceive(positions=[math.nan] * 6), SELECTED,
                              CHECKOUT, pause=lambda _: None)

    def test_wrong_joint_count_rejected(self):
        with self.assertRaisesRegex(CollectionError, 'invalid_joint_positions'):
            build_observation(FakeReceive(positions=[0.0] * 5), SELECTED,
                              CHECKOUT, pause=lambda _: None)

    def test_config_selects_local_host_but_never_exports_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'configs' / 'robots').mkdir(parents=True)
            (root / 'configs' / 'application.yaml').write_text(
                'application: {version: "1.1"}\nrobot: '
                '{manufacturer: universal_robots, model: ur7e, backend: ur_rtde}\n',
                encoding='utf-8')
            path = root / 'configs' / 'robots' / 'ur7e.yaml'
            path.write_text('robot:\n  display_name: UR7e\n  connection: '
                            '{host: 192.168.7.11}\n  state: {receive_hz: 500}\n'
                            '  manual_control:\n'
                            '    joint_jog_speed: {slow: 0.05, medium: 0.15, fast: 0.3}\n'
                            '    tcp_jog_speed: {slow: 0.01, medium: 0.03, fast: 0.06}\n'
                            '    default_joint_speed: 0.3\n'
                            '    default_joint_acceleration: 0.3\n'
                            '    default_tcp_speed: 0.05\n'
                            '    default_tcp_acceleration: 0.1\n'
                            '  safety: {require_motion_confirmation: true, '
                            'require_power_confirmation: true, '
                            'require_brake_release_confirmation: true, '
                            'auto_resume_motion: false}\n', encoding='utf-8')
            host, selected = selected_config(root)
            self.assertEqual(host, '192.168.7.11')
            self.assertNotIn(host, str(selected))
            path.write_text(path.read_text(encoding='utf-8').replace('192.168.7.11',
                                                                       '8.8.8.8'), encoding='utf-8')
            with self.assertRaisesRegex(CollectionError, 'private_ipv4'):
                selected_config(root)


if __name__ == '__main__':
    unittest.main()
