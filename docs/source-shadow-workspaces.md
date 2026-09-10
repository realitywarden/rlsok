# Review a public ROS 2 project's configuration locally

These eight mappings come from inspected public source. They create a separate RLSOK workspace without editing the upstream checkout, installing a controller, generating an approval or sending a command. They are not customer case studies, hardware certifications or evidence that an owner has run RLSOK.

| Recipe | Inspected source | Selected boundary | Material scope limit |
| --- | --- | --- | --- |
| `hexapod-gait` | [hexapod_ros2, 656eebab](https://github.com/ariegweomamerie/hexapod_ros2/tree/656eebab5587977a1f41d44657cb853433927053) | `/cmd_vel` Twist → `/hexapod_gait` | Fresh gait parameters, selected output link and 18-joint controller state; no IK/dynamics or hardware certification |
| `so101-arm` | [so101_ros2, 0305e03a](https://github.com/adoodevv/so101_ros2/tree/0305e03ab54e64aae9263fcbf339622e654012f3) | `/arm_controller/follow_joint_trajectory`, five arm joints | Gripper and direct LeRobot/serial teleoperation are separate |
| `trik-drive` | [trik_ros2_control, d6ac6cad](https://github.com/krranky/trik_ros2_control/tree/d6ac6cad28a6596317b6b7e6f45372145ec8c601) | Remapped `/cmd_vel` TwistStamped → `/diff_drive_controller` | Files do not authenticate the active TCP brick, wheel calibration or flashed code |
| `lely-velocity` | [Lelyrobot, 3e286c14](https://github.com/tomo1000cmd/Lelyrobot/tree/3e286c14f21db5f14d49e9ceb1b54e7e80fafb85) | `/cmd_vel` Twist → `/arduino_bridge` | The default ament_python path; C++ has different motor scaling |
| `rover-gazebo` | [ROS2-Autonomous-Rover, 1384dbbc](https://github.com/skunal3318/ROS2-Autonomous-Rover/tree/1384dbbcb9daaeabfcede0904c202521c51e27ca) | `/cmd_vel` Twist → the selected Gazebo bridge node | ROS discovery does not attest Gazebo-side delivery or FSM behavior |

The new PAROL6, Kortex seven-axis and xArm 1S MoveIt mappings, exact input requirements and command boundaries are described in [the feedback evaluation guide](email-feedback-evaluation-20260910.md).

| Recipe | Public reference | Selected boundary |
| --- | --- | --- |
| `parol6-arm` | grahas/parol6_ros2_control, c111b97d | Six-joint `/parol6_arm_controller/follow_joint_trajectory` |
| `kinova-gen3-7dof` | Kinovarobotics/ros2_kortex Jazzy, 462dab9a | Seven-joint `/joint_trajectory_controller/follow_joint_trajectory`, no prefix |
| `xarm1s-moveit-arm` | allProgramming/ros2_xarm_1s_demos, 3836e35a | Five-joint `/xarm_1s_arm_controller/follow_joint_trajectory`; hand separate |

All three require fresh exports of their own active JTC and use the same prepare/refresh/approve/capture/compare flow below. The source recipe identifies required file paths; it does not attest deployed binaries or current customer configuration.

## Prepare the inputs

Use the [local evaluation bundle](fanuc-shadow-self-service.md) and your existing ROS installation. Download these before going offline. No cloud login, remote-machine access or repository credentials are needed. Keep private files and results local.

Inspect the source links and your checkout's differences first. Run `rlsok profile source-recipes` to see the complete tracked file list. A reference commit identifies our mapping source, **not** your deployed revision. If the selected endpoint, receiver, joint list or transport has changed, stop and revise the mapping; hashing changed code does not make the old interface semantics correct. Other interfaces can use the supported generic configuration flow after separate review.

Provide these actual inputs; the command does not fill them with synthetic examples:

- A catalog from `rlsok profile discover --output catalog.json` in your isolated ROS domain, after sourcing the installed interfaces. For the first run, keep physical controllers unreachable. Do not launch a hardware bringup solely to get a catalog: TRIK bringup connects to a TCP brick and LelyRobot bringup opens a serial port.
- The local source checkout containing the recipe's files.
- The expanded URDF used for this evaluation, with Xacro includes and arguments resolved. The preparer does not execute Xacro or launch files. Preserve its source/arguments in the settings below.
- A nonempty `runtime-settings.json` object recording the operator-reviewed launch command, resolved arguments, parameter overrides and selected simulation/model configuration. For TRIK also record the reviewed wheel signs/mapping; for LelyRobot identify the Python bridge and serial/scaling settings. Keep sensitive values local. This is an operator record, **not** an automated export of the active controller state. Do not include a changing capture timestamp in this exact-byte baseline file.
- One representative message or action Goal as JSON from the chosen interface. It is evaluated locally and never sent. For Twist supply the reviewed command frame separately; for TwistStamped its `header.frame_id` must match. No speed safety envelope is inferred.
- Hexapod also requires a fresh `export-node-settings` result for the gait parameters and its selected JointTrajectory link; follow [the observed Hexapod workflow](hexapod-observed-shadow.md).
- For every recipe with a `controllerState` specification (`so101-arm`, `trik-drive`, `parol6-arm`, `kinova-gen3-7dof`, `xarm1s-moveit-arm`, `hexapod-gait`), a fresh `profile export-controller` result from the selected controller manager and controller node. This is required: a YAML copy cannot establish which controller currently owns the command interfaces.

The SO-101 recipe uses the joint order declared in its public controller configuration: `shoulder_pan`, `shoulder_lift`, `elbow_flex`, `wrist_flex`, `wrist_roll`. Its example needs `trajectory.joint_names` and `trajectory.points` with positions and increasing `time_from_start`. A similarly named state message is not a command example.

## Create and review a workspace

For example, after setting the paths and frame to your own reviewed inputs:

```sh
rlsok profile prepare-source --recipe hexapod-gait \
  --source "$CHECKOUT" --catalog catalog.json --urdf expanded.urdf \
  --settings runtime-settings.json --example command-example.json \
  --device-id isolated-hexapod --frame "$COMMAND_FRAME" \
  --controller-state baseline-controller.json --node-settings baseline-gait.json \
  --output hexapod-review
```

Use `so101-arm` without `--frame`, and add `--controller-state baseline-controller.json`. For example, export its live software state first:

```sh
rlsok profile export-controller --manager /controller_manager \
  --controller arm_controller --node /arm_controller \
  --output baseline-controller.json
```

For TRIK use `--controller diff_drive_controller --node /diff_drive_controller`, then pass that export and the actual command frame to `prepare-source`. LelyRobot needs its command frame, but does not use ros2_control controller-state export. For `rover-gazebo`, also supply `--subscriber /actual_bridge_node` from the catalog: its public launch does not fix the node name. A logger is not a substitute. Named non-controller recipe nodes may have an explicit namespace, e.g. `--subscriber /sim/arduino_bridge`; the topic itself still has to match the recipe. The SO-101/TRIK recipes map the public root-namespace controller nodes; Hexapod maps the root gait node and downstream leg controller.

The separate exporter calls only ROS `ListControllers`, `ListParameters` and `GetParameters` services, plus local graph queries for the selected controller's action servers. It does not switch controllers, set parameters or send goals. It reads selected controller metadata twice around the parameter/action reads and refuses a detected mid-read change. Service discovery must show one server node. Multiple same-name servers inside one node, transport authenticity and atomicity of all parameter reads are not proven.

Its digest covers the manager/node/domain, selected controller state/type/claimed interfaces, declared parameter values and action endpoints hosted by that node. Numeric parameter values use strings to preserve ROS int64 and double values in portable JSON, including controller defaults `inf`, `-inf` and `nan`. An explicitly unset ROS parameter is recorded with type 0 and null. These are configuration observations; message/Goal samples still undergo the existing finite-number checks. The initial source workspace requires a fresh active controller, the recipe's claimed joint interfaces and the required joint-list parameters. SO-101 also requires its selected controller node to host the trajectory action. Missing, inactive or differently bound initial controllers cannot be approved through this preparer.

The command rejects missing/ambiguous interfaces, unsupported messages, invalid mapped examples, missing files and existing output directories. It copies the selected source, expanded description, settings and required controller export into `files/`, and writes `profile.json`, `connection.json`, `proposals.json`, `catalog.json` and `source-map.json`. Source/description/settings facts hash exact bytes; the `active-controller` fact reads the export's verified configuration digest and preserves its original `observedAt`. Review all of them before using `profile approve`. Nothing is installed in the upstream ROS workspace.

## Compare a change against the original approval

From the new workspace, review and approve `profile.json` using the [local approval procedure](local-shadow-first-evaluation.md). Before **each** observation, refresh the copied inputs from the source/configuration you are actually reviewing:

```sh
rlsok profile refresh-source --workspace . --source "$CHECKOUT" \
  --urdf "$EXPANDED_URDF" --settings "$RUNTIME_SETTINGS"
rlsok profile capture --profile profile.json --output baseline.json
```

Refresh reads every required input before writing; a missing input is an error. Do not capture after any refresh error. Refresh changes only the local input copies; it preserves the approved profile, example and previous evidence.

Choose and review one changed copy in an isolated branch/directory. For SO-101, the [specified same-name type change](email-feedback-evaluation-20260910.md#so-101-change-the-same-arm-controllers-type) has its own copy generator and mock experiment. A change to a copied YAML file demonstrates file drift; it does **not** demonstrate that a running controller was swapped. For a controlled simulation swap, export the same selected controller again to a new `changed-controller.json`. The export may now show the controller inactive or absent; preserve that result. Pass `--controller-state changed-controller.json` to `refresh-source`. Refresh retains the original approval and accepts the changed state so the evaluator can report the actual mismatch. It rejects an export from a different manager/node/domain or one with an invalid digest. Do not activate or move hardware merely to demonstrate a negative result.

Refresh from the changed copy, then capture and compare with the **same** approval and example:

```sh
rlsok profile refresh-source --workspace . --source "$CHANGED_CHECKOUT" \
  --urdf "$CHANGED_EXPANDED_URDF" --settings "$CHANGED_RUNTIME_SETTINGS"
rlsok profile capture --profile profile.json --output changed.json
rlsok profile compare --profile profile.json --approval approval.json \
  --baseline baseline.json --changed changed.json --proposals proposals.json \
  --output comparison
```

Keep both observations within the profile's five-minute freshness window. Use new output paths for another comparison. Do not edit observation timestamps, replace observed values with expected hashes, or approve the changed profile to make the comparison pass.

For every controller-state recipe include the corresponding `--controller-state` file on **every** prepare/refresh call, including the baseline refresh shown above. Re-export before each capture; copying an old export does not refresh its timestamp. An old or future export produces a blocked evaluation. If the selected endpoint disappears after the swap, successful graph collection omits that path; the report records missing coverage and blocks. A graph query or file-read failure still stops collection without a fabricated observation.

The readable report should show a matching baseline and the intended changed fact failing. Use `profile.json` to resolve each fact ID to its source path. A stale-data block alone is not evidence of the intended configuration change. WOULD_ALLOW means these declared local checks passed; it is not permission to move or a physical safety proof.

## Individual project status

These commands implement source preparation, mapping and comparison, including the required read-only ros2_control state export for SO-101/TRIK. Customer-specific launch/configuration differences, actual environment runs and owner acceptance must still be established separately. Local files and operator settings alone cannot prove loaded state. The separate export reports the selected ROS software services' state at collection time; it does not authenticate compiled binaries, attached devices, firmware, physical calibration or future execution. The graph/file collector does not subscribe to, intercept or replay live commands.

Cartesian PoseStamped/WrenchStamped topics, custom JointMove services and a Dynamixel mission-to-servo adapter are not supplied by these recipes. Their boundary and authorization semantics need their own review; the available Twist or trajectory adapter cannot stand in for them. Keep evaluation private unless the participants agree on specific public material and contribution credit.
