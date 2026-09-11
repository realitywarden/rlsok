#!/usr/bin/env python3
"""Focused local ROS service experiment. Never imports a Tello driver or runs main.

Requires the installed public tello_msgs/srv/TelloAction serializer, Node 22,
the built RLSOK CLI, and the pinned public client source as explicit inputs.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def wait_json(path, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            return json.loads(path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            time.sleep(0.05)
    raise RuntimeError('timed_out_waiting_for:' + str(path))


def run(source, output, node, cli):
    if os.environ.get('ROS_LOCALHOST_ONLY') != '1' or os.environ.get('ROS_AUTOMATIC_DISCOVERY_RANGE') != 'LOCALHOST':
        raise ValueError('set_both_ros_localhost_isolation_variables')
    source_hash = hashlib.sha256((source.read_text(encoding='utf-8').rstrip() + '\n').encode()).hexdigest()
    if source_hash != 'ecdb575bca01b4118ba7902a039821ad075e74bf400bc9e12ce733048cef6969':
        raise ValueError('pinned_public_client_source_required')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    here = Path(__file__).resolve().parent
    namespace = '/rlsok_tello_test_' + uuid.uuid4().hex[:10]
    package = output / 'tello_simple_teleop'
    package.mkdir()
    (package / '__init__.py').write_text('')
    shutil.copy(source, package / 'tello_simple_teleop.py')
    shutil.copy(here / 'tello_observer.py', package / 'tello_observer.py')
    subprocess.run(['git', 'apply', '--check', str(here / 'client-observation.patch')], cwd=output, check=True)
    subprocess.run(['git', 'apply', str(here / 'client-observation.patch')], cwd=output, check=True)
    local_socket_dir = tempfile.TemporaryDirectory(prefix='rlsok-tello-socket-')
    socket_path = Path(local_socket_dir.name) / 'events.sock'
    os.environ['RLSOK_TELLO_SOCKET'] = str(socket_path)
    sys.path.insert(0, str(output))
    import rclpy
    from rclpy.node import Node
    from rclpy.executors import SingleThreadedExecutor
    from tello_msgs.srv import TelloAction
    from tello_simple_teleop.tello_simple_teleop import MinimalClientAsync
    from tello_context import ContextReader
    rclpy.init(args=['--ros-args', '-r', '__ns:=' + namespace])
    server = Node('tello_mock')
    received = []
    def response(request, result):
        received.append(request.cmd)
        result.rc = TelloAction.Response.OK
        return result
    server.create_service(TelloAction, 'tello_action', response)
    executor = SingleThreadedExecutor()
    executor.add_node(server)
    worker = threading.Thread(target=executor.spin, daemon=True)
    worker.start()
    client = None
    watcher = None
    log_stream = None
    try:
        client = MinimalClientAsync()
        selected_file = output / 'selected-configuration.json'
        write(selected_file, {'fixtureOnly': True, 'localSoftwareSelection': 'baseline'})
        manifest = {'schemaVersion': 1, 'clientNode': namespace + '/minimal_client_async',
                    'serverNode': namespace + '/tello_mock', 'endpoint': namespace + '/tello_action',
                    'clientServiceName': client.cli.srv_name,
                    'files': [{'id': 'teleop-source', 'path': str(package / 'tello_simple_teleop.py')},
                              {'id': 'selected-config', 'path': str(selected_file)}]}
        manifest_path = output / 'manifest.json'
        write(manifest_path, manifest)
        with ContextReader(manifest_path) as reader:
            write(output / 'baseline.json', reader.capture())
        expires = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
        def cli_run(*args, expected=0):
            r = subprocess.run([node, cli, 'profile', *args], capture_output=True, text=True, timeout=20)
            if r.returncode != expected:
                raise RuntimeError(r.stdout + r.stderr)
        cli_run('approve-tello', '--observation', str(output / 'baseline.json'), '--actor', 'isolated-software-experiment',
                '--expires-at', expires, '--output', str(output / 'approval.json'))
        log_stream = (output / 'watcher.log').open('w')
        watcher = subprocess.Popen([sys.executable, str(here / 'tello_watch.py'), '--manifest', str(manifest_path),
            '--approval', str(output / 'approval.json'), '--socket', str(socket_path), '--output', str(output / 'session'),
            '--node', node, '--cli', cli, '--duration', '90', '--ready-file', str(output / 'ready.json')],
            stdout=log_stream, stderr=subprocess.STDOUT)
        wait_json(output / 'ready.json')
        results = []
        owner_calls = []
        def send_probe(cmd):
            before = len(received)
            owner_calls.append(cmd)
            client.send_request(cmd)
            # DDS can deliver one service request to multiple servers sharing
            # the same endpoint. Count owner calls and server receipts separately.
            assert len(received) >= before + 1 and client.future.result().rc == TelloAction.Response.OK
        def call_case(label, expected):
            send_probe('offline-observation-probe')
            report = wait_json(output / ('session/event-%06d/review/report.json' % (len(results) + 1)))
            assert report['decision'] == expected, report
            assert report['commandDispatches'] == 0 and report['commandsBlocked'] == 0
            results.append({'case': label, 'decision': report['decision'], 'reasons': report['reasons'],
                            'ownerServiceCompleted': True, 'reportEvidenceSha256': report['evidenceSha256']})
        call_case('actual-service-baseline', 'WOULD_ALLOW')
        write(selected_file, {'fixtureOnly': True, 'localSoftwareSelection': 'changed'})
        call_case('selected-file-change-same-approval', 'WOULD_BLOCK')
        write(selected_file, {'fixtureOnly': True, 'localSoftwareSelection': 'baseline'})
        call_case('original-selected-file-restored', 'WOULD_ALLOW')
        # Add a second actual server for this unique test endpoint. The service
        # still completes; ambiguous graph metadata only changes the report.
        second = Node('other_mock')
        second.create_service(TelloAction, 'tello_action', response)
        executor.add_node(second)
        time.sleep(0.5)
        call_case('two-actual-service-servers', 'WOULD_BLOCK')
        executor.remove_node(second)
        second.destroy_node()
        watcher.send_signal(signal.SIGINT)
        watcher.wait(timeout=5)
        watcher = None
        recorded_summary = wait_json(output / 'session/summary.json')
        assert recorded_summary['wouldAllow'] == 2 and recorded_summary['wouldBlock'] == 2
        assert recorded_summary['reviewFailures'] == 0
        send_probe('offline-recorder-absent-probe')
        results.append({'case': 'recorder-process-stopped', 'ownerServiceCompleted': True,
                        'configurationDecisionAvailable': False})
        watcher = subprocess.Popen([sys.executable, str(here / 'tello_watch.py'), '--manifest', str(manifest_path),
            '--socket', str(socket_path), '--output', str(output / 'capture-only'), '--node', node, '--cli', cli,
            '--duration', '30', '--ready-file', str(output / 'capture-ready.json')],
            stdout=log_stream, stderr=subprocess.STDOUT)
        wait_json(output / 'capture-ready.json')
        send_probe('offline-capture-only-probe')
        snapshot = wait_json(output / 'capture-only/event-000001/observation.json')
        assert not (output / 'capture-only/event-000001/review').exists()
        # A recorder attached midway through a client session must expose the
        # missing prefix. A separately captured baseline remains available.
        assert 'observation_sequence_gap_or_replay' in snapshot['issues']
        watcher.send_signal(signal.SIGINT)
        watcher.wait(timeout=5)
        watcher = None
        assert wait_json(output / 'capture-only/summary.json')['baselineCaptures'] == 1
        results.append({'case': 'capture-without-approval', 'ownerServiceCompleted': True,
                        'configurationDecisionAvailable': False, 'missingSessionPrefixReported': True})
        # Exercise the documented first-session workflow: recorder is ready
        # before a fresh client exists, and approval is made from its capture.
        client.destroy_node()
        client = None
        from tello_simple_teleop import tello_observer
        tello_observer._recorder.close()
        tello_observer._recorder = tello_observer.PassiveRecorder()
        watcher = subprocess.Popen([sys.executable, str(here / 'tello_watch.py'), '--manifest', str(manifest_path),
            '--socket', str(socket_path), '--output', str(output / 'first-session'), '--node', node, '--cli', cli,
            '--duration', '30', '--ready-file', str(output / 'first-ready.json')],
            stdout=log_stream, stderr=subprocess.STDOUT)
        wait_json(output / 'first-ready.json', timeout=20)
        client = MinimalClientAsync()
        send_probe('offline-first-session-probe')
        snapshot_path = output / 'first-session/event-000001/observation.json'
        snapshot = wait_json(snapshot_path)
        assert snapshot['issues'] == [], snapshot
        cli_run('approve-tello', '--observation', str(snapshot_path), '--actor', 'isolated-software-experiment',
                '--expires-at', expires, '--output', str(output / 'first-session-approval.json'))
        watcher.send_signal(signal.SIGINT)
        watcher.wait(timeout=5)
        watcher = None
        assert wait_json(output / 'first-session/summary.json')['baselineCaptures'] == 1
        results.append({'case': 'first-capture-before-new-client', 'ownerServiceCompleted': True,
                        'freshCapturedBaselineApproved': True, 'noImplicitApproval': True})
        summary = {'kind': 'RlsokTelloIsolatedRosValidation', 'results': results,
                   'ownerServiceCalls': len(owner_calls), 'mockServerReceipts': len(received),
                   'rlsokCommandRequests': 0, 'physicalCommands': 0,
                   'upstreamMainExecuted': False, 'telloDriverStarted': False,
                   'rosDistro': os.environ.get('ROS_DISTRO'), 'namespace': namespace, 'publicClientSha256': source_hash}
        write(output / 'validation.json', summary)
        print(json.dumps(summary, indent=2))
    finally:
        if watcher is not None and watcher.poll() is None:
            watcher.terminate()
            watcher.wait(timeout=5)
        if log_stream is not None:
            log_stream.close()
        if client is not None:
            client.destroy_node()
        executor.shutdown(timeout_sec=2)
        worker.join(timeout=2)
        server.destroy_node()
        rclpy.shutdown()
        local_socket_dir.cleanup()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-client', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--node', required=True)
    parser.add_argument('--cli', required=True)
    args = parser.parse_args()
    run(args.source_client.resolve(), args.output.resolve(), args.node, args.cli)
