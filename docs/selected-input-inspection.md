# Inspect the selected files before approving a baseline

`inspect-saved-inputs` reviews the relationships between selected files. It
does not start ROS, evaluate xacro, import a robot package or open a device.
Use the same selection JSON as `prepare-saved-setup`:

```sh
rlsok profile inspect-saved-inputs --recipe aditya-so101 \
  --source /path/to/selected/checkout --input selected-files.json \
  --output inspection-01
```

Read `inspection-01/report.md`. Exit 0 means `NO_STATIC_ISSUES` within the
listed checks; exit 1 means `REVIEW_REQUIRED` or `NEEDS_MATERIAL`. Invalid
selection syntax is an input error. Reports preserve file SHA256 values,
specific issue codes and configuration facts. Invalid/duplicate YAML also
produces a report, so inspection can precede preparation.

Preparation for these three recipes also writes `inspection.md` and
`inspection.json`. Read those before approving a baseline. A
`READY_FOR_REVIEW` capture means the selected files can be compared; it does
not override static findings or establish that a controller can start.

## SO101 physical bridge

This recipe concerns [iAdityaDev/so_101_arm hardware at 6f8f1349](https://github.com/iAdityaDev/so_101_arm/tree/6f8f1349e47735695f124b483a41e88bf18ffa8a),
with its uppercase ROS joint names. It is distinct from the lowercase SO101
controller recipe.

```json
{
  "id": "my-selected-so101",
  "sourceCommit": "6f8f1349e47735695f124b483a41e88bf18ffa8a",
  "files": {
    "bridge": "bridge.json",
    "calibration": "my_follower.json",
    "controllers": "hardware_controllers.yaml",
    "model": "selected-expanded.urdf",
    "ros2_control": "selected-expanded.urdf",
    "launch": "selected-launch.py"
  }
}
```

`bridge.json` records the actual `port`, `robot_id`, `commands_topic`,
`states_topic` and `joint_name_map`. Add `selected_controllers`, an array of
the controller names intended for this physical bridge. This selection field
belongs to the review file; it is not an extra ROS driver parameter.

Checks cover all five arm motors plus the separate gripper, unique motor/joint
assignments, matching calibration keys/filename, integer MotorCalibration
fields, increasing calibration ranges, unique motor IDs, joint names in the
selected model, controller joint references and the position-only driver
contract. The model/bridge command and state topics are compared too.

The reviewed public YAML requests velocity state for arm/gripper controllers;
the C++ driver exports position only. The public control xacro also declares
velocity/effort state for five joints. These are reported for review; no
controller or live configuration is rewritten. An unexpanded xacro is read
literally: inspect its conditions and supply the expanded physical model for
the definitive selected branch. Simulation/fake-hardware branches can differ.
The chosen launch and measured calibration are still operator inputs.

The checker does not calculate calibration, choose motor offsets, connect
LeRobot or establish the actual installed LeRobot version. Five arm joints use
the bridge's radian/degree conversion; the gripper has its own percentage/radian
conversion and is not treated as a sixth arm joint.

## Dons Beast

Use `--recipe beast` with `files.parameters`, `files.model`, `files.launch` and
the selected Dons_Beast source checkout. The report lists the bridge's literal
`declare_parameter` names/default expressions and selected wildcard values.
It flags `watchdog_timeout` when the bridge instead declares
`cmd_vel_timeout`, and flags an omitted explicit command timeout. Launch-time
overrides are not evaluated. If YAML cannot be parsed, selected parameter
values are reported as unavailable, not silently taken from the last duplicate.

The [reviewed public file](https://github.com/Dwilliestyle/Dons_Beast/blob/1ecf5e4fd374f1bfa77630a51794ffd2e4b017dc/beast_bringup/config/beast_params.yaml)
contains two `low_voltage_threshold` entries. The inspection preserves the
parse error and line information. The project owner must supply the intended
value/current file; RLSOK does not choose between 9 and 10 volts. No serial
bridge, firmware update or velocity command is run.

## Cartesian single/dual configuration and saved native messages

Use `--recipe cartesian` with `settings`, `controllers`, `model` and `launch`.
`settings.config_type` selects `single_arm` or `dual_arm`. The source selection
is [cartesian_motion_base f61cfa12](https://github.com/leledeyuan00/cartesian_motion_base/tree/f61cfa12956d571a3bf6b576a27aba050ecba905).
The report maps `ur` or `left`/`right` to the corresponding controller's ordered
joints, base/tool frames and native endpoints. It detects duplicate/shared
joints, absent frame fields and endpoint disagreement with the selected public
`cartesian_motion_config.hpp`.

Optionally add `files.commands` pointing to a JSON array of saved message
envelopes. This is an offline review of supplied message fields, not a ROS
publisher, subscriber, service call, interception hook or motion permit.

```json
[
  {
    "role": "left",
    "type": "cartesian_controller_msgs/srv/JointMove",
    "endpoint": "/left_cartesian_compliance_controller/target_joint",
    "units": "rad",
    "jointOrder": [
      "left_shoulder_pan_joint", "left_shoulder_lift_joint",
      "left_elbow_joint", "left_wrist_1_joint",
      "left_wrist_2_joint", "left_wrist_3_joint"
    ],
    "message": {
      "cmd": {"layout": {"dim": [], "data_offset": 0}, "data": [0, 0, 0, 0, 0, 0]},
      "duration": 5
    }
  }
]
```

Those zero positions are a **synthetic format example**, not a robot pose to
execute. `JointMove` has no joint names in its native request; the envelope's
`jointOrder` must exactly match the selected controller order. Duration must
be finite and positive; the flat array must have the right number of finite
positions and zero offset. Radians apply to this reviewed UR example, not
arbitrary unreviewed prismatic/custom robots.

For `geometry_msgs/msg/PoseStamped`, use `/CONTROLLER/target_frame`, `units:
"m"` and the native `header` plus `pose.position`/`pose.orientation` object.
The frame must equal `robot_base_link`; named x/y/z/w quaternion components
must be finite and unit length. Stamps use integer sec/nanosec; no freshness
or live transform is inferred from this saved message.

For `geometry_msgs/msg/WrenchStamped`, use `/CONTROLLER/target_wrench`,
`units: "N,Nm"`, `expressedIn: "the_actual_coordinate_frame"`, and native
`header` plus `wrench.force`/`wrench.torque` vectors. In the reviewed
[garment controller source b0832524](https://github.com/leledeyuan00/cartesian_controllers/blob/b0832524b458232a8923403ca6694cd82f99572d/cartesian_force_controller/src/cartesian_force_controller.cpp),
the callback ignores `header.frame_id`: `hand_frame_control: true` selects
end-effector coordinates, otherwise base coordinates (the source default is
false). A header alone cannot establish a transform. The checker requires
matching explicit `expressedIn` and reports `force_enable` when it is not true.
The public example currently sets `force_enable: false`.

The actual [JointMove service definition](https://github.com/leledeyuan00/cartesian_controllers/blob/b0832524b458232a8923403ca6694cd82f99572d/cartesian_controller_msgs/srv/JointMove.srv)
and receiving controller are the source contract used here. The installed
controller dependency, private dual-arm model, actual configuration, collision
state, joint limits and runtime handoff remain separate facts. No clear static
report should be interpreted as proof that those facts were checked.

## Compare the original baseline with later copies

After resolving inspection findings and reviewing the selected files, use the
[saved-setup workflow](saved-setup-review.md) to capture, explicitly approve and
compare. Keep the original baseline. Reports now include before/after values
and source line excerpts; unavailable or malformed selected files and missing
mapped fields yield `NEEDS_MATERIAL` instead of disappearing behind an error.
Ambiguous device aliases are never normalized into a match.
