# Piper: compare confirmed roles before GUI integration

This first phase accepts a saved, operator-confirmed Piper identity mapping.
It covers configuration records and differences without starting `start_gui.sh`,
opening CAN or cameras, or running a policy. The normalized input below is an
RLSOK review contract, not a native bimanual-vla configuration file. A future
project-side resolver can export this contract; wiring it into the GUI is a
separate step requiring that resolver's actual output and integration location.

## Input

Save this shape as `roles.yaml`, replacing every example identity and locator
with your confirmed values. The example values are fictional. Keep this file
private. The complete schema is emitted by `rlsok profile schema`.

```yaml
schemaVersion: 1
arm_mode: bimanual
arm_side: both
action_schema: joint
cameras:
  overhead:
    model: Intel RealSense D435i
    serial: EXAMPLE-OVERHEAD
    current_device: /dev/video4
  left_wrist:
    model: Intel RealSense D405
    serial: EXAMPLE-LEFT-WRIST
    current_device: /dev/video24
  right_wrist:
    model: Intel RealSense D405
    serial: EXAMPLE-RIGHT-WRIST
    current_device: /dev/video10
arms:
  left:
    model: PIPER
    robot_serial: EXAMPLE-LEFT-ROBOT
    can_adapter_serial: EXAMPLE-LEFT-ADAPTER
    current_interface: can0
  right:
    model: PIPER
    robot_serial: EXAMPLE-RIGHT-ROBOT
    can_adapter_serial: EXAMPLE-RIGHT-ADAPTER
    current_interface: can1
```

For `arm_mode: single`, select `arm_side: left` or `right`, and include only
that arm, its wrist camera and the overhead camera. `bimanual` requires both
arms and three cameras. `joint` denotes joint angles; `delivery` denotes
end-effector pose and remains an experimental Piper mode. The review does not
assess its kinematics or trajectory quality.

## Capture, review, and preserve the baseline

Use the full commit of the source checkout you actually read. The initial
source inspection used bimanual-vla `master` at
`a389000c1e3ad2e7de0bc9421ce273b8dacd4f38`.

```sh
rlsok profile prepare-piper-setup --input roles.yaml \
  --source /path/to/bimanual-vla \
  --source-commit a389000c1e3ad2e7de0bc9421ce273b8dacd4f38 \
  --id piper-rig --output setup-01
rlsok profile capture-setup --manifest setup-01/manifest.json \
  --inventory setup-01/operator-inventory.json --output observation-01.json
# Read the mapping and observation before this explicit approval:
rlsok profile approve-setup --observation observation-01.json \
  --actor YOUR_NAME --output baseline-01.json
```

The imported inventory represents the operator's selected endpoints, not a
fresh scan. Its timestamp records import time. Robot serials are retained for
comparison; the CAN adapter serial does not independently verify the robot
connected behind that adapter. Camera USB `interface` and `videoIndex` are
optional only when the saved inventory uniquely identifies the selected
endpoint. A full RealSense inventory often contains several video nodes per
serial; then supply the reviewed stream's interface/index. No model-name,
temporary-number or arbitrary-first-match fallback is used.

### When a camera has no readable unit serial

Starting with Local Check 1.5.8, the Piper preparation input also accepts an
explicitly operator-confirmed USB path. Use **either** `serial` **or** `usb_path`
for that camera, never both. A USB-path binding additionally requires the
reviewed `interface` and `videoIndex` so that it selects the intended stream.
For example, replace only the relevant camera entry with your actual values:

```yaml
left_wrist:
  model: Intel RealSense D405
  usb_path: EXAMPLE-REVIEWED-USB-PATH
  interface: "00"
  videoIndex: "4"
  current_device: /dev/video22
```

The path must come from the actual discovery output and a human-confirmed role;
RLSOK does not guess it from the model or `/dev/videoN`. This identifies a
**port/topology, not a unique physical camera**. Replacing a camera at that same
port cannot be detected by this binding alone and needs manual review. A change
from serial to USB path, or to a different path, requires explicit baseline
review; it never happens as an automatic fallback. Keep the previous baseline.

`prepare-piper-setup` still imports selected roles only. Its generated
`operator-inventory.json` is not new hardware evidence. For a later real
workstation check use a fresh, read-only discovery inventory; do not repeatedly
compare the prepared inventory and count that as repeated hardware use.

## Later comparisons

Prepare a new selected configuration and capture it with an independently
saved inventory, then compare against the original baseline:

```sh
rlsok profile capture-setup --manifest setup-02/manifest.json \
  --inventory inventory-02.json --output observation-02.json
rlsok profile review-setup --baseline baseline-01.json \
  --observation observation-02.json --output review-02
```

Never generate a new inventory from a changed configuration and present it as
proof of newly observed hardware. Imported mappings are suitable for explicitly
constructed offline comparisons; future hardware observations must come from
the actual device discovery flow.

| Change in an offline copy | Expected report |
| --- | --- |
| Same selected mapping | `UNCHANGED` |
| Same serials, new video/CAN numbers, explicitly resolved into new copies | `UNCHANGED`, with old/new locators listed |
| Selected camera or CAN adapter missing from inventory | `NEEDS_MATERIAL` |
| More than one endpoint matches the selected serial/stream | `NEEDS_MATERIAL` |
| A saved locator points at the other arm's adapter | `NEEDS_MATERIAL` |
| Left/right role identities exchanged consistently | `REVIEW_REQUIRED` |
| Single/bimanual, selected side, joint/delivery, camera model or robot serial changed | `REVIEW_REQUIRED` |

For renumbering, run `resolve-setup` with the new inventory, then capture its
new manifest and compare. The command edits copies only and preserves all
non-locator fields. Missing/ambiguous identities refuse resolution. A matching
saved report is not a motion permit or proof of a successful hardware trial.
