# Propulsor source review: limits, missions and dispatch

Reviewed source: [Shafayat-Alam/pliant-propulsors-control at a7e35e73](https://github.com/Shafayat-Alam/pliant-propulsors-control/tree/a7e35e7358b37ba4f6417097c6934864f80012f4). This is an inspectable source improvement for that revision, not evidence of a customer hardware run or a completed RLSOK mission adapter.

| Group | Existing behavior | Review result |
| --- | --- | --- |
| Limits and calibration | `controller.py` declares pitch/heave limits and calibration zero parameters; `_build_structure` derives finite role limits for each fin pair | Default limits already exist. The comment in `_command_targets` claiming infinite defaults was outdated. A malformed/incomplete set can leave an ID without limits; the old sender then defaulted to unbounded limits. |
| Current and hardware bounds | `_setup_hardware` writes the configured `current_limit`; it writes EEPROM Min/Max Position Limits in position mode, with checked write calls | The source explicitly treats software clamping as the position guard in extended-position mode. A configured register value or successful SDK write is not measured current/force or proof of mechanical clearance. Keep the hardware-mode distinction in the review. |
| Mission intake and reference pose | `_mission_cb` parses mission JSON; `_tick` uses the boot calibration state before manual/idle follow | A homing/calibration step establishes a reference, not permanent authorization for all later missions or physical safety. Changed mappings/zero/limits need review. The patch does not add a new mission schema or live RLSOK interception. |
| Command calculation | `_command_targets` selects servo targets, clamps positions, optionally smooths, and omits arrived positions | Non-finite values must be rejected before Python min/max: NaN can otherwise become an end-stop value. Limits and smoothing history also need finite checks. |
| Dispatch | `_publish_cmd` emits the concatenated ID/mode/value array; `Dynamixel_XW430_T200_interface.py` parses it and later writes via the SDK | The original receiver used integer division/rounding without validating array shape, duplicate IDs or finite values. The patch validates the complete software frame before queuing it. This does not prove what physical hardware executes. |

## Concrete calibration-change example

Run `node experimental/composable-shadow/calibration-review-example.cjs NEW_OUTPUT_DIRECTORY` from a built RLSOK checkout. It produces three decision reports using the real local evaluator and explicitly synthetic files. An illustrative zero of 0 rad with half-range 0.5 gives bounds -0.5..0.5. Changing the zero to 0.1 while retaining the old limits blocks on the calibration fact. Reviewing proposed bounds -0.4..0.6 also changes the limits fact, so the **old** approval still blocks. Neither a new zero nor recomputing bounds silently authorizes a mission. The example leaves the changed configuration for explicit review; those numbers are not prescribed propulsor settings, and the synthetic trajectory is not the project's mission transport.

## Implemented correction

The [reviewable patch](../experimental/composable-shadow/pliant-review/finite-command-validation.patch) changes two callbacks:

- Validate the entire controller batch before smoothing or publishing: numeric finite targets, no unknown or duplicate targets, finite ordered position bounds, valid smoothing coefficient/history. Retain valid position clamping, valid velocity values and per-servo calibration selection. An invalid batch publishes nothing.
- Validate the receiver's three equally sized arrays, finite values, unicast integral IDs, unique IDs, supported position/velocity mode codes and already-configured IDs. A rejected frame clears the pending software command. It does not cancel a command already received by a servo or establish an emergency stop.

No mechanical limits or calibration numbers were invented. The patch is deliberately separate from the immutable upstream snapshot and requires the owner's review before installation on their system. It preserves the existing calibration gate. Configuration changes, raw publishers bypassing the controller, mission-specific semantics, feedback behavior while a command is rejected and hardware stop behavior remain separate integration questions.

In the reviewed source, `_config_cb` rebuilds actuator roles and limits, while `_calibration_done` is a boot/runtime flag; it is not an immutable review of the current configuration. The patch does not falsely turn that flag into a RLSOK approval. Review zero, actuator-role mapping, mode, position/current/profile bounds and the proposed mission together after a change. An actual per-mission RLSOK adapter must read those live inputs at its defined handoff; the standalone example below is not that adapter.

## Apply and inspect without running ROS or hardware

From a separate checkout of the pinned upstream revision, inspect the patch, then:

```sh
git apply --check /path/to/finite-command-validation.patch
git apply /path/to/finite-command-validation.patch
python3 /path/to/check_patch.py "$PWD"
git diff --check
git diff --stat
```

The [focused checker](../experimental/composable-shadow/pliant-review/check_patch.py) verifies the reviewed patched file hashes, parses Python AST and executes **only the two selected methods** using fake logger/publisher objects. It imports neither ROS nor Dynamixel SDK, opens no port and sends no commands. Thirty checks cover non-finite values in both modes, missing/reversed/infinite bounds, unknown/duplicate IDs, invalid smoothing, malformed frames, and valid clamp/per-servo/velocity behavior. This is evidence about those callbacks, not a full project regression or physical test.

For a future local Shadow integration, keep configuration/limit facts, mission checks and actual dispatch as explicit separate boundaries. Review the calibration and limit facts before a mission comparison; if they change, use the original approval to expose the mismatch, then perform an intentional new review. A software match alone must not be represented as proof that the homed physical zero or hydrodynamic behavior is correct.
