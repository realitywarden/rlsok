#!/usr/bin/env python3
"""Capture a local, read-only PiDog Embodiment status observation.

The observer reads a selected checkout, the installed Nox systemd unit files,
installed SDK versions and one loopback HTTP GET of ``/status``.  It never
calls a movement endpoint, opens the daemon command socket, writes I2C, changes
a service or uploads the result.  The selected response intentionally omits
perception, faces, photos, audio, conversation history and environment-file
contents.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from collect import CollectionError, utc_now, write_output
from controller_state import canonical

SOURCE_FILES = (
    'body/nox_daemon.py',
    'body/nox_brain_bridge.py',
    'body/nox_i2c_diag.py',
    'body/services/nox-body.service',
    'body/services/nox-bridge.service',
    'body/services/nox-voice.service',
    'scripts/install-body.sh',
)
UNIT_NAMES = ('nox-body.service', 'nox-bridge.service', 'nox-voice.service')
PACKAGE_NAMES = ('pidog', 'robot-hat')
MCU_ADDRESSES = ('0x14', '0x15', '0x16')
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_STATUS_BYTES = 256 * 1024


def full_sha1(value, label='source_commit'):
    if len(value) != 40 or any(character not in '0123456789abcdef' for character in value):
        raise CollectionError(f'pidog_{label}_must_be_full_lowercase_sha1')
    return value


def finite_number(value, label):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise CollectionError('pidog_invalid_' + label)
    return value


def digest_file(path, label):
    if path.is_symlink() or not path.is_file():
        raise CollectionError('pidog_missing_regular_file:' + label)
    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        raise CollectionError('pidog_file_too_large:' + label)
    return {'path': label, 'bytes': size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def parse_unit(path, name):
    digest = digest_file(path, name)
    selected = {}
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith(('#', ';', '[')) or '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key in ('User', 'WorkingDirectory', 'ExecStart', 'EnvironmentFile'):
            selected[key] = value
        elif key == 'Environment' and value.startswith('PATH='):
            selected['PATH'] = value[5:]
    required = ('User', 'WorkingDirectory', 'ExecStart')
    if any(not selected.get(key) for key in required):
        raise CollectionError('pidog_incomplete_unit:' + name)
    if name in ('nox-body.service', 'nox-bridge.service') and '/usr/sbin' not in selected.get('PATH', '').split(':'):
        raise CollectionError('pidog_unit_path_missing_usr_sbin:' + name)
    return {**digest, 'selected': selected}


def validate_status_url(value):
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise CollectionError('pidog_status_url_must_be_loopback_http')
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path != '/status':
        raise CollectionError('pidog_status_url_must_be_exact_status_path')
    if parsed.port not in (None, 8888):
        raise CollectionError('pidog_status_url_port_must_be_8888')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CollectionError('pidog_status_redirect_refused')


def selected_status(raw):
    if not isinstance(raw, dict) or raw.get('ok') is not True:
        raise CollectionError('pidog_status_not_ok')
    sensors = raw.get('sensors')
    if not isinstance(sensors, dict):
        raise CollectionError('pidog_status_missing_sensors')
    i2c = sensors.get('i2c')
    if not isinstance(i2c, dict) or i2c.get('responding') is not True or i2c.get('verdict') != 'ok':
        raise CollectionError('pidog_robot_hat_mcu_not_confirmed')
    address = i2c.get('mcu_addr')
    if address not in MCU_ADDRESSES:
        raise CollectionError('pidog_robot_hat_mcu_address_invalid')
    if i2c.get('path_lacks_sbin') is not False:
        raise CollectionError('pidog_status_process_path_missing_sbin')
    battery = finite_number(sensors.get('battery_v'), 'battery_voltage')
    if battery <= 1.0 or battery > 20.0:
        raise CollectionError('pidog_battery_voltage_outside_powered_range')
    uptime = sensors.get('uptime_s')
    if type(uptime) is not int or uptime < 0:
        raise CollectionError('pidog_invalid_uptime')
    hostname = sensors.get('hostname')
    if not isinstance(hostname, str) or not hostname.strip() or len(hostname) > 255:
        raise CollectionError('pidog_invalid_hostname')
    behavior = raw.get('behavior') if isinstance(raw.get('behavior'), dict) else {}
    return {
        'ok': True,
        'hostname': hostname,
        'uptimeSeconds': uptime,
        'batteryVolts': repr(float(battery)),
        'robotHatMcu': {
            'address': address,
            'responding': True,
            'verdict': 'ok',
            'i2cDetectOnPath': i2c.get('i2cdetect_on_path') is True,
            'pathLacksSbin': False,
        },
        'behavior': {
            'state': behavior.get('state') if isinstance(behavior.get('state'), str) else None,
            'patrolEnabled': behavior.get('patrol_enabled') if type(behavior.get('patrol_enabled')) is bool else None,
        },
    }


class PiDogReader:
    def __init__(self, repo, units_directory, status_url):
        self.repo = repo.resolve()
        self.units_directory = units_directory.resolve()
        self.status_url = validate_status_url(status_url)

    def source(self):
        if not self.repo.is_dir():
            raise CollectionError('pidog_repo_missing')
        result = subprocess.run(
            ['git', '-C', str(self.repo), 'rev-parse', 'HEAD'], capture_output=True,
            text=True, timeout=10, check=False)
        if result.returncode != 0:
            raise CollectionError('pidog_git_revision_unavailable')
        commit = full_sha1(result.stdout.strip(), 'checkout_commit')
        dirty = subprocess.run(
            ['git', '-C', str(self.repo), 'diff', '--quiet', 'HEAD', '--', *SOURCE_FILES],
            timeout=10, check=False).returncode != 0
        files = [digest_file(self.repo / relative, relative) for relative in SOURCE_FILES]
        return {'commit': commit, 'selectedFilesDirty': dirty, 'files': files}

    def units(self):
        return [parse_unit(self.units_directory / name, name) for name in UNIT_NAMES]

    def packages(self):
        rows = []
        for name in PACKAGE_NAMES:
            try:
                version = importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError as error:
                raise CollectionError('pidog_required_package_missing:' + name) from error
            rows.append({'name': name, 'version': version})
        return rows

    def status(self):
        headers = {'Accept': 'application/json'}
        token = os.environ.get('RLSOK_PIDOG_STATUS_TOKEN')
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = urllib.request.Request(self.status_url, headers=headers, method='GET')
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=10) as response:
                data = response.read(MAX_STATUS_BYTES + 1)
        except (OSError, urllib.error.URLError) as error:
            raise CollectionError('pidog_status_get_failed:' + type(error).__name__) from error
        if len(data) > MAX_STATUS_BYTES:
            raise CollectionError('pidog_status_response_too_large')
        try:
            return json.loads(data.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise CollectionError('pidog_status_response_invalid_json') from error

    def environment(self):
        return {'python': sys.version.split()[0], 'platform': sys.platform}

    def status_request(self):
        return {'method': 'GET', 'url': self.status_url}


def build_observation(reader, source_commit):
    source_commit = full_sha1(source_commit)
    source = reader.source()
    if source['commit'] != source_commit:
        raise CollectionError('pidog_checkout_commit_mismatch')
    if source['selectedFilesDirty']:
        raise CollectionError('pidog_selected_source_files_dirty')
    observation = {
        'schemaVersion': 1,
        'kind': 'RlsokPiDogEmbodimentStatus',
        'observedAt': utc_now(),
        'operatorSelection': {'sourceCommit': source_commit},
        'localEnvironment': reader.environment(),
        'source': source,
        'installedUnits': reader.units(),
        'installedPackages': reader.packages(),
        'status': selected_status(reader.status()),
        'network': {'requests': [reader.status_request()], 'automaticUpload': False},
        'dispatch': {'movementApiCalls': 0, 'daemonCommands': 0, 'serviceChanges': 0, 'i2cWrites': 0},
        'privacy': {'persisted': ['selected service fields', 'selected source digests', 'SDK versions', 'selected hardware status'],
                    'omitted': ['environment contents', 'tokens', 'faces', 'photos', 'audio', 'perception', 'conversation history']},
        'limits': {
            'proves': 'the selected local Nox checkout and services reported one live powered robot_hat MCU status path',
            'doesNotProve': ['servo motion', 'command delivery', 'PiDog serial identity', 'physical safety', 'customer acceptance'],
        },
    }
    observation['observationSha256'] = hashlib.sha256(canonical(observation).encode()).hexdigest()
    return observation


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--units-directory', type=Path, default=Path('/etc/systemd/system'))
    parser.add_argument('--status-url', default='http://127.0.0.1:8888/status')
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise CollectionError('output_already_exists')
        result = build_observation(PiDogReader(args.repo, args.units_directory, args.status_url), args.source_commit)
        write_output(args.output, result)
        print('OBSERVED | PiDog local robot_hat status read only | hardware dispatch: NO')
        return 0
    except Exception as error:
        print(f'pidog_status_capture_failed:{type(error).__name__}:{error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
