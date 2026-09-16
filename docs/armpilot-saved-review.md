# Compare ArmPilot settings without starting the arm

Keep the configuration you reviewed, then compare a later copy. For example,
changing `joystick.deadband_deg` from 5 to 6 produces a report showing **5 → 6**.
It does not start ArmPilot or send a servo command.

This independent prototype supports the two selected-file layouts in
[zc110747/MeArmPilot at b142fe94](https://github.com/zc110747/MeArmPilot/tree/b142fe9427399b581d820d24c9d7643a69931ea5):

| Recipe | What is copied and compared |
| --- | --- |
| `armpilot-remote` | RemoteControl YAML: serial connection and ACK timing, joystick servo mapping, direction, deadband, web/TCP settings; host and firmware source. |
| `armpilot-3d` | Selected backend YAML, explicit MeArm-V1 package choice, robot selector, package manifest, model/calibration, physics and URDF; host, model, simulator and firmware source. |

The upstream framework is being restructured. These are saved-file prototypes,
not an upstream integration or a review of every later architecture. This
recipe supports the reviewed `mearm-v1` package only. Its package ID and the
model's internal `mearm` ID are distinct; neither is renamed.

## 1. Select the configuration you want to compare

Use RLSOK **v1.5.1** or later. Download the evaluation bundle from
[releases](https://github.com/realitywarden/rlsok/releases/tag/v1.5.1).
The selection helper is in `materials/armpilot-selection.py` in the Linux
bundle, or `examples/composable-shadow/armpilot-selection.py` in the source.
It uses Python's standard library and reads the checkout's Git commit.

Run the following from the extracted Linux bundle directory. Add its CLI to
this shell's path, then obtain the reviewed public example (Git is required):

```sh
export PATH="$PWD/bin:$PATH"
git clone https://github.com/zc110747/MeArmPilot.git MeArmPilot
git -C MeArmPilot checkout b142fe9427399b581d820d24c9d7643a69931ea5
```

Replace `/path/to/MeArmPilot` below with `./MeArmPilot` for that example, or
the path to your own reviewed checkout.

For a public-source RemoteControl example:

```sh
python3 materials/armpilot-selection.py --source /path/to/MeArmPilot \
  --kind remote --configuration MeArm-RemoteControl/config.yaml \
  --output selected-remote.json
rlsok profile prepare-saved-setup --recipe armpilot-remote \
  --source /path/to/MeArmPilot --input selected-remote.json --output setup-01
```

For a public-source 3D backend example:

```sh
python3 materials/armpilot-selection.py --source /path/to/MeArmPilot \
  --kind 3d --configuration MeArm-3D/backend/config.yaml \
  --output selected-3d.json
rlsok profile prepare-saved-setup --recipe armpilot-3d \
  --source /path/to/MeArmPilot --input selected-3d.json --output setup-01
```

Choose one example and a new output directory. On Windows, `python` can replace
`python3`. The helper never starts the selected configuration. Selecting a YAML
whose `device.mode` is `serial` still only reads the file.

For your own review, select the actual saved YAML. Read the generated selection
JSON and `setup-01/REVIEW.md`. The 3D selection includes each model file explicitly;
it does not discover command-line overrides, follow deprecated `config_path`
behavior or prove which model a running process loaded. Modify the selection
paths if your reviewed copies differ. Missing files and unknown selections are
errors, not permission to substitute another robot.

## 2. Keep a baseline you explicitly reviewed

```sh
rlsok profile capture-setup --manifest setup-01/manifest.json --output observation-01.json
rlsok profile approve-setup --observation observation-01.json \
  --actor YOUR_NAME --output baseline-01.json
```

`source-files.json` maps copied source IDs to their original repository paths.
Port names are compared literally unless you supply an explicitly reviewed
device identity through the [saved-setup workflow](saved-setup-review.md).
This example does not discover hardware or verify the identity behind a COM port.

## 3. Compare the next copy with the same baseline

Prepare a new `setup-02` from the later selected files and capture it. Use the
same selection `id` and the original `baseline-01.json`:

```sh
rlsok profile prepare-saved-setup --recipe armpilot-remote \
  --source /path/to/MeArmPilot --input selected-remote.json --output setup-02
rlsok profile capture-setup --manifest setup-02/manifest.json --output observation-02.json
rlsok profile review-setup --baseline baseline-01.json \
  --observation observation-02.json --output comparison-02
```

For the 3D example, use `armpilot-3d` and `selected-3d.json` in that preparation
command. The selection JSON points at the saved files to copy again; review it
before comparing a different checkout or configuration.

Read `comparison-02/report.md`. `UNCHANGED` means the selected copies match;
`REVIEW_REQUIRED` lists changed fields and source excerpts; `NEEDS_MATERIAL`
means a selected file or identity cannot be checked. The old baseline and
original configuration are never overwritten or automatically reapproved.
The comparison covers complete selected files, so even an appearance-only
edit may require review here; it does not emulate upstream's visual-change policy.

## What this establishes

The prototype was exercised with the pinned public source and deliberately
changed copies: baud, joystick deadband and roles, ACK/settle timings, device
mode, calibration offset, limits, package version and firmware text changes.
No upstream frontend, backend, simulator or firmware was executed. No serial,
WebSocket or TCP connection was opened.

The saved configuration and source commit are self-attested. Installed
firmware, EEPROM state, live overrides, physical calibration and the real
device remain unobserved. The reviewed MeArm servo reports its internal target;
that is not encoder evidence of physical position. This report is a configuration
comparison, not a movement permit or proof of mechanical safety.
