# RLSOK Ruiyan hand read-only RS485 observer v1

This observer implements only the read commands Ruiyan confirmed from its
shared application-layer protocol. It is configured for the reported 6-DoF
RS485 hand defaults: 5 Mbps, first device ID 1, motor IDs 1–6 and broadcast ID
0. It never uses broadcast ID 0.

Install the serial dependency, then run this only while the hand is connected
but no motion program is active:

```bash
python3 -m pip install pyserial
python3 ruiyan_hand_status.py --version
python3 ruiyan_hand_status.py \
  --port /dev/ttyUSB0 \
  --device-id 1 \
  --motor-count 6 \
  --baud 5000000 \
  --execute-read-only \
  --output ruiyan-hand-status-v1.json
```

The version command must print `1`. `--execute-read-only` acknowledges that the
tool will transmit allowlisted read requests. It sends E6, F0, A0, A2, A7, AB,
AE and B0 exactly once. Add `--tactile-coefficient-index N` only when tactile
hardware is present and Ruiyan has confirmed the index; that adds one B2 read.

The frame is `A5 | little-endian id | length | data | low-8-bit additive
checksum`. Responses must use request ID + 256 and echo the requested opcode.
The output stores response hashes and framing metadata, not the raw serial
number or payload. These values are readable protocol identity/configuration,
not cryptographic authentication.

The observer does not send motion, enable, clear-fault, reset, calibration
write, configuration write, firmware-update or broadcast commands. A passing
result is not motion-safety approval and does not prove which physical hand is
attached beyond the unauthenticated protocol response.
