# Read Mowgli's existing firmware report without opening USB

This opt-in observer is based on the public
[MowgliNext source at faf658bc](https://github.com/mowglinext/mowglinext/tree/faf658bc57b92410ee820adff9953e663b5b0230).
It is a source-reviewed prototype, not a physical-mower compatibility result.
Use it only with an already-running graph that the owner has put into their
normal safe maintenance state. RLSOK never starts or restarts the bridge.

## Why an extra bridge would not be read-only

The upstream hardware bridge opens USB serial and sends heartbeats, firmware
queries, PID and configuration traffic automatically. Running that executable
just to discover the robot would change the communication with the controller.
This observer subscribes to the existing status. ROS discovery and node
bookkeeping (such as the node's own parameter-event metadata) still generate
traffic; this is not a network-silent tool. It creates no command publisher or
service client, opens no serial/CAN port,
and cannot enable the blade, initiate mowing, dock, reboot or set parameters.

It reads `/hardware_bridge/status` (`mowgli_interfaces/msg/Status`) and requires
one `/hardware_bridge` publisher with the expected type, unchanged endpoint
metadata before/after reception and the same complete publisher GID in the
received message. It rejects `/fake_hardware_bridge`, firmware `sim`, missing
GID metadata, ambiguity and endpoint changes. Kilted's 16-byte GID and earlier
24-byte layouts are recognized without reducing either to a shared prefix.
The installed rclpy/RMW must provide MessageInfo publisher GID; if it does not,
the capture stops rather than guessing. Do not upgrade a working robot stack
merely for this experiment—report the missing metadata instead.

The status stamp must be nonzero, no more than five seconds behind this reader's
receipt clock and no more than one second ahead. This check is not a measurement
of clock synchronization. A renamed or malicious publisher can imitate the
source: node names/GIDs are not cryptographic physical-device authentication.

## Capture, inspect, then compare saved files

Source the owner's existing ROS 2 and message workspace in a terminal without
running a bringup/launch command. From the included
`experimental/composable-shadow` directory:

```sh
python3 mowgli_status.py --source-root /path/to/mowglinext \
  --output /private/mowgli-observation-01.json
```

The Local Check CLI equivalent is `rlsok profile capture-mowgli-status` with
the same arguments. The observer records actual checkout commit/dirty state,
not an operator-typed commit; this still does not attest the deployed container,
running binary or flashed firmware. It omits local paths and remote URL credentials.

`OBSERVED` means the source/sample checks succeeded and the bridge reported a
version, nonzero protocol and compatible handshake. `NEEDS_MATERIAL` preserves
an unknown/incomplete handshake or incompatible flag without treating it as a
match. Neither result is permission to move. The output also separates current
operating flags from firmware identity. It contains no NTRIP credentials, GPS
location or dock pose.

After inspecting a reference observation, compare it with a later saved one:

```sh
python3 mowgli_status.py --baseline /private/mowgli-observation-01.json \
  --current /private/mowgli-observation-02.json \
  --output /private/mowgli-comparison-01.json
```

`rlsok profile compare-mowgli-status` is the equivalent wrapper. Comparison is
fully offline and never loads ROS. It verifies each record's hash and requires
complete firmware material. `UNCHANGED` / `CHANGED` refer to the reported
firmware version, protocol and compatibility flag, plus any explicitly selected
saved settings below. Timestamps, charging/mowing flags and source provenance
are recorded but not treated as stable firmware identity. Hashes establish
internal file consistency, not authenticity. A selected reference is not an
approval record and this comparator does not install a live motion gate.

## Optional saved wheel/PID settings—not live applied values

Use `--settings /private/selected-settings.json` during capture to include a
small operator-reviewed selection from the actual saved configuration. Do not
send or copy the full `mowgli_robot.yaml`: it may contain credentials or location
data. The selection format is:

```json
{
  "schemaVersion": 1,
  "provenance": "operator-selected-saved-not-live",
  "sourceFileSha256": "REPLACE_WITH_SHA256_OF_YOUR_SELECTED_SOURCE_FILE",
  "parameters": { "wheel_pid_kp": 10.0, "max_mps": 0.4 }
}
```

The example is deliberately incomplete and cannot pass without a real hash;
the numbers are illustrations, not tuning recommendations. Allowed keys are
`ticks_per_meter`, `wheel_track`, `max_mps`, `wheel_pid_kp`, `wheel_pid_ki`,
`wheel_pid_kd`, `wheel_pid_integral_limit`, `wheel_pid_pwm_per_mps`,
`deadband_pwm` and `yaw_gyro_sign`. Unsupported keys, empty selections and
nonfinite values are refused before ROS is initialized. This validates the
selection shape, not physical limits or tuning suitability. No defaults are
filled in; no parameter service is called.

The comparator lists changed, added or removed selected parameter keys. The
source-file hash is provenance supplied by the operator, not independently
recomputed by this tool; a hash-only change is not labelled a parameter change.
Without `--settings`, no PID/configuration comparison is claimed. Saved values
can differ from live parameter overrides or firmware-applied values.

The focused synthetic tests cover parser/metadata and offline comparison logic.
Live Kilted/DDS interoperability, installed-build identity, physical calibration,
motor/blade safety and owner acceptance remain unverified. Never run motors or
change a real parameter to manufacture a mismatch; modify a copy for an offline
negative case and label it synthetic.
