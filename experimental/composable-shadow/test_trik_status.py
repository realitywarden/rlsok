"""Focused no-ROS tests for the TRIK read-only state observation."""
from types import SimpleNamespace
import inspect
import unittest
import trik_status


def vector(**values):
    return SimpleNamespace(**values)


class TrikStatusTests(unittest.TestCase):
    def reader(self, publishers=None, joints=None, odom=None):
        default_publishers = {
            trik_status.JOINT_TOPIC: [{'node': '/joint_state_broadcaster', 'type': trik_status.JOINT_TYPE, 'gid': 'aa'}],
            trik_status.ODOM_TOPIC: [{'node': '/diff_drive_controller', 'type': trik_status.ODOM_TYPE, 'gid': 'bb'}],
        }
        header = vector(stamp=vector(sec=10, nanosec=20), frame_id='odom')
        default_joints = vector(header=header, name=list(trik_status.WHEELS), position=[1.0, 2.0], velocity=[0.1, 0.2])
        default_odom = vector(header=header, child_frame_id='base_footprint',
            pose=vector(pose=vector(position=vector(x=1.0, y=2.0, z=0.0), orientation=vector(x=0.0, y=0.0, z=0.0, w=1.0))),
            twist=vector(twist=vector(linear=vector(x=0.1, y=0.0, z=0.0), angular=vector(x=0.0, y=0.0, z=0.2))))
        messages = {trik_status.JOINT_TOPIC: joints or default_joints, trik_status.ODOM_TOPIC: odom or default_odom}
        return SimpleNamespace(
            publishers=lambda topic: (publishers or default_publishers)[topic],
            once=lambda topic, _: messages[topic],
            environment=lambda: {'rosDistro': 'jazzy', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 0})

    def test_records_selected_state_and_sources(self):
        result = trik_status.build_observation(self.reader())
        self.assertEqual(result['kind'], 'RlsokTrikDriveStatus')
        self.assertEqual(set(result['wheels']), set(trik_status.WHEELS))
        self.assertEqual(result['frames'], {'odometry': 'odom', 'body': 'base_footprint'})
        self.assertRegex(result['observationSha256'], r'^[a-f0-9]{64}$')

    def test_rejects_ambiguous_publishers_and_missing_wheel(self):
        rows = {
            trik_status.JOINT_TOPIC: [
                {'node': '/a', 'type': trik_status.JOINT_TYPE, 'gid': 'aa'},
                {'node': '/b', 'type': trik_status.JOINT_TYPE, 'gid': 'bb'}],
            trik_status.ODOM_TOPIC: [{'node': '/drive', 'type': trik_status.ODOM_TYPE, 'gid': 'cc'}]}
        with self.assertRaisesRegex(trik_status.CollectionError, 'ambiguous'):
            trik_status.build_observation(self.reader(publishers=rows))
        bad = vector(header=vector(stamp=vector(sec=1, nanosec=2), frame_id=''), name=['base_left_wheel_joint'], position=[0.0], velocity=[0.0])
        with self.assertRaisesRegex(trik_status.CollectionError, 'wheel_joints'):
            trik_status.build_observation(self.reader(joints=bad))

    def test_reader_has_no_command_service_or_tcp_surface(self):
        source = inspect.getsource(trik_status.Reader)
        for forbidden in ('create_publisher', '.publish(', 'create_client', 'call_async', 'socket'):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__': unittest.main()
