# Compare a Pioneer-X tracker setup offline

Save one reviewed tracker configuration and firmware source, then compare
later copies with the same baseline. A Pure Pursuit lookahead change from
0.6 to 0.7 is shown as **0.6 → 0.7**. Switching the saved algorithm to MPC
also requires review. Nothing is sent to the robot.

This independent workflow uses
[Pioneer-X at 39f67a06](https://github.com/DaneelOlivawXJose/pioneer-ros2-diff-drive/tree/39f67a0697f8b28669c26edfe5ca2124348756d7).
The project is under active development. RLSOK copies the selected settings,
firmware and host source; it does not modify or run the upstream software.

## 1. Prepare the public-source example

Use the [v1.5.0-shadow.14 evaluation bundle](https://github.com/realitywarden/rlsok/releases/tag/v1.5.0-shadow.14).
From its extracted directory on Linux x64, with Python 3 and Git available:

```sh
export PATH="$PWD/bin:$PATH"
git clone https://github.com/DaneelOlivawXJose/pioneer-ros2-diff-drive.git Pioneer-X
git -C Pioneer-X checkout 39f67a0697f8b28669c26edfe5ca2124348756d7
cp materials/pioneer-pure-pursuit-source-example.json tracker.json
python3 materials/pioneer-selection.py --source ./Pioneer-X \
  --settings tracker.json --firmware Pioneer-X/firmware/esp32_code/esp32_code.ino \
  --output selected.json
rlsok profile prepare-saved-setup --recipe pioneer-x \
  --source ./Pioneer-X --input selected.json --output setup-01
```

The example values come from the reviewed tracker headers/callback defaults.
They are **not** Jose's current SCADA export and are never published as a ROS
message. For your own setup, replace `tracker.json` with your saved JSON body
for `/web/settings/algoritmo` and select the actual firmware source copy.
The helper reads only files and the checkout's Git commit.

Read `setup-01/REVIEW.md` and the copied files. `source-files.json` maps source
IDs back to repository paths. Firmware files may contain local WiFi settings;
keep such copies and their reports on your machine.

## 2. Review and retain a baseline

```sh
rlsok profile capture-setup --manifest setup-01/manifest.json --output observed-01.json
rlsok profile approve-setup --observation observed-01.json \
  --actor YOUR_NAME --output baseline-01.json
```

Approval here means you chose this saved configuration as a comparison
baseline. It does not approve a drive command.

## 3. Compare changed settings with the same baseline

Edit the saved copy `tracker.json`, for example changing `lookahead_distance`
from 0.6 to 0.7. Then prepare and capture a fresh copy:

```sh
rlsok profile prepare-saved-setup --recipe pioneer-x \
  --source ./Pioneer-X --input selected.json --output setup-02
rlsok profile capture-setup --manifest setup-02/manifest.json --output observed-02.json
rlsok profile review-setup --baseline baseline-01.json \
  --observation observed-02.json --output comparison-02
```

Read `comparison-02/report.md`. Matching selected files give `UNCHANGED`;
changed settings, algorithm, firmware or host source give `REVIEW_REQUIRED`.
Missing or malformed copied files give `NEEDS_MATERIAL`. Neither source files
nor the original baseline are overwritten or automatically reapproved.

For an MPC comparison, copy `materials/pioneer-mpc-source-example.json` to
`tracker.json` and repeat with new output names and the same `selected.json`
and baseline. The report identifies the algorithm and parameter changes.

## Supported saved settings

The JSON body is a flat object. All fields below are explicit; RLSOK does not
substitute callback defaults for missing selections.

| `algorithm` | Required fields beyond `algorithm` |
| --- | --- |
| `PURE_PURSUIT` | `lookahead_distance`, `linear_velocity`, `max_angular_velocity`, `min_angular_velocity`, `interpolated_points` |
| `MPC` | `horizon`, `dt`, `weightPos`, `weightHeading`, `weightEffort`, `linear_velocity`, `max_angular_velocity`, `min_angular_velocity`, `interpolated_points` |

Validation rejects unknown/missing fields, unknown algorithms, non-finite
numbers, non-positive lookahead/dt/integer counts/effort weight, negative
position/heading weights, or reversed angular bounds. These are input
consistency checks, not mechanically safe speed or tuning recommendations.

`CARROT`/`PROPORTIONAL` is unresolved in the reviewed source: the master sends
route points to `/planificador/ruta_prop`, while `planificador_node` subscribes
to `/planificador/ruta`; the latter has no settings callback. This recipe
refuses that selection instead of pretending those settings reach the node.
The actual updated node/remapping is needed to review that path.

## What is still unobserved

The public checkout has no SCADA source or saved current settings. Both
trackers publish `cmd_vel`; the master can launch nodes. This file workflow
does not observe which node is active, arbitrate competing publishers or
intercept a live algorithm switch. Installed firmware, library/toolchain
versions, runtime settings, robot identity and tracking performance remain
unverified. The firmware source hash identifies a saved file, not a flashed
binary. No Humble/micro-ROS compatibility or physical test is claimed.

Verification used public source and deliberate file changes only. No ROS,
SCADA, micro-ROS agent, tracker, firmware, WiFi connection or motor command
was started. For device renaming and other workflows, see
[saved setup review](saved-setup-review.md).
