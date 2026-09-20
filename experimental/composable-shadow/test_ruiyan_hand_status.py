"""Focused tests for Ruiyan's allowlisted RS485 observer."""
import unittest

import ruiyan_hand_status as status


def response(device_id, payload):
    body = bytes([status.HEADER]) + (device_id + 256).to_bytes(2, 'little') + bytes([len(payload)]) + payload
    return body + bytes([status.checksum(body)])


class FakeTransport:
    def __init__(self, device_id=1):
        self.device_id = device_id
        self.requests = []

    def query(self, request):
        decoded = status.decode_frame(request)
        self.requests.append(decoded['payload'])
        opcode = decoded['payload'][0]
        if opcode == 0xE6:
            return [response(self.device_id, bytes([opcode, 0]) + b'ABC123')]
        if opcode == 0xF0:
            return [
                response(self.device_id, bytes([opcode, 0]) + b'v1.2.3'),
                response(self.device_id, bytes([opcode, 1]) + b'build7'),
            ]
        return [response(self.device_id, bytes([opcode]) + b'\x00' * 7)]


class RuiyanHandStatusTests(unittest.TestCase):
    def test_frame_uses_little_endian_id_and_additive_checksum(self):
        frame = status.encode_frame(1, b'\xe6\x00')
        self.assertEqual(frame, bytes.fromhex('a5010002e6008e'))
        decoded = status.decode_frame(frame)
        self.assertEqual(decoded, {'id': 1, 'payload': b'\xe6\x00'})

    def test_rejects_broadcast_write_opcode_and_bad_checksum(self):
        with self.assertRaisesRegex(status.CollectionError, 'unicast'):
            status.encode_frame(0, b'\xe6\x00')
        with self.assertRaisesRegex(status.CollectionError, 'allowlisted'):
            status.encode_frame(1, b'\xa1')
        frame = bytearray(status.encode_frame(1, b'\xf0'))
        frame[-1] ^= 1
        with self.assertRaisesRegex(status.CollectionError, 'checksum'):
            status.decode_frame(bytes(frame))

    def test_complete_plan_sends_only_read_queries_and_redacts_payloads(self):
        transport = FakeTransport()
        result = status.observe(transport, 1, status.DEFAULT_BAUD, 6, 2)
        self.assertEqual({payload[0] for payload in transport.requests}, status.READ_OPCODES)
        self.assertFalse({payload[0] for payload in transport.requests} & status.FORBIDDEN_OPCODES)
        self.assertEqual(result['dispatch'], {
            'readOnlyRequestsSent': 9,
            'motionCommandsSent': 0,
            'configurationWritesSent': 0,
            'broadcastRequestsSent': 0,
        })
        self.assertNotIn('ABC123', str(result))
        self.assertEqual(result['observations'][1]['responseFrameCount'], 2)
        self.assertRegex(result['observationSha256'], r'^[a-f0-9]{64}$')

    def test_rejects_wrong_response_identity_or_opcode(self):
        class WrongIdentity(FakeTransport):
            def query(self, request):
                opcode = status.decode_frame(request)['payload'][0]
                return [response(2, bytes([opcode]) + b'\x00' * 7)]

        with self.assertRaisesRegex(status.CollectionError, 'response_id_mismatch'):
            status.observe(WrongIdentity(), 1, status.DEFAULT_BAUD, 6)


if __name__ == '__main__':
    unittest.main()
