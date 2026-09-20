"""Focused no-ROS tests for the wearable dual Kinova observer."""
from types import SimpleNamespace
import inspect
import json
import unittest

import dual_kinova_status

CHECKOUT = {'commit': '5' * 40, 'dirty': False, 'checkoutName': 'dual-kinova',
            'originRemotes': ['https://github.com/example/dual-kinova.git']}


def value(**fields):
    return SimpleNamespace(**fields)


def valid_publishers():
    return {
        dual_kinova_status.SESSION_TOPIC: [
            {'node': node, 'type': dual_kinova_status.STRING_TYPE, 'gid': arm + '01'}
            for arm, node in dual_kinova_status.BRIDGE_NODES.items()],
        dual_kinova_status.JOINT_TOPIC: [
            {'node': node, 'type': dual_kinova_status.JOINT_TYPE, 'gid': arm + '02'}
            for arm, node in dual_kinova_status.BRIDGE_NODES.items()],
        **{topic: [{'node': dual_kinova_status.BRIDGE_NODES[arm],
                    'type': dual_kinova_status.STRING_TYPE, 'gid': arm + '03'}]
           for arm, topic in dual_kinova_status.TELEMETRY_TOPICS.items()},
    }


class DualKinovaStatusTests(unittest.TestCase):
    def reader(self, connected=True, publishers=None, bad_joint=False):
        rows = publishers or valid_publishers()
        sessions = [value(data=json.dumps({'arm': arm, 'connected': connected,
                    'error': '', 'recoveries': 0})) for arm in dual_kinova_status.ARMS]
        telemetry = {topic: value(data=json.dumps({'arm': arm, 'faulted': False,
            'fault_why': '', 'heat': 'ok', 'heat_why': '', 'gripper_cmd': 0.2,
            'gripper_pos': 0.19, 'in_contact': False, 'contact_why': ''}))
            for arm, topic in dual_kinova_status.TELEMETRY_TOPICS.items()}
        stamp = value(sec=10, nanosec=20)
        joint_messages = [value(header=value(stamp=stamp),
            name=list(dual_kinova_status.JOINTS[arm])[:-1] if bad_joint and arm == 'right'
                else list(dual_kinova_status.JOINTS[arm]),
            position=[0.1] * (6 if bad_joint and arm == 'right' else 7))
            for arm in dual_kinova_status.ARMS]

        def until(topic, _message_type, complete):
            messages = sessions if topic == dual_kinova_status.SESSION_TOPIC else joint_messages
            if not complete(messages):
                raise dual_kinova_status.CollectionError('fixture_timeout')
            return messages

        return value(
            publishers=lambda topic: rows[topic],
            until=until,
            once=lambda topic, *_: telemetry[topic],
            environment=lambda: {'rosDistro': 'jazzy', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 0})

    def test_records_both_connected_bridge_paths(self):
        result = dual_kinova_status.build_observation(
            self.reader(), CHECKOUT)
        self.assertEqual(result['kind'], 'RlsokWearableDualKinovaStatus')
        self.assertEqual(set(result['sessions']), {'left', 'right'})
        self.assertEqual(len(result['joints']['left']), 7)
        self.assertEqual(result['operatorSelection']['sourceCheckout'], CHECKOUT)
        self.assertRegex(result['observationSha256'], r'^[a-f0-9]{64}$')

    def test_rejects_mock_or_disconnected_paths(self):
        mock_rows = valid_publishers()
        mock_rows[dual_kinova_status.SESSION_TOPIC] = [
            {'node': '/mock_real_stack', 'type': dual_kinova_status.STRING_TYPE, 'gid': 'aa'}]
        with self.assertRaisesRegex(dual_kinova_status.CollectionError, 'expected_publishers'):
            dual_kinova_status.build_observation(
                self.reader(publishers=mock_rows), CHECKOUT)
        with self.assertRaisesRegex(dual_kinova_status.CollectionError, 'both_sessions'):
            dual_kinova_status.build_observation(
                self.reader(connected=False), CHECKOUT)

    def test_reader_has_no_command_service_or_kortex_surface(self):
        source = inspect.getsource(dual_kinova_status.Reader)
        for forbidden in ('create_publisher', '.publish(', 'create_client', 'call_async', 'kortex_api',
                          'tcptransport', 'sendjointspeedscommand', '.write('):
            self.assertNotIn(forbidden, source.lower())


if __name__ == '__main__': unittest.main()
