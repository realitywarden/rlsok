"""Focused no-ROS tests for the MIRA read-only status observation."""
from types import SimpleNamespace
import inspect
import unittest
import mira_status

CHECKOUT = {'commit': '1' * 40, 'dirty': False, 'checkoutName': 'mira',
            'originRemotes': ['https://github.com/example/mira.git']}


class MiraStatusTests(unittest.TestCase):
    def reader(self, publishers=None, message=None):
        return SimpleNamespace(
            publishers=lambda _: publishers if publishers is not None else [{'node': '/micro_xrce_agent', 'type': mira_status.TYPE, 'gid': 'aa'}],
            once=lambda *_: message if message is not None else SimpleNamespace(arming_state=1, nav_state=0, failsafe=False, pre_flight_checks_pass=True),
            environment=lambda: {'rosDistro': 'humble', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 0})

    def test_records_only_selected_status_and_source(self):
        result = mira_status.build_observation(self.reader(), CHECKOUT)
        self.assertEqual(result['kind'], 'RlsokMiraVehicleStatus')
        self.assertEqual(result['source']['topic'], mira_status.TOPIC)
        self.assertEqual(result['source']['checkout'], CHECKOUT)
        self.assertEqual(set(result['status']), set(mira_status.FIELDS))
        self.assertRegex(result['observationSha256'], r'^[a-f0-9]{64}$')

    def test_rejects_ambiguous_publisher_or_incomplete_status(self):
        publisher = {'node': '/agent', 'type': mira_status.TYPE, 'gid': 'aa'}
        with self.assertRaisesRegex(mira_status.CollectionError, 'ambiguous'):
            mira_status.build_observation(self.reader([publisher, {**publisher, 'gid': 'bb'}]), CHECKOUT)
        with self.assertRaisesRegex(mira_status.CollectionError, 'publisher_missing_or_ambiguous'):
            mira_status.build_observation(self.reader([{**publisher, 'node': '/_NODE_NAME_UNKNOWN_'}]), CHECKOUT)
        with self.assertRaisesRegex(mira_status.CollectionError, 'field_missing'):
            mira_status.build_observation(self.reader(message=SimpleNamespace(arming_state=1)), CHECKOUT)

    def test_waits_for_transient_unknown_publisher_identity(self):
        unknown = SimpleNamespace(node_namespace='_NODE_NAMESPACE_UNKNOWN_', node_name='_NODE_NAME_UNKNOWN_',
                                  topic_type=mira_status.TYPE, endpoint_gid=bytes([1]))
        resolved = SimpleNamespace(node_namespace='/', node_name='micro_xrce_agent',
                                   topic_type=mira_status.TYPE, endpoint_gid=bytes([1]))
        observations = iter([[unknown], [resolved]])
        spins = []
        reader = mira_status.Reader.__new__(mira_status.Reader)
        reader.node = SimpleNamespace(get_publishers_info_by_topic=lambda _: next(observations))
        reader.executor = SimpleNamespace(spin_once=lambda timeout_sec: spins.append(timeout_sec))
        reader.deadline = mira_status.time.monotonic() + 5
        self.assertEqual(reader.publishers(mira_status.TOPIC)[0]['node'], '/micro_xrce_agent')
        self.assertEqual(spins, [0.1])

    def test_reader_has_no_command_or_service_surface(self):
        source = inspect.getsource(mira_status.Reader)
        for forbidden in ('create_publisher', '.publish(', 'create_client', 'call_async'):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__': unittest.main()
