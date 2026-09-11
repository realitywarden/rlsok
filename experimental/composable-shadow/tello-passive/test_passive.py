"""Focused observer checks. No ROS or drone command transport is created."""
import ast
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tello_observer import PassiveRecorder
from tello_capture import validate_event


class PassiveTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='rlsok-tello-')
        self.path = str(Path(self.folder.name) / 'events.sock')
        self.addCleanup(self.folder.cleanup)

    def receiver(self):
        receiver = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        self.addCleanup(receiver.close)
        receiver.bind(self.path)
        receiver.settimeout(1)
        return receiver

    def recorder(self):
        recorder = PassiveRecorder(self.path)
        self.addCleanup(recorder.close)
        return recorder

    def test_exact_payload_and_client_reported_service(self):
        receiver = self.receiver()
        recorder = self.recorder()
        self.assertTrue(recorder.record('/tello2/tello_action', 'rc 0 1 0 -2'))
        event = validate_event(json.loads(receiver.recv(65536)))
        self.assertEqual(event['request']['cmd'], 'rc 0 1 0 -2')
        self.assertEqual(event['service'], '/tello2/tello_action')
        self.assertEqual(event['boundary'], 'client_call_async_returned')

    def test_foxy_relative_service_is_preserved_without_claiming_resolution(self):
        receiver = self.receiver()
        self.assertTrue(self.recorder().record('tello_action', 'offline-example'))
        event = validate_event(json.loads(receiver.recv(65536)))
        self.assertEqual(event['service'], 'tello_action')
        self.assertFalse(event['serviceResolutionVerified'])

    def test_absent_recorder_drops_without_raising_then_recovers(self):
        recorder = self.recorder()
        self.assertFalse(recorder.record('/tello_action', 'example'))
        receiver = self.receiver()
        self.assertTrue(recorder.record('/tello_action', 'second'))
        event = json.loads(receiver.recv(65536))
        self.assertEqual((event['sequence'], event['droppedBefore']), (2, 1))

    def test_disabled_does_not_create_a_socket(self):
        with patch('tello_observer.socket.socket', side_effect=AssertionError('socket_created')):
            recorder = PassiveRecorder('')
            self.assertFalse(recorder.record('/tello_action', 'example'))

    def test_full_receiver_queue_never_waits(self):
        self.receiver()
        recorder = self.recorder()
        # Bound this socket's actual kernel buffer instead of assuming the
        # machine-wide max_dgram_qlen setting is smaller than 100 packets.
        recorder.sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 2048)
        for _ in range(100):
            if not recorder.record('/tello_action', 'example'):
                break
        else:
            self.fail('expected_bounded_kernel_queue')
        self.assertGreater(recorder.dropped, 0)
        self.assertEqual(recorder.sock.gettimeout(), 0.0)

    def test_bad_input_and_broken_socket_do_not_escape(self):
        recorder = self.recorder()
        self.assertFalse(recorder.record('', 'example'))
        self.assertFalse(recorder.record('/tello_action', 'x' * 4097))
        recorder.close()
        self.assertFalse(recorder.record('/tello_action', 'example'))

    def test_patch_places_observation_after_call_and_preserves_original_future(self):
        # Build the exact patched send_request from its context + added lines;
        # never import or invoke the upstream main (it would issue takeoff).
        lines = (Path(__file__).parent / 'client-observation.patch').read_text().splitlines()
        start = next(i for i, line in enumerate(lines) if line.startswith('     def send_request'))
        source = '\n'.join(line[1:] for line in lines[start:] if line[:1] in (' ', '+'))
        source = 'class Client:\n' + source
        for observer_raises in (False, True):
            calls = []
            original_future = object()
            request = SimpleNamespace(cmd='')
            def original_call(req):
                calls.append(('original', req.cmd))
                return original_future
            def observe(service, cmd, client_node=None):
                calls.append(('observe', cmd))
                if observer_raises:
                    raise RuntimeError('recorder_failure')
                return False
            def spin(owner, future):
                self.assertIs(future, original_future)
                calls.append(('spin', owner.req.cmd))
            env = {'record_call': observe, 'rclpy': SimpleNamespace(spin_until_future_complete=spin)}
            exec(compile(ast.parse(source), 'patched_send_request', 'exec'), env)
            client = env['Client']()
            client.req = request
            client.get_fully_qualified_name = lambda: '/minimal_client_async'
            client.cli = SimpleNamespace(call_async=original_call, srv_name='/tello_action')
            client.send_request('offline-example')
            self.assertEqual(calls, [('original', 'offline-example'), ('observe', 'offline-example'), ('spin', 'offline-example')])
            self.assertIs(client.req, request)

    def test_collector_process_records_exact_event_and_malformed_data(self):
        output = Path(self.folder.name) / 'observations.jsonl'
        process = subprocess.Popen([sys.executable, str(Path(__file__).parent / 'tello_capture.py'),
                                    '--socket', self.path, '--output', str(output), '--duration', '0.6'],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertIn('Local recorder ready', process.stdout.readline())
            recorder = self.recorder()
            self.assertTrue(recorder.record('/tello_action', 'offline-only'))
            recorder.sock.sendto(b'not json', self.path)
            _, error = process.communicate(timeout=3)
            self.assertEqual(process.returncode, 0, error)
            rows = [json.loads(line) for line in output.read_text().splitlines()]
            self.assertEqual(rows[0]['observation']['request']['cmd'], 'offline-only')
            self.assertFalse(rows[0]['rlsokCommandDispatch'])
            self.assertFalse(rows[0]['rlsokCommandBlocked'])
            self.assertIn('invalidObservation', rows[1])
            self.assertFalse(Path(self.path).exists())
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()


if __name__ == '__main__':
    unittest.main()
