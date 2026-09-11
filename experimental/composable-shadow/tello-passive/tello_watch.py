#!/usr/bin/env python3
"""Receive optional client observations and review on a separate local process.

No reply channel to the client exists. Review errors cannot gate the owner.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import signal
import stat
import subprocess
import time

from tello_context import ContextReader, utc_now
from tello_capture import validate_event


def write_new(path, data):
    with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as stream:
        json.dump(data, stream, indent=2)
        stream.write('\n')


def watch(manifest, approval, address, output, node, cli, duration, ready_file=None, should_stop=lambda: False):
    parent = address.parent.resolve(strict=True)
    info = parent.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError('socket_directory_must_be_owned_and_private_0700')
    if address.exists() or address.is_symlink():
        raise ValueError('socket_path_already_exists')
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    # Snapshot the reviewed local approval for this session, never replace it.
    if approval is not None:
        if approval.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('approval_too_large')
        write_new(output / 'approval.json', json.loads(approval.read_text(encoding='utf-8')))
    endpoint = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    bound = False
    sequence = {}
    summary = {'startedAt': utc_now(), 'received': 0, 'wouldAllow': 0, 'wouldBlock': 0, 'baselineCaptures': 0,
               'reviewFailures': 0, 'commandDispatches': 0, 'commandsBlocked': 0,
               'scope': 'instrumented-client-post-call-review', 'completeCaptureVerified': False}
    try:
        with ContextReader(manifest) as reader:
            endpoint.bind(str(address))
            bound = True
            os.chmod(address, 0o600)
            endpoint.settimeout(0.25)
            deadline = time.monotonic() + duration
            if ready_file:
                write_new(ready_file, {'ready': True, 'socket': str(address)})
            print('Tello passive Shadow ready: ' + str(address), flush=True)
            while time.monotonic() < deadline and not should_stop():
                try:
                    data = endpoint.recv(65536)
                except socket.timeout:
                    continue
                summary['received'] += 1
                case = output / ('event-%06d' % summary['received'])
                case.mkdir(mode=0o700)
                try:
                    event = validate_event(json.loads(data))
                    write_new(case / 'event.json', event)
                    snapshot = reader.capture()
                    prior = sequence.get(event['session'], 0)
                    if event['sequence'] != prior + 1:
                        snapshot['issues'].append('observation_sequence_gap_or_replay')
                    sequence[event['session']] = max(prior, event['sequence'])
                    write_new(case / 'observation.json', snapshot)
                    if approval is None:
                        summary['baselineCaptures'] += 1
                        print(case.name + ': CAPTURE_ONLY (no approval or decision)', flush=True)
                        continue
                    result = subprocess.run([node, cli, 'profile', 'review-tello',
                        '--approval', str(output / 'approval.json'), '--observation', str(case / 'observation.json'),
                        '--event', str(case / 'event.json'), '--output', str(case / 'review')],
                        capture_output=True, text=True, timeout=15)
                    if result.returncode not in (0, 1):
                        raise ValueError('review_process_failed:' + result.stderr[-2000:])
                    report = json.loads((case / 'review/report.json').read_text())
                    summary['wouldAllow' if report['decision'] == 'WOULD_ALLOW' else 'wouldBlock'] += 1
                    print(case.name + ': ' + report['decision'], flush=True)
                except Exception as error:
                    summary['reviewFailures'] += 1
                    write_new(case / 'failure.json', {'error': str(error), 'commandDispatches': 0,
                                                     'commandsBlocked': 0, 'configurationDecisionAvailable': False})
                    print(case.name + ': REVIEW_UNAVAILABLE', flush=True)
    except KeyboardInterrupt:
        summary['stoppedByOperator'] = True
    finally:
        endpoint.close()
        if bound:
            address.unlink(missing_ok=True)
        if should_stop():
            summary['stoppedByOperator'] = True
        summary['completedAt'] = utc_now()
        write_new(output / 'summary.json', summary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('manifest', 'socket', 'output'):
        parser.add_argument('--' + key, type=Path, required=True)
    parser.add_argument('--approval', type=Path)
    parser.add_argument('--node', required=True)
    parser.add_argument('--cli', required=True)
    parser.add_argument('--duration', type=float, default=300)
    parser.add_argument('--ready-file', type=Path)
    args = parser.parse_args()
    if not 0 < args.duration <= 3600:
        parser.error('duration must be between 0 and 3600 seconds')
    stop_state = {'requested': False}
    def stop(_signal, _frame):
        # Finish accounting for an already received observation before writing
        # the summary; never interrupt between report creation and its count.
        stop_state['requested'] = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        watch(args.manifest.resolve(), args.approval.resolve() if args.approval else None, args.socket.resolve(), args.output.resolve(),
              args.node, args.cli, args.duration, args.ready_file, lambda: stop_state['requested'])
    except Exception as error:
        parser.exit(2, 'tello_watch_failed: %s\n' % error)


if __name__ == '__main__':
    main()
