# Review a saved robot configuration before reusing it

This optional workflow compares selected configuration copies. It can resolve
reviewed camera, USB-serial and SocketCAN identities to their current locators,
save an operator-reviewed baseline, and show what changed after reconnecting or
switching configurations. It never starts a robot, opens a device node, imports
a customer driver, sends a ROS command, or changes a live configuration.

It is separate from `profile shadow`: `UNCHANGED` means the selected saved
configuration matches. It is not a motion permit, live state attestation,
customer integration result, or evidence that a robot was used successfully.

## Prepare your selected files

```sh
rlsok profile prepare-saved-setup --recipe piper \
  --source /path/to/bimanual-vla --input selected-files.json --output setup-01
```

Recipes: `piper`, `metal`, `aditya-so101`, `beast`, `cartesian`, `kuka-sunrise`,
`armpilot-remote`, `armpilot-3d`, `pioneer-x`.

For Pioneer-X tracker selection, see [the offline comparison guide](pioneer-saved-review.md).
For independent ArmPilot configuration copies, see
[the ArmPilot walkthrough](armpilot-saved-review.md).
For a confirmed Piper role map without a native launch configuration, use
[the Piper role workflow](piper-confirmed-roles.md) instead of inventing launch arguments.
For paired ROS bridge and Java application copies, see
[the KUKA Sunrise workflow](kuka-sunrise-saved-review.md).
`--source` is a checkout to read, never execute. Input paths are relative to
`selected-files.json` (absolute paths also work). `sourceCommit` is the actual
selected checkout's 40-character Git commit, supplied by the operator; the
snapshot also binds copied source contents, including local changes. It does
not authenticate that commit or prove it is the installed code.

The input shape is:

```json
{
  "id": "my-reviewed-setup",
  "sourceCommit": "REPLACE_WITH_ACTUAL_40_CHARACTER_COMMIT",
  "files": {},
  "selectors": {}
}
```

The placeholder deliberately cannot be captured as a valid setup. Fill `files`
and `selectors` according to the recipe below. Read the generated `REVIEW.md`.
Unknown input names and unused selectors are errors, so a typo is not ignored.

## Resolve camera and adapter identities

On Linux, read existing sysfs/udev metadata:

```sh
rlsok profile discover-setup-devices --output inventory-01.json
```

This does not call OpenCV, `v4l2-ctl`, SocketCAN or a serial SDK. Consequently it
does not prove that a video endpoint supplies RGB, that a camera can capture,
or which physical arm is attached to an adapter. Review those facts yourself.
Each camera stream may need both the USB interface and video endpoint index.
Do not mistake a shared camera serial for a unique stream.

Choose each role's exact `serial`, `interface` and `videoIndex` values from the
inventory. For example, with **illustrative, non-customer values**:

```json
{
  "cam_high_device": {
    "basis": "serial", "id": "EXAMPLE-CAMERA-SERIAL",
    "interface": "00", "videoIndex": "0"
  },
  "left_can": {
    "basis": "serial", "id": "EXAMPLE-LEFT-ADAPTER-SERIAL",
    "interface": "00:port=0"
  }
}
```

If no unique serial is reported, `{"basis":"usb-path","id":"EXACT_ID_PATH"}`
is an explicit **port/topology binding**. It cannot tell a replacement unit
from the original unit on the same port. Replacing hardware or moving ports
requires review. There is no fallback to a model name, `can0`, or `/dev/videoN`
as a physical identity. Zero/multiple matches and assigning one endpoint to
two roles are refused. An operator-export inventory on another OS uses the
same schema, with `method: "operator-export"`; its claims are self-attested.

After reconnecting, regenerate the inventory and resolve into a **new** set
of copies. Your original configuration and approved baseline remain intact:

```sh
rlsok profile resolve-setup --manifest setup-01/manifest.json \
  --inventory inventory-02.json --output setup-02
rlsok profile capture-setup --manifest setup-02/manifest.json \
  --inventory inventory-02.json --output observation-02.json
```

`resolution.json` lists every old/new locator. Read it and the generated
configuration. Resolution intentionally replaces only the explicitly mapped
device fields; it neither installs these files nor launches their commands.
Structured output is JSON (also valid YAML). Numeric camera arguments stay
numeric. Plain text source files are copied as text.

`capture-setup` alone never repairs a locator mismatch: it reports
`NEEDS_MATERIAL`. This keeps an accidentally selected wrong device visible.
Use explicit `resolve-setup` when you intend to regenerate the copies.

## Approve once, compare later

After reviewing a first captured configuration:

```sh
rlsok profile capture-setup --manifest setup-01/manifest.json \
  --inventory inventory-01.json --output observation-01.json
rlsok profile approve-setup --observation observation-01.json \
  --actor YOUR_NAME --output baseline-01.json
rlsok profile review-setup --baseline baseline-01.json \
  --observation observation-02.json --output comparison-02
```

`report.md` and `report.json` distinguish semantic changes from device
renumbering and file byte changes. JSON/YAML key order and formatting do not
change the semantic result; array order, modes, joint maps, calibration values,
source code and all unmapped settings do. A resolved locator is normalized only
at its explicitly selected JSON pointer. A missing or ambiguous binding cannot
be approved. A changed configuration requires a new explicit review; the
command never refreshes your old baseline automatically.

Exit status: 0 for successful preparation/resolution/capture/approval and
`UNCHANGED`; 1 for `NEEDS_MATERIAL` or `REVIEW_REQUIRED`; 2 for invalid input or
other command error. Baseline hashes detect accidental edits; they are not
signatures, trusted hardware identity, or tamper-resistant authorization.
Inventories are saved evidence with their original timestamps, not fresh
state guaranteed at launch. Capture again when the rig changes.

## Piper deployment and collection

Reviewed public source: [bimanual-vla at a389000c](https://github.com/SUNNYsyy2005/bimanual-vla/tree/a389000c1e3ad2e7de0bc9421ce273b8dacd4f38).

Set `files.launch` to a JSON document with `entrypoint` and `arguments`:

```json
{
  "entrypoint": "deployment/client.py",
  "arguments": {
    "arm_mode": "bimanual", "arm_side": "both", "output_mode": "joint",
    "left_can": "can0", "right_can": "can1",
    "cam_high_device": "/dev/video0",
    "cam_left_wrist_device": "/dev/video2",
    "cam_right_wrist_device": "/dev/video4"
  }
}
```

This is a saved argument map, not a launchable script. Include every other
selected argument (speed, timing, policy, calibration, etc.) in `arguments`;
they are preserved and compared. Defaults not supplied here are covered only
by the copied source, not by environment or policy-server metadata.

For deployment, explicitly select `arm_mode` (`single`/`bimanual`), `arm_side`
(`left`/`right` for single, `both` for bimanual), and `output_mode`
(`joint`/`delivery`). `auto` is refused because saved files alone do not resolve
the server's policy schema. Single-arm fields are `can`, `cam_high_device`,
`cam_wrist_device`; bimanual fields are those shown above. Supply a selector
for each device field. Remove inactive device fields when switching modes.

Collection entrypoints are `collection/teleop_single.py` and
`collection/teleop_bimanual.py`, with explicit `schema: joint|delivery`.
Single uses `master`, `slave`, `cam_high_id`, `cam_wrist_id`, and `arm_side`.
Bimanual uses `left_master`, `left_slave`, `right_master`, `right_slave`,
`cam_high_id`, `cam_left_wrist_id`, `cam_right_wrist_id`.
Camera `*_id` arguments are integer indices, as in the public argparse interface.
Every device argument needs its own reviewed selector. This supports saved
single/dual and joint/EEF contract comparison; it does not validate policy
outputs or authorize Piper movement.

## MakerMods Metal

Reviewed public source: [MakerModsLab at e4a14679](https://github.com/makermods-robotics/makermodslab/tree/e4a14679e216d069767310f61a7c5eeab64bbb71).

`files.record` is the selected saved robot-record JSON. Require explicit
`arm_type: metal`, `mode: single|bimanual`, `arms: both|leader|follower`,
`leader_kind: star|metal|star_vertical`, and a `cameras` array (empty is valid).
Empty/missing leader kind follows the source's Star default without rewriting
the record. Other families/leader kinds and missing mode fields are refused.

For each active slot, supply `files.leader_calibration`,
`files.follower_calibration`, `files.right_leader_calibration`, and/or
`files.right_follower_calibration`. Names must match the record's assigned
configuration. Preserve the immediate library directory in copied paths:
`metal_follower`, `metal_leader`, `rebot_102_leader` for a Star leader, or
`rebot_102_leader_vertical` for a vertical Star leader.
Two slots cannot silently share a port or selected calibration file.

Optional selector roles are `leader`, `follower`, `right_leader`,
`right_follower` and `camera:NAME`. The arm ports in these records are USB
serial/slcan locators, not Linux SocketCAN interface names. Without a selector
their locator strings are compared literally; physical identity is unknown.
Camera `unique_id` and every other field stay in the snapshot; no macOS
location identifier is claimed to be a device serial.

The selected Metal preset/factory source and calibration are bound together.
Metal zero-offset calibration bytes can be identical across arms, so equality
does not identify which physical unit is present. The exporter imports no
MakerModsLab/LeRobot module: it performs no startup migration, bus handshake,
torque command, session start, or runtime interception.

## Aditya SO-101 hardware branch

Reviewed source: [so101_hardware at 6f8f1349](https://github.com/iAdityaDev/so_101_arm/tree/6f8f1349e47735695f124b483a41e88bf18ffa8a).

Files: `bridge` (JSON), `calibration` (JSON), `controllers` (YAML), `model`
(expanded URDF/text), `launch` (selected launch/text). `bridge` must explicitly
contain `port`, `robot_id`, `commands_topic`, `states_topic`, and the selected
`joint_name_map` array of `motor:joint` entries. Each selected motor must occur
in the calibration, and calibration filename must match `robot_id`. Optional
selector: `follower` (serial).

This is distinct from the existing lowercase-joint `so101-arm` recipe.
The separate `prepare-source --recipe aditya-so101-hardware` maps the public
five-axis FollowJointTrajectory input, using a real saved catalog/controller
export when available. It does not start the serial-owning LeRobot bridge.
Direct JointState hardware commands and gripper actions remain separate.
The source controller YAML lists velocity state, but the C++ interface exports
position only: inspect the selected configuration before a user-run launch.

## Dons Beast

Current reviewed source: [Dons_Beast at f16b4e4a](https://github.com/Dwilliestyle/Dons_Beast/tree/f16b4e4a0010570fd47e2843ac4ade635e17b997).

Files: `parameters` (selected `beast_params.yaml`), `model` (URDF/text), `launch`
(text). Optional selector: `esp32` (serial). The current file separates
`esp32_bridge`, `joy_teleop`, `keyboard_ctrl` and `odom_publisher` parameters.
The bridge selection recognizes `esp32_bridge`, `/esp32_bridge` and `/**`.
Conflicting overlapping values are refused instead of guessing launch
precedence; identical overlapping serial fields are all updated during an
explicit device-resolution operation. Other nodes' speed/geometry fields
remain in their own saved groups and the complete YAML is compared.

The earlier 1ecf5e4f file had duplicate `low_voltage_threshold` keys and
`watchdog_timeout`. Upstream f16b4e4a removes the duplicate and selects
`low_voltage_threshold: 10.0`, `cmd_vel_timeout: 0.5` for `esp32_bridge`.
Those values come from the owner's public source, not an RLSOK choice.
Duplicate keys are still rejected, and no saved value establishes a live value.

`prepare-source --recipe dons-beast` additionally maps Twist into
`esp32_bridge` and requires an existing read-only node-settings export for the
actual serial port, baud rate and declared bridge parameters. Do not launch
that bridge to discover it: its constructor opens serial. UART delivery,
flashed ESP32 code, movement and physical stopping remain outside this review.

## Cartesian single/dual arm

Reviewed source: [cartesian_motion_base at f61cfa12](https://github.com/leledeyuan00/cartesian_motion_base/tree/f61cfa12956d571a3bf6b576a27aba050ecba905).

Files: `settings` (JSON with explicit `config_type: single_arm|dual_arm` and
other selected launch arguments), `controllers` (YAML), `model` (expanded
URDF/text), `launch` (text). No device selectors are inferred. Joint order,
left/right controller settings, reference frames, gains, model and source
changes are compared. The private/current dual setup is still required for a
customer-specific baseline. PoseStamped/WrenchStamped/JointMove authorization
is not implemented by comparing these files.

## Use your own selected configuration

For source-specific SO101, Beast and Cartesian consistency checks before
baseline approval, use [selected-input inspection](selected-input-inspection.md).
The Cartesian inspector can also review saved native PoseStamped,
WrenchStamped and JointMove fields without publishing or calling ROS.

Comparison reports include before/after field values and changed source-line
excerpts. Missing/invalid selected files or mapped fields produce a retained
`NEEDS_MATERIAL` observation; fix the issue and capture to a new output file.

You can write `manifest.json` directly instead of using a recipe. Its schema
is defined in `packages/composable-shadow/saved-setup.ts`: unique file IDs,
explicit `json|yaml|text` formats, source identity and zero or more bindings.
Each binding has `role`, `kind`, `identity`, and `uses` containing a file ID and
an RFC 6901 JSON pointer. Do not map a whole object or mask non-device settings.
No bindings means saved-file comparison only, so `--inventory` may be omitted.
All files must be regular files under 8 MiB; symlink inputs, malformed JSON,
duplicate YAML/JSON keys, non-JSON YAML types and excessively nested documents
are refused. Keep generated snapshots private: they can contain local paths,
device serials and any configuration values you selected.

## Additional source-specific selections

- [Modular DiffBot: selected bridge/PWM/firmware copies](diffbot-saved-review.md)
- [Piper CPP: arm/gripper, controller and model copies](piper-cpp-saved-review.md)
- [RobStride: ROS-joint command envelope and driver source](robstride-saved-review.md)
- [Dobot Magician: homing configuration without calling the service](dobot-magician-homing-review.md)
- [Direct LeRobot SO-101: leader/follower serial and calibration](lerobot-so101-direct-review.md)

These are local file comparison recipes, not installed hardware integrations.
