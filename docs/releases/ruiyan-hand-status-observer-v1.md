# Ruiyan hand read-only RS485 observer v1

This observer implements Ruiyan's confirmed 5 Mbps variable-length RS485
framing and the read-only E6, F0, A0, A2, A7, AB, AE and B0 requests. Optional
B2 requires an explicit tactile coefficient index. The protocol source permits
publishing the observer and field mapping; the supplied workbook itself is not
included.

Every request uses unicast device ID 1–254, little-endian ID encoding and the
low-8-bit additive checksum confirmed by Ruiyan. Responses must use request ID
+ 256 and echo the requested opcode. The observer rejects broadcast ID 0,
write/motion opcodes, malformed framing, checksum errors, mismatched response
IDs, wrong opcodes and unexpected duplicate single-frame responses.

The JSON stores response sizes and SHA-256 digests, not the raw serial number or
payload. It labels the protocol identity as unauthenticated. A successful result
does not prove motion safety or authorize a command.

The release's automated PTY acceptance downloads the exact public ZIP, drives
the CLI through a real Linux serial file descriptor at 5 Mbps, exercises every
default request including F0 multi-frame handling, and asserts zero motion,
configuration-write and broadcast commands. This validates the transport path
but is not evidence of a physical Ruiyan hand.
