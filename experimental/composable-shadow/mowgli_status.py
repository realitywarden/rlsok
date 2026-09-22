#!/usr/bin/env python3
"""Observe existing Mowgli firmware status. Never start the bridge or open USB.

No command publisher, service client, hardware configuration write or robot
command. Normal ROS node bookkeeping can still publish metadata. A publisher is not authenticated
physical identity. The public fake_hardware_bridge is explicitly rejected.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import time
from pathlib import Path
from uuid import uuid4

from collect import CollectionError, utc_now, write_output
from controller_state import canonical
from source_checkout import inspect_checkout

TOPIC = '/hardware_bridge/status'
MESSAGE_TYPE = 'mowgli_interfaces/msg/Status'
HARDWARE_NODE = '/hardware_bridge'
REFERENCE_COMMIT = 'faf658bc57b92410ee820adff9953e663b5b0230'
SETTING_KEYS = {'ticks_per_meter', 'wheel_track', 'max_mps', 'wheel_pid_kp',
    'wheel_pid_ki', 'wheel_pid_kd', 'wheel_pid_integral_limit', 'wheel_pid_pwm_per_mps',
    'deadband_pwm', 'yaw_gyro_sign'}


def selected_settings(value):
    if value is None: return None
    if not isinstance(value, dict) or set(value) != {'schemaVersion', 'provenance', 'sourceFileSha256', 'parameters'} or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1 or value['provenance'] != 'operator-selected-saved-not-live':
        raise CollectionError('mowgli_invalid_settings_selection')
    if not isinstance(value['sourceFileSha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', value['sourceFileSha256']):
        raise CollectionError('mowgli_settings_source_hash_required')
    parameters = value['parameters']
    if not isinstance(parameters, dict) or not parameters or not set(parameters).issubset(SETTING_KEYS):
        raise CollectionError('mowgli_unknown_or_empty_settings_selection')
    normalized = {}
    for key, number in parameters.items():
        if type(number) not in (int, float) or not math.isfinite(number) or abs(number) > 1e12:
            raise CollectionError('mowgli_finite_settings_value_required:' + key)
        normalized[key] = repr(float(number))
    return {'provenance': value['provenance'], 'sourceFileSha256': value['sourceFileSha256'], 'parameters': normalized}


def endpoint(reader):
    rows = reader.publishers()
    if len(rows) != 1 or rows[0].get('node') != HARDWARE_NODE or rows[0].get('type') != MESSAGE_TYPE:
        raise CollectionError('mowgli_hardware_publisher_missing_or_ambiguous')
    gid = rows[0].get('gid')
    if not isinstance(gid, str) or not re.fullmatch(r'(?:[0-9a-f]{32}|[0-9a-f]{48})', gid) or not int(gid, 16):
        raise CollectionError('mowgli_publisher_gid_unavailable')
    return rows[0]


def sample_gid(info):
    # rclpy Kilted MessageInfo is a dictionary; publisher_gid contains bytes.
    gid = info.get('publisher_gid') if isinstance(info, dict) else None
    raw = gid.get('data') if isinstance(gid, dict) else None
    # Kilted uses 16 bytes; earlier RMW layouts may expose 24. Compare the
    # complete reported byte sequence, never just a participant prefix.
    if not isinstance(raw, bytes) or len(raw) not in (16, 24) or not any(raw):
        raise CollectionError('mowgli_message_publisher_gid_unavailable')
    return raw.hex()


def build_observation(reader, checkout, settings=None):
    before = endpoint(reader)
    message, info, received_ns = reader.once()
    if sample_gid(info) != before['gid'] or endpoint(reader) != before:
        raise CollectionError('mowgli_publisher_changed_during_capture')
    stamp = message.stamp
    if type(stamp.sec) is not int or type(stamp.nanosec) is not int or not 0 <= stamp.sec <= 2147483647 or not 0 <= stamp.nanosec < 1_000_000_000:
        raise CollectionError('mowgli_invalid_message_stamp')
    stamp_ns = stamp.sec * 1_000_000_000 + stamp.nanosec
    age = received_ns - stamp_ns
    if stamp_ns == 0 or age < -1_000_000_000 or age > 5_000_000_000:
        raise CollectionError('mowgli_status_stale_or_clock_mismatch')
    version, protocol, compatible = message.firmware_version, message.firmware_protocol_version, message.firmware_compatible
    if not isinstance(version, str) or len(version) > 100 or type(protocol) is not int or not 0 <= protocol <= 255 or type(compatible) is not bool:
        raise CollectionError('mowgli_invalid_firmware_fields')
    if version.lower() == 'sim':
        raise CollectionError('mowgli_simulated_firmware_not_physical_evidence')
    issues = []
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or protocol == 0:
        issues.append('firmware_handshake_material_unavailable')
    if not compatible:
        issues.append('bridge_reports_firmware_incompatible')
    flags = {}
    for field in ('mow_enabled', 'firmware_debug_enabled', 'is_charging'):
        value = getattr(message, field)
        if type(value) is not bool: raise CollectionError('mowgli_invalid_status_flag:' + field)
        flags[field] = value
    observation = {
        'schemaVersion': 1, 'kind': 'RlsokMowgliFirmwareStatus', 'observedAt': utc_now(),
        'decision': 'NEEDS_MATERIAL' if issues else 'OBSERVED', 'issues': issues,
        'hardwareDispatch': False, 'authenticatedDevice': False,
        'source': {
            'referenceRepository': 'mowglinext/mowglinext', 'referenceCommit': REFERENCE_COMMIT,
            'selectedCheckoutCommit': checkout['commit'], 'selectedCheckoutDirty': checkout['dirty'],
            'installedBuildAttested': False, 'environment': reader.environment(),
            'status': {'topic': TOPIC, 'messageType': MESSAGE_TYPE, 'publisher': before},
        },
        'messageStamp': {'sec': stamp.sec, 'nanosec': stamp.nanosec},
        'receiptAgeNanoseconds': str(age), 'samplePublisherGid': sample_gid(info),
        'firmware': {'version': version, 'protocolVersion': protocol, 'bridgeReportsCompatible': compatible},
        'operatingFlags': flags,
        'selectedSettings': selected_settings(settings),
        'limitations': [
            'ROS endpoint metadata and reported firmware are not authenticated physical board identity.',
            'A renamed/spoofed publisher can imitate this source; no cryptographic origin proof is provided.',
            'Local checkout identity does not attest the installed container, running binary or flashed firmware.',
            'Timestamp age uses this reader clock; it is not a cross-machine clock synchronization measurement.',
            'No bridge was started/restarted, no USB port opened and no command, heartbeat or configuration sent by this reader.',
            'No PID/parameter service is read. Selected saved settings are operator-provided, not observed applied parameters.',
            'No motion authorization, mower/blade safety, physical calibration or customer acceptance is established.',
        ],
    }
    observation['observationSha256'] = hashlib.sha256(canonical(observation).encode()).hexdigest()
    return observation


def compare_observations(baseline, current):
    for value in (baseline, current):
        if not isinstance(value, dict): raise CollectionError('mowgli_invalid_saved_observation')
        body = {key: item for key, item in value.items() if key != 'observationSha256'}
        if value.get('kind') != 'RlsokMowgliFirmwareStatus' or type(value.get('schemaVersion')) is not int or value.get('schemaVersion') != 1 or value.get('hardwareDispatch') is not False or value.get('authenticatedDevice') is not False:
            raise CollectionError('mowgli_invalid_saved_observation')
        if hashlib.sha256(canonical(body).encode()).hexdigest() != value.get('observationSha256'):
            raise CollectionError('mowgli_saved_observation_hash_mismatch')
        fw = value.get('firmware', {})
        if not isinstance(fw, dict) or set(fw) != {'version', 'protocolVersion', 'bridgeReportsCompatible'}:
            raise CollectionError('mowgli_invalid_saved_firmware')
        if value.get('decision') != 'OBSERVED' or value.get('issues') != [] or not isinstance(fw['version'], str) or not re.fullmatch(r'\d+\.\d+\.\d+', fw['version']) or type(fw['protocolVersion']) is not int or not 1 <= fw['protocolVersion'] <= 255 or fw['bridgeReportsCompatible'] is not True:
            raise CollectionError('mowgli_complete_firmware_observations_required')
    changes = ['firmware.' + key for key in baseline['firmware'] if baseline['firmware'][key] != current['firmware'][key]]
    settings = []
    for value in (baseline, current):
        selection = value.get('selectedSettings')
        if selection is not None:
            if not isinstance(selection, dict) or set(selection) != {'provenance', 'sourceFileSha256', 'parameters'} or selection['provenance'] != 'operator-selected-saved-not-live' or not isinstance(selection['sourceFileSha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', selection['sourceFileSha256']):
                raise CollectionError('mowgli_invalid_saved_settings')
            parameters = selection['parameters']
            if not isinstance(parameters, dict) or not parameters or not set(parameters).issubset(SETTING_KEYS):
                raise CollectionError('mowgli_invalid_saved_settings')
            for number in parameters.values():
                if not isinstance(number, str) or len(number) > 100 or not re.fullmatch(r'-?\d+(?:\.\d+)?(?:e[+-]?\d+)?', number) or not math.isfinite(float(number)) or abs(float(number)) > 1e12:
                    raise CollectionError('mowgli_invalid_saved_settings')
        settings.append(selection['parameters'] if selection is not None else {})
    changes.extend('settings.' + key for key in sorted(set(settings[0]) | set(settings[1])) if settings[0].get(key) != settings[1].get(key))
    return {'schemaVersion': 1, 'kind': 'RlsokMowgliSavedFirmwareComparison',
        'decision': 'CHANGED' if changes else 'UNCHANGED', 'changedFields': changes,
        'baselineObservationSha256': baseline['observationSha256'],
        'currentObservationSha256': current['observationSha256'], 'hardwareDispatch': False,
        'scope': 'saved-reported-firmware-and-explicit-saved-settings',
        'selectedSettingsCompared': sorted(set(settings[0]) | set(settings[1])),
        'limitations': ['Only reported firmware and explicitly selected saved parameter values are compared.',
            'The selected reference is not an approval record. Saved hashes do not authenticate origin or prove freshness.',
            'Live/applied PID parameters, runtime flags, physical identity and calibration accuracy are not verified.']}


class Reader:
    def __enter__(self):
        import os
        import rclpy
        from rclpy.context import Context
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.qos import QoSProfile, DurabilityPolicy, ReliabilityPolicy
        from rclpy.utilities import get_rmw_implementation_identifier
        from rosidl_runtime_py.utilities import get_message
        self.os, self.rmw, self.get_message = os, get_rmw_implementation_identifier, get_message
        self.qos = QoSProfile(depth=1, durability=DurabilityPolicy.VOLATILE, reliability=ReliabilityPolicy.BEST_EFFORT)
        self.context = Context(); rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node('rlsok_mowgli_status_' + uuid4().hex, context=self.context,
                enable_rosout=False, start_parameter_services=False, use_global_arguments=False)
            self.executor = SingleThreadedExecutor(context=self.context); self.executor.add_node(self.node)
        except Exception:
            self.context.shutdown(); raise
        return self

    def __exit__(self, *_):
        try:
            self.executor.shutdown(timeout_sec=5); self.node.destroy_node()
        finally: self.context.shutdown()

    def environment(self):
        distro, domain = self.os.environ.get('ROS_DISTRO'), self.os.environ.get('ROS_DOMAIN_ID', '0')
        if not distro or not domain.isdigit() or not 0 <= int(domain) <= 232:
            raise CollectionError('mowgli_invalid_ros_environment')
        return {'rosDistro': distro, 'rmwImplementation': self.rmw(), 'domainId': int(domain)}

    def publishers(self):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            rows = self.node.get_publishers_info_by_topic(TOPIC)
            if rows:
                if len(rows) > 32: raise CollectionError('mowgli_too_many_publishers')
                return sorted([{'node': r.node_namespace.rstrip('/') + '/' + r.node_name,
                    'type': r.topic_type, 'gid': bytes(r.endpoint_gid).hex()} for r in rows], key=lambda r: (r['node'], r['gid']))
            self.executor.spin_once(timeout_sec=0.1)
        return []

    def once(self):
        received, deadline = [], time.monotonic() + 15
        def callback(message, info):
            if not received: received.append((message, info, self.node.get_clock().now().nanoseconds))
        subscription = self.node.create_subscription(self.get_message(MESSAGE_TYPE), TOPIC, callback, self.qos)
        try:
            while not received and time.monotonic() < deadline: self.executor.spin_once(timeout_sec=0.1)
            if not received: raise CollectionError('mowgli_status_timeout')
            return received[0]
        finally: self.node.destroy_subscription(subscription)


def saved(path):
    # A saved comparison never constructs Reader or loads ROS.
    from stat import S_ISREG
    import os
    if path.is_symlink(): raise CollectionError('mowgli_regular_saved_file_required')
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(descriptor, 'rb') as handle:
        if not S_ISREG(os.fstat(handle.fileno()).st_mode): raise CollectionError('mowgli_regular_saved_file_required')
        data = handle.read(2 * 1024 * 1024 + 1)
    if len(data) > 2 * 1024 * 1024: raise CollectionError('mowgli_saved_file_too_large')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise CollectionError('mowgli_duplicate_json_key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=unique)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--settings', type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--current', type=Path)
    args = parser.parse_args(argv)
    try:
        if args.output.exists(): raise CollectionError('output_already_exists')
        if args.baseline or args.current:
            if not args.baseline or not args.current or args.source_root or args.settings: raise CollectionError('mowgli_select_capture_or_saved_comparison')
            result = compare_observations(saved(args.baseline), saved(args.current))
        else:
            if not args.source_root: raise CollectionError('mowgli_source_root_required')
            checkout = inspect_checkout(args.source_root)
            settings = saved(args.settings) if args.settings else None
            selected_settings(settings)  # Validate before joining a ROS graph.
            with Reader() as reader: result = build_observation(reader, checkout, settings)
        write_output(args.output, result)
        print(result['decision'] + ' | Mowgli reported firmware / selected saved settings | hardware dispatch: NO')
        return 0 if result['decision'] in ('OBSERVED', 'UNCHANGED') else 1
    except Exception as error:
        print(f'mowgli_status_failed:{type(error).__name__}:{error}', file=sys.stderr); return 2


if __name__ == '__main__': sys.exit(main())
