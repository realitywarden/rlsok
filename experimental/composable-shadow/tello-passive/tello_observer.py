"""Optional client-side observation, AFTER the owner's call_async returns.

No rclpy dependency, command client, robot transport, retry, or gate. Only a
best-effort nonblocking Unix datagram to a separate local capture process.
"""
import json
import os
import socket
import time


class PassiveRecorder:
    def __init__(self, path=None):
        self.path = os.environ.get('RLSOK_TELLO_SOCKET', '') if path is None else path
        self.sequence = 0
        self.dropped = 0
        self.session = '%s-%s' % (os.getpid(), time.time_ns())
        self.sock = None
        if self.path:
            try:
                self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
                self.sock.setblocking(False)
            except Exception:
                self.close()

    def record(self, service, cmd):
        """Return observation delivery only; NEVER use this return to gate motion."""
        if not self.path:
            return False
        self.sequence += 1
        try:
            if (not isinstance(service, str) or not service
                    or len(service) > 256 or not isinstance(cmd, str)
                    or len(cmd) > 4096):
                raise ValueError('invalid_or_oversized_observation')
            packet = json.dumps({
                'schemaVersion': 1, 'kind': 'RlsokTelloClientObservation',
                'session': self.session, 'sequence': self.sequence,
                'droppedBefore': self.dropped, 'observedAtUnixNs': time.time_ns(),
                'boundary': 'client_call_async_returned',
                'service': service, 'serviceType': 'tello_msgs/srv/TelloAction',
                'serviceNameSource': 'client.srv_name', 'serviceResolutionVerified': False,
                'request': {'cmd': cmd},
            }, ensure_ascii=True, separators=(',', ':')).encode('ascii')
            if self.sock is None:
                raise OSError('recorder_socket_unavailable')
            self.sock.sendto(packet, self.path)
            return True
        except Exception:
            self.dropped += 1
            return False

    def close(self):
        if self.sock is not None:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None


_recorder = PassiveRecorder()


def record_call(service, cmd):
    # The patch also guards this call: optional observation must never control
    # the owner's future, original request, call count, or spin behavior.
    return _recorder.record(service, cmd)
