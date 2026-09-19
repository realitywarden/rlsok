# RobStride command-envelope review

This offline recipe keeps the robot's narrower ROS-joint command envelope
separate from the motor model's CAN encoding range. It copies saved inputs and
source; it never opens SocketCAN, loads ros2_control, publishes a command or
changes a motor.

The mapping is based on
[`s2015-turtle/robstride_ros2` at `ae432432`](https://github.com/s2015-turtle/robstride_ros2/tree/ae43243280d9d9fa842734c45e994613c3872609).
That reference commit is not evidence that a local install uses the same bytes.

Prepare a selection file:

```json
{
  "controller": "robstride_velocity_controller",
  "commandTopic": "/robstride_velocity_controller/commands",
  "commandInterface": "velocity",
  "joints": ["robstride_joint"],
  "rosCoordinates": true,
  "provenance": "operator-selected"
}
```

Prepare the recipe input without putting a live bus or robot into the process:

```json
{
  "id": "my-robstride-command-envelope",
  "sourceCommit": "ae43243280d9d9fa842734c45e994613c3872609",
  "files": {
    "selection": "robstride-selection.json",
    "expanded_robot_description": "robot-description.urdf",
    "controllers": "controllers.yaml"
  },
  "selectors": {}
}
```

Run:

```sh
rlsok profile prepare-saved-setup \
  --recipe robstride-command-envelope \
  --source "$ROBSTRIDE_SOURCE" --input inputs.json --output robstride-review
```

Review `REVIEW.md`, every copied file and `manifest.json`, then use the normal
capture/approve/review commands in [saved setup review](saved-setup-review.md).
The expanded robot description is required because the selected
`command_position_*`, `command_velocity_*` and `command_effort_*` values must be
reviewed together with motor model or explicit CAN ranges, `direction`,
`gear_ratio`, `position_offset`, gains, watchdog and CAN IDs.

The recipe binds the saved controller, interface, topic, ordered joints,
controller YAML, expanded description and implementation source. It does not
claim an active controller or installed binary. A future live gate would also
need a fresh controller export and an explicitly supported command-message
adapter; this saved review does not intercept or forward
`std_msgs/msg/Float64MultiArray`.

## Boundary

- RLSOK treats the `command_*` values in ROS joint coordinates as the reviewed
  operating envelope.
- `robstride_ros2` remains responsible for joint/motor conversion, motor model
  constraints and private-protocol encoding.
- Matching CAN IDs are topology/configuration evidence, not authenticated
  physical-device identity. Use a proof-verified device handshake before
  requiring `device.identity.authenticated`; otherwise describe identity as
  weak and keep that trusted capability unavailable.
- `UNCHANGED` means the selected saved inputs match. It is not a motion permit,
  hardware validation or owner acceptance.
