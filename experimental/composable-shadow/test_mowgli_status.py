"""Focused synthetic tests; no ROS graph, driver, mower or serial device."""
import copy
import hashlib
import inspect
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

import mowgli_status as m

CHECKOUT = {'commit': 'a' * 40, 'dirty': False, 'originRemotes': ['https://secret@invalid/repo']}
GID = bytes(range(1, 17))


def message(**changes):
    values = dict(stamp=NS(sec=100, nanosec=0), firmware_version='1.2.3',
        firmware_protocol_version=4, firmware_compatible=True,
        mow_enabled=False, firmware_debug_enabled=False, is_charging=True)
    values.update(changes)
    return NS(**values)


def reader(msg=None, rows=None, info=None, received=100_100_000_000):
    rows = rows if rows is not None else [{'node': m.HARDWARE_NODE, 'type': m.MESSAGE_TYPE, 'gid': GID.hex()}]
    return NS(publishers=lambda: rows,
        once=lambda: (msg or message(), info if info is not None else {'publisher_gid': {'data': GID}}, received),
        environment=lambda: {'rosDistro': 'kilted', 'domainId': 0, 'rmwImplementation': 'synthetic'})


def settings(**parameters):
    return {'schemaVersion': 1, 'provenance': 'operator-selected-saved-not-live',
        'sourceFileSha256': 'b' * 64, 'parameters': parameters}


def resign(value):
    value.pop('observationSha256', None)
    value['observationSha256'] = hashlib.sha256(m.canonical(value).encode()).hexdigest()
    return value


class MowgliTests(unittest.TestCase):
    def test_records_reported_firmware_and_bounded_metadata(self):
        result = m.build_observation(reader(), CHECKOUT)
        self.assertEqual(result['decision'], 'OBSERVED')
        self.assertEqual(result['firmware']['version'], '1.2.3')
        self.assertFalse(result['hardwareDispatch'])
        self.assertFalse(result['authenticatedDevice'])
        self.assertEqual(result['receiptAgeNanoseconds'], '100000000')
        self.assertNotIn('secret@', json.dumps(result))
        self.assertEqual(result, resign(copy.deepcopy(result)))

    def test_rejects_missing_ambiguous_wrong_type_and_fake_publishers(self):
        valid = reader().publishers()[0]
        for rows in ([], [valid, valid], [{**valid, 'node': '/fake_hardware_bridge'}],
                     [{**valid, 'type': 'other/msg/Status'}], [{**valid, 'gid': '00' * 24}]):
            with self.assertRaises(m.CollectionError): m.build_observation(reader(rows=rows), CHECKOUT)

    def test_rejects_simulation_even_if_renamed_and_compatible(self):
        with self.assertRaisesRegex(m.CollectionError, 'simulated'):
            m.build_observation(reader(message(firmware_version='sim')), CHECKOUT)

    def test_requires_actual_message_gid_and_stable_endpoint_window(self):
        for info in ({}, {'publisher_gid': None}, {'publisher_gid': {'data': bytes(24)}},
                     {'publisher_gid': {'data': bytes(reversed(GID))}}):
            with self.assertRaises(m.CollectionError): m.build_observation(reader(info=info), CHECKOUT)
        r = reader()
        r.publishers = unittest.mock.Mock(side_effect=[reader().publishers(), []])
        with self.assertRaises(m.CollectionError): m.build_observation(r, CHECKOUT)

    def test_preserves_complete_supported_gid_layouts_without_prefix_matching(self):
        for size in (16, 24):
            gid = bytes(range(1, size + 1))
            rows = [{'node': m.HARDWARE_NODE, 'type': m.MESSAGE_TYPE, 'gid': gid.hex()}]
            result = m.build_observation(reader(rows=rows, info={'publisher_gid': {'data': gid}}), CHECKOUT)
            self.assertEqual(result['samplePublisherGid'], gid.hex())
            changed = gid[:-1] + b'\xff'
            with self.assertRaises(m.CollectionError):
                m.build_observation(reader(rows=rows, info={'publisher_gid': {'data': changed}}), CHECKOUT)

    def test_refuses_zero_stale_future_and_malformed_stamps(self):
        for stamp in (NS(sec=0, nanosec=0), NS(sec=90, nanosec=0), NS(sec=110, nanosec=0),
                      NS(sec=100, nanosec=1_000_000_000), NS(sec=True, nanosec=0)):
            with self.assertRaises(m.CollectionError): m.build_observation(reader(message(stamp=stamp)), CHECKOUT)

    def test_unknown_or_incompatible_handshake_is_not_a_match(self):
        for changes in ({'firmware_version': ''}, {'firmware_version': 'unknown'},
                        {'firmware_protocol_version': 0}, {'firmware_compatible': False}):
            result = m.build_observation(reader(message(**changes)), CHECKOUT)
            self.assertEqual(result['decision'], 'NEEDS_MATERIAL')
            with self.assertRaisesRegex(m.CollectionError, 'complete_firmware'):
                m.compare_observations(result, result)
        for changes in ({'firmware_protocol_version': True}, {'firmware_compatible': 1}, {'mow_enabled': 0}):
            with self.assertRaises(m.CollectionError): m.build_observation(reader(message(**changes)), CHECKOUT)

    def test_compares_firmware_and_only_explicit_saved_settings(self):
        a = m.build_observation(reader(), CHECKOUT, settings(wheel_pid_kp=10, max_mps=0.4))
        b = m.build_observation(reader(message(firmware_version='1.2.4', is_charging=False)), CHECKOUT,
            settings(wheel_pid_kp=11, max_mps=0.4))
        result = m.compare_observations(a, b)
        self.assertEqual(result['decision'], 'CHANGED')
        self.assertEqual(result['changedFields'], ['firmware.version', 'settings.wheel_pid_kp'])
        self.assertEqual(m.compare_observations(a, a)['decision'], 'UNCHANGED')
        b = m.build_observation(reader(), CHECKOUT)
        self.assertEqual(m.compare_observations(a, b)['changedFields'], ['settings.max_mps', 'settings.wheel_pid_kp'])

    def test_settings_reject_credentials_unknown_keys_and_nonfinite_values(self):
        for value in (settings(ntrip_password=123), settings(max_wheel_speed=0.4), settings(),
                      {**settings(wheel_pid_kp=10), 'schemaVersion': True},
                      settings(wheel_pid_kp=float('nan')), settings(wheel_pid_kp=True)):
            with self.assertRaises(m.CollectionError): m.selected_settings(value)
        self.assertEqual(m.selected_settings(settings(wheel_pid_kp=10))['parameters'], {'wheel_pid_kp': '10.0'})

    def test_hash_tamper_duplicate_json_and_invalid_saved_fields_fail_closed(self):
        a = m.build_observation(reader(), CHECKOUT)
        b = copy.deepcopy(a); b['firmware']['version'] = '9.9.9'
        with self.assertRaisesRegex(m.CollectionError, 'hash_mismatch'): m.compare_observations(a, b)
        b = copy.deepcopy(a); b['firmware']['protocolVersion'] = True; resign(b)
        with self.assertRaises(m.CollectionError): m.compare_observations(a, b)
        for field, invalid in (('schemaVersion', True), ('firmware', [])):
            b = copy.deepcopy(a); b[field] = invalid; resign(b)
            with self.assertRaises(m.CollectionError): m.compare_observations(a, b)
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'bad.json'; path.write_text('{"x":1,"x":2}')
            with self.assertRaisesRegex(m.CollectionError, 'duplicate_json'): m.saved(path)

    def test_saved_cli_does_not_load_ros_and_refuses_overwrite(self):
        a = m.build_observation(reader(), CHECKOUT)
        with tempfile.TemporaryDirectory() as root, patch.object(m, 'Reader', side_effect=AssertionError('ROS must not load')):
            source, output = Path(root) / 'a.json', Path(root) / 'result.json'
            source.write_text(json.dumps(a))
            args = ['--baseline', str(source), '--current', str(source), '--output', str(output)]
            self.assertEqual(m.main(args), 0)
            self.assertEqual(json.loads(output.read_text())['decision'], 'UNCHANGED')
            self.assertEqual(m.main(args), 2)

    def test_reader_has_no_command_or_service_surface(self):
        source = inspect.getsource(m.Reader)
        for forbidden in ('create_publisher', '.publish(', 'create_client', 'call_async', 'subprocess', 'serial', 'socket'):
            self.assertNotIn(forbidden, source)
        self.assertIn('VOLATILE', source)
        self.assertIn('enable_rosout=False', source)


if __name__ == '__main__': unittest.main()
