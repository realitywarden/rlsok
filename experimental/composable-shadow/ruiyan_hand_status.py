#!/usr/bin/env python3
"""Capture Ruiyan hand identity/configuration with read-only RS485 queries.

This utility sends only the read opcodes explicitly documented by Ruiyan. It
never broadcasts, moves a motor, clears a fault, changes calibration or writes
configuration. The returned JSON stores response digests and framing facts,
not the hand serial number or raw protocol payloads.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from collect import CollectionError, utc_now, write_output
from controller_state import canonical

HEADER = 0xA5
DEFAULT_BAUD = 5_000_000
PROTOCOL_SHA256 = '4de67a89baad4cb7411fd715cac4a0c96d91b0457f20633acaffbbb4197e0c19'
OBSERVER_VERSION = '1'


@dataclass(frozen=True)
class Query:
    name: str
    opcode: int
    arguments: bytes = b''
    multi_frame: bool = False

    @property
    def payload(self):
        return bytes([self.opcode]) + self.arguments


BASE_QUERIES = (
    Query('serial_number_segment_0', 0xE6, b'\x00'),
    Query('firmware_version', 0xF0, multi_frame=True),
    Query('motor_information', 0xA0),
    Query('position_stiffness', 0xA2),
    Query('protection_configuration', 0xA7),
    Query('motor_travel', 0xAB),
    Query('motor_travel_upper_limit', 0xAE),
    Query('motor_travel_lower_limit', 0xB0),
)
READ_OPCODES = frozenset(query.opcode for query in BASE_QUERIES) | {0xB2}
FORBIDDEN_OPCODES = frozenset({
    0xA1, 0xA3, 0xA4, 0xA5, 0xA6, 0xA8, 0xA9, 0xAA, 0xAC, 0xAF,
    0xB1, 0xB3, 0xB4, 0xB5, 0xB7, 0xB8, 0xB9, 0xE3, 0xE4, 0xE5,
    0xE8, 0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE, 0xEF, 0xF1, 0xF2, 0xF3,
})


def checksum(data):
    return sum(data) & 0xFF


def encode_frame(device_id, payload):
    if not 1 <= device_id <= 254:
        raise CollectionError('ruiyan_device_id_must_be_unicast')
    if not payload or len(payload) > 64 or payload[0] not in READ_OPCODES:
        raise CollectionError('ruiyan_payload_not_allowlisted')
    if payload[0] in FORBIDDEN_OPCODES:
        raise CollectionError('ruiyan_forbidden_opcode')
    body = bytes([HEADER]) + device_id.to_bytes(2, 'little') + bytes([len(payload)]) + payload
    return body + bytes([checksum(body)])


def decode_frame(frame):
    if len(frame) < 6 or frame[0] != HEADER:
        raise CollectionError('ruiyan_frame_header_or_length_invalid')
    length = frame[3]
    if length < 1 or length > 64 or len(frame) != length + 5:
        raise CollectionError('ruiyan_frame_length_invalid')
    if checksum(frame[:-1]) != frame[-1]:
        raise CollectionError('ruiyan_frame_checksum_invalid')
    return {
        'id': int.from_bytes(frame[1:3], 'little'),
        'payload': frame[4:-1],
    }


def query_plan(tactile_coefficient_index=None):
    queries = list(BASE_QUERIES)
    if tactile_coefficient_index is not None:
        if not 0 <= tactile_coefficient_index <= 255:
            raise CollectionError('ruiyan_tactile_coefficient_index_invalid')
        queries.append(Query(
            'tactile_calibration_coefficient', 0xB2,
            bytes([tactile_coefficient_index]),
        ))
    if any(query.opcode not in READ_OPCODES or query.opcode in FORBIDDEN_OPCODES for query in queries):
        raise CollectionError('ruiyan_query_plan_not_read_only')
    return tuple(queries)


class SerialTransport:
    def __init__(self, port, baud, first_timeout=1.0, idle_timeout=0.05):
        try:
            import serial
        except ImportError as error:
            raise CollectionError('pyserial_not_installed') from error
        try:
            self.serial = serial.Serial(
                port=port, baudrate=baud, bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE, stopbits=serial.STOPBITS_ONE,
                timeout=first_timeout, write_timeout=1.0,
                xonxoff=False, rtscts=False, dsrdtr=False,
                exclusive=True,
            )
        except (OSError, ValueError, serial.SerialException) as error:
            raise CollectionError('ruiyan_serial_open_failed') from error
        self.first_timeout = first_timeout
        self.idle_timeout = idle_timeout

    def close(self):
        self.serial.close()

    def _read_exact(self, count, timeout):
        deadline = time.monotonic() + timeout
        result = bytearray()
        while len(result) < count and time.monotonic() < deadline:
            self.serial.timeout = max(0.001, deadline - time.monotonic())
            chunk = self.serial.read(count - len(result))
            if chunk:
                result.extend(chunk)
        return bytes(result)

    def read_frame(self, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = self._read_exact(1, max(0.001, deadline - time.monotonic()))
            if not value:
                return None
            if value[0] != HEADER:
                continue
            prefix = self._read_exact(3, max(0.001, deadline - time.monotonic()))
            if len(prefix) != 3:
                raise CollectionError('ruiyan_truncated_frame_prefix')
            length = prefix[2]
            if not 1 <= length <= 64:
                raise CollectionError('ruiyan_frame_length_invalid')
            rest = self._read_exact(length + 1, max(0.001, deadline - time.monotonic()))
            if len(rest) != length + 1:
                raise CollectionError('ruiyan_truncated_frame_body')
            return bytes([HEADER]) + prefix + rest
        return None

    def query(self, request):
        self.serial.reset_input_buffer()
        written = self.serial.write(request)
        self.serial.flush()
        if written != len(request):
            raise CollectionError('ruiyan_serial_short_write')
        frames = []
        first = self.read_frame(self.first_timeout)
        if first is None:
            raise CollectionError('ruiyan_response_timeout')
        frames.append(first)
        while True:
            follow = self.read_frame(self.idle_timeout)
            if follow is None:
                break
            frames.append(follow)
            if len(frames) > 64:
                raise CollectionError('ruiyan_too_many_response_frames')
        return frames


def observe(transport, device_id, baud, motor_count, tactile_coefficient_index=None):
    if not 1 <= motor_count <= 8:
        raise CollectionError('ruiyan_motor_count_invalid')
    observations = []
    read_request_count = 0
    for query in query_plan(tactile_coefficient_index):
        request = encode_frame(device_id, query.payload)
        frames = transport.query(request)
        decoded = [decode_frame(frame) for frame in frames]
        if any(item['id'] != device_id + 256 for item in decoded):
            raise CollectionError('ruiyan_response_id_mismatch:' + query.name)
        if any(item['payload'][0] != query.opcode for item in decoded):
            raise CollectionError('ruiyan_response_opcode_mismatch:' + query.name)
        if not query.multi_frame and len(decoded) != 1:
            raise CollectionError('ruiyan_unexpected_multiple_responses:' + query.name)
        if query.opcode == 0xE6 and (
            len(decoded[0]['payload']) != 8 or decoded[0]['payload'][1] != 0
        ):
            raise CollectionError('ruiyan_serial_segment_0_shape_invalid')
        raw = b''.join(frames)
        observations.append({
            'name': query.name,
            'opcode': f'0x{query.opcode:02x}',
            'responseFrameCount': len(frames),
            'responseByteCount': len(raw),
            'responseSha256': hashlib.sha256(raw).hexdigest(),
        })
        read_request_count += 1
    result = {
        'schemaVersion': 1,
        'kind': 'RlsokRuiyanHandReadOnlyStatus',
        'observerVersion': OBSERVER_VERSION,
        'observedAt': utc_now(),
        'protocol': {
            'source': 'Ruiyan supplied communication protocol',
            'sourceSha256': PROTOCOL_SHA256,
            'framing': 'rs485-variable-length',
            'checksum': 'low-8-bit-additive',
            'identityAuthentication': 'not_provided_by_protocol',
        },
        'selection': {
            'deviceId': device_id,
            'motorCount': motor_count,
            'baud': baud,
        },
        'observations': observations,
        'dispatch': {
            'readOnlyRequestsSent': read_request_count,
            'motionCommandsSent': 0,
            'configurationWritesSent': 0,
            'broadcastRequestsSent': 0,
        },
        'limitations': [
            'Protocol values are readable identifiers/configuration, not cryptographic device authentication.',
            'Raw serial numbers and response payloads are omitted; response digests support later comparison.',
            'A passing result does not establish motion safety or authorize a command.',
        ],
    }
    result['observationSha256'] = hashlib.sha256(canonical(result).encode()).hexdigest()
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', action='version', version=OBSERVER_VERSION)
    parser.add_argument('--port', required=True)
    parser.add_argument('--device-id', type=int, default=1)
    parser.add_argument('--motor-count', type=int, default=6)
    parser.add_argument('--baud', type=int, default=DEFAULT_BAUD)
    parser.add_argument('--tactile-coefficient-index', type=int)
    parser.add_argument('--execute-read-only', action='store_true')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if not args.execute_read_only:
            raise CollectionError('execute_read_only_confirmation_required')
        if args.output.exists():
            raise CollectionError('output_already_exists')
        if not 9_600 <= args.baud <= DEFAULT_BAUD:
            raise CollectionError('ruiyan_baud_outside_supported_range')
        transport = SerialTransport(args.port, args.baud)
        try:
            result = observe(
                transport, args.device_id, args.baud, args.motor_count,
                args.tactile_coefficient_index,
            )
        finally:
            transport.close()
        write_output(args.output, result)
        print('OBSERVED | Ruiyan hand read-only protocol | motion dispatch: NO')
        return 0
    except Exception as error:
        print(f'ruiyan_hand_status_failed:{type(error).__name__}:{error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
