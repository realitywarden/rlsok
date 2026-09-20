"""Focused offline tests for the PiDog Embodiment read-only observer."""
from types import SimpleNamespace
import inspect
import unittest

import pidog_status


COMMIT = 'e88a3979b7ad200c9ce016b849cd6a3b2bcc3a54'


class PiDogStatusTests(unittest.TestCase):
    def reader(self, *, commit=COMMIT, dirty=False, responding=True, battery=7.72):
        raw = {
            'ok': True,
            'sensors': {
                'hostname': 'nox-pidog', 'uptime_s': 100,
                'battery_v': battery,
                'i2c': {'mcu_addr': '0x15', 'responding': responding, 'verdict': 'ok' if responding else 'wrong_address',
                        'i2cdetect_on_path': True, 'path_lacks_sbin': False},
            },
            'behavior': {'state': 'idle', 'patrol_enabled': True},
            'perception': {'faces': ['private-person'], 'scene': 'private-room'},
            'known_faces': {'private-person': '/private/photo.jpg'},
        }
        return SimpleNamespace(
            source=lambda: {'commit': commit, 'selectedFilesDirty': dirty, 'files': [{'path': 'body/nox_daemon.py', 'bytes': 1, 'sha256': 'a' * 64}]},
            units=lambda: [{'path': 'nox-body.service', 'bytes': 1, 'sha256': 'b' * 64, 'selected': {'User': 'pidog'}}],
            packages=lambda: [{'name': 'pidog', 'version': '1.3.11'}, {'name': 'robot-hat', 'version': '2.5.2a1'}],
            status=lambda: raw,
            environment=lambda: {'python': '3.11.0', 'platform': 'linux'},
            status_request=lambda: {'method': 'GET', 'url': 'http://127.0.0.1:8888/status'},
        )

    def test_records_selected_powered_hardware_path_without_private_status(self):
        result = pidog_status.build_observation(self.reader(), COMMIT)
        self.assertEqual(result['kind'], 'RlsokPiDogEmbodimentStatus')
        self.assertEqual(result['status']['robotHatMcu']['address'], '0x15')
        self.assertEqual(result['status']['batteryVolts'], '7.72')
        self.assertEqual(result['dispatch']['movementApiCalls'], 0)
        self.assertNotIn('private-person', str(result))
        self.assertRegex(result['observationSha256'], r'^[a-f0-9]{64}$')

    def test_rejects_unconfirmed_hardware_and_changed_selected_source(self):
        with self.assertRaisesRegex(pidog_status.CollectionError, 'mcu_not_confirmed'):
            pidog_status.build_observation(self.reader(responding=False), COMMIT)
        with self.assertRaisesRegex(pidog_status.CollectionError, 'source_files_dirty'):
            pidog_status.build_observation(self.reader(dirty=True), COMMIT)
        with self.assertRaisesRegex(pidog_status.CollectionError, 'checkout_commit_mismatch'):
            pidog_status.build_observation(self.reader(commit='0' * 40), COMMIT)

    def test_only_exact_loopback_status_get_is_allowed(self):
        self.assertEqual(pidog_status.validate_status_url('http://127.0.0.1:8888/status'), 'http://127.0.0.1:8888/status')
        for value in ('https://127.0.0.1:8888/status', 'http://robot.local:8888/status',
                      'http://127.0.0.1:8888/selftest', 'http://127.0.0.1:8888/status?full=true'):
            with self.assertRaises(pidog_status.CollectionError):
                pidog_status.validate_status_url(value)
        source = inspect.getsource(pidog_status.PiDogReader.status)
        self.assertIn("method='GET'", source)
        for forbidden in ('POST', '/selftest', '/action', 'systemctl', '.write('):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
