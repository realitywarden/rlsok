#!/usr/bin/env python3
"""Observe a RealRobot UR7e through RTDE Receive only; never control the arm.

This is a separate short-lived receive connection, not RealRobot's backend:
that backend also creates Control/IO interfaces and calls stopScript on exit.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import math
import sys
import time
from pathlib import Path

from collect import CollectionError, utc_now, write_output
from source_checkout import inspect_checkout


def canonical(value) -> str:
    try:
        return json.dumps(value, sort_keys=True, separators=(',', ':'),
                          ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError, RecursionError) as error:
        raise CollectionError('realrobot_configuration_not_canonical_json') from error


def selected_config(source_root: Path) -> tuple[str, dict]:
    """Return the local host for connection and a host-free review selection."""
    try:
        import yaml
    except ImportError as error:
        raise CollectionError('pyyaml_required_in_realrobot_environment') from error
    paths = (source_root / 'configs' / 'application.yaml',
             source_root / 'configs' / 'robots' / 'ur7e.yaml')
    values = []
    for path in paths:
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 1024 * 1024:
            raise CollectionError('realrobot_configuration_file_missing_or_oversized')
        try:
            value = yaml.safe_load(path.read_text(encoding='utf-8'))
        except (OSError, UnicodeError, yaml.YAMLError) as error:
            raise CollectionError('realrobot_configuration_invalid') from error
        if not isinstance(value, dict):
            raise CollectionError('realrobot_configuration_invalid')
        values.append(value)
    app, robot = values
    try:
        reference = app['robot']
        details = robot['robot']
        connection = details['connection']
        host = connection['host']
        motion = details['manual_control']
        safety = details['safety']
        selected = {
            'applicationVersion': str(app['application']['version']),
            'manufacturer': reference['manufacturer'],
            'model': reference['model'],
            'backend': reference['backend'],
            'displayName': details['display_name'],
            'receiveHz': details['state']['receive_hz'],
            'manualControl': {
                'jointJogSpeed': {name: motion['joint_jog_speed'][name]
                                  for name in ('slow', 'medium', 'fast')},
                'tcpJogSpeed': {name: motion['tcp_jog_speed'][name]
                                for name in ('slow', 'medium', 'fast')},
                'defaultJointSpeed': motion['default_joint_speed'],
                'defaultJointAcceleration': motion['default_joint_acceleration'],
                'defaultTcpSpeed': motion['default_tcp_speed'],
                'defaultTcpAcceleration': motion['default_tcp_acceleration'],
            },
            'safety': {name: safety[name] for name in (
                'require_motion_confirmation', 'require_power_confirmation',
                'require_brake_release_confirmation', 'auto_resume_motion')},
        }
    except (KeyError, TypeError) as error:
        raise CollectionError('realrobot_configuration_shape_mismatch') from error
    if (selected['manufacturer'], selected['model'], selected['backend']) != (
            'universal_robots', 'ur7e', 'ur_rtde'):
        raise CollectionError('realrobot_expected_ur7e_rtde_selection')
    if not isinstance(host, str):
        raise CollectionError('realrobot_host_missing')
    try:
        address = ipaddress.ip_address(host)
    except ValueError as error:
        raise CollectionError('realrobot_host_must_be_numeric_ip') from error
    if (not isinstance(address, ipaddress.IPv4Address) or not address.is_private
            or address.is_unspecified or address.is_loopback or address.is_multicast):
        raise CollectionError('realrobot_host_must_be_private_ipv4')
    # Never persist the IP, an unsalted hash of it, or raw configuration files.
    return host, selected


def _finite_vector(value, length: int, label: str) -> list[float]:
    try:
        result = [float(item) for item in value]
    except (TypeError, ValueError, OverflowError) as error:
        raise CollectionError('realrobot_invalid_' + label) from error
    if len(result) != length or any(not math.isfinite(item) for item in result):
        raise CollectionError('realrobot_invalid_' + label)
    return result


def build_observation(receive, selected: dict, checkout: dict, pause=time.sleep) -> dict:
    try:
        first = float(receive.getTimestamp())
        pause(0.25)
        second = float(receive.getTimestamp())
        robot_mode = int(receive.getRobotMode())
        safety_mode = int(receive.getSafetyMode())
        positions = _finite_vector(receive.getActualQ(), 6, 'joint_positions')
        speeds = _finite_vector(receive.getActualQd(), 6, 'joint_speeds')
        tcp = _finite_vector(receive.getActualTCPPose(), 6, 'tcp_pose')
        scaling = float(receive.getSpeedScaling())
    except CollectionError:
        raise
    except Exception as error:
        raise CollectionError('realrobot_rtde_read_failed') from error
    if not math.isfinite(first) or not math.isfinite(second) or second <= first:
        raise CollectionError('realrobot_rtde_timestamp_not_advancing')
    if not math.isfinite(scaling) or not 0 <= scaling <= 1:
        raise CollectionError('realrobot_invalid_speed_scaling')
    observation = {
        'schemaVersion': 1,
        'kind': 'RlsokRealRobotUr7eRtdeReceive',
        'observedAt': utc_now(),
        'hardwareDispatch': False,
        'networkInterface': 'ur_rtde.RTDEReceiveInterface',
        'sourceCheckout': {'commit': checkout['commit'], 'dirty': checkout['dirty']},
        'selectedConfiguration': selected,
        'selectedConfigurationSha256': hashlib.sha256(canonical(selected).encode()).hexdigest(),
        'robotTelemetry': {
            'rtdeTimestampFirst': first,
            'rtdeTimestampSecond': second,
            'robotMode': robot_mode,
            'safetyMode': safety_mode,
            'jointCount': len(positions),
            'jointPositionsFinite': True,
            'jointSpeedsFinite': True,
            'tcpPoseFinite': bool(tcp),
            'speedScaling': scaling,
            # Live pose is intentionally not shared in the first trial.
        },
        'limits': {
            'proves': 'a receive-only RTDE session observed advancing controller telemetry',
            'doesNotProve': [
                'RealRobot GUI is in physical rather than Mock mode',
                'the source checkout is the GUI process that is running',
                'the controller is the intended physical UR7e',
                'robot serial identity, calibration, safe movement or command gating',
                'owner acceptance or repeated use',
            ],
        },
    }
    observation['observationSha256'] = hashlib.sha256(canonical(observation).encode()).hexdigest()
    return observation


class ReceiveOnly:
    def __init__(self, host: str):
        self.host = host
        self.interface = None

    def __enter__(self):
        try:
            from rtde_receive import RTDEReceiveInterface
        except ImportError as error:
            raise CollectionError('ur_rtde_receive_dependency_missing') from error
        try:
            self.interface = RTDEReceiveInterface(self.host, 10.0)
        except Exception as error:
            # A transport exception may contain the operator's private IP.
            raise CollectionError('realrobot_rtde_receive_connection_failed') from error
        return self.interface

    def __exit__(self, *_):
        if self.interface is not None:
            try:
                self.interface.disconnect()
            except Exception:
                pass


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise CollectionError('output_already_exists')
        source = inspect_checkout(args.source_root)
        host, selected = selected_config(args.source_root.resolve())
        with ReceiveOnly(host) as receive:
            observation = build_observation(receive, selected, source)
        write_output(args.output, observation)
        print('OBSERVED | RealRobot UR RTDE Receive | hardware dispatch: NO')
        return 0
    except CollectionError as error:
        print(f'realrobot_capture_failed:{error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
