#!/usr/bin/env python3
"""Capture Tello client observations locally. This process cannot send commands."""
import argparse
import json
import os
from pathlib import Path
import socket
import stat
import time


def validate_event(event):
    if not isinstance(event, dict):
        raise ValueError('object_required')
    if event.get('kind') != 'RlsokTelloClientObservation' or event.get('schemaVersion') != 1:
        raise ValueError('wrong_event_schema')
    if event.get('boundary') != 'client_call_async_returned':
        raise ValueError('wrong_boundary')
    if event.get('serviceType') != 'tello_msgs/srv/TelloAction':
        raise ValueError('wrong_service_type')
    if not isinstance(event.get('service'), str) or not event['service'] or len(event['service']) > 256:
        raise ValueError('client_reported_service_required')
    if event.get('serviceNameSource') != 'client.srv_name' or event.get('serviceResolutionVerified') is not False:
        raise ValueError('client_service_name_boundary_required')
    if not isinstance(event.get('request'), dict) or not isinstance(event['request'].get('cmd'), str) or len(event['request']['cmd']) > 4096:
        raise ValueError('bounded_command_string_required')
    for field in ('sequence', 'observedAtUnixNs'):
        if type(event.get(field)) is not int or event[field] < 1:
            raise ValueError('positive_integer_required:' + field)
    if type(event.get('droppedBefore')) is not int or event['droppedBefore'] < 0:
        raise ValueError('drop_count_required')
    if not isinstance(event.get('session'), str) or not event['session'] or len(event['session']) > 128:
        raise ValueError('session_required')
    return event


def capture(socket_path, output, duration):
    if os.name != 'posix':
        raise ValueError('linux_unix_socket_required')
    parent = socket_path.parent.resolve(strict=True)
    info = parent.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError('socket_directory_must_be_owned_and_private_0700')
    if socket_path.exists() or socket_path.is_symlink():
        raise ValueError('socket_path_already_exists')
    bound = False
    endpoint = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    try:
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            endpoint.bind(str(socket_path))
            bound = True
            os.chmod(socket_path, 0o600)
            deadline = time.monotonic() + duration
            print('Local recorder ready: ' + str(socket_path), flush=True)
            while time.monotonic() < deadline:
                endpoint.settimeout(max(0.001, min(0.25, deadline - time.monotonic())))
                try:
                    payload = endpoint.recv(65536)
                except socket.timeout:
                    continue
                try:
                    event = validate_event(json.loads(payload))
                    record = {'receivedAtUnixNs': time.time_ns(), 'observation': event,
                              'rlsokCommandDispatch': False, 'rlsokCommandBlocked': False,
                              'driverReceiptVerified': False, 'physicalResultVerified': False}
                except (ValueError, TypeError, UnicodeError) as error:
                    record = {'receivedAtUnixNs': time.time_ns(), 'invalidObservation': str(error)}
                stream.write(json.dumps(record, ensure_ascii=True) + '\n')
                stream.flush()
    finally:
        endpoint.close()
        if bound:
            socket_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--socket', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--duration', type=float, default=300)
    args = parser.parse_args()
    if not 0 < args.duration <= 3600:
        parser.error('duration must be between 0 and 3600 seconds')
    try:
        capture(args.socket, args.output, args.duration)
    except (OSError, ValueError) as error:
        parser.exit(2, 'capture_failed: %s\n' % error)


if __name__ == '__main__':
    main()
