# Direct LeRobot SO-101 saved review

This recipe covers direct LeRobot leader/follower serial workflows. It is
deliberately separate from the ROS 2 `FollowJointTrajectory` SO-101 recipe.
It compares saved files only and never imports LeRobot or opens an arm.

The reviewed source reference is
[`huggingface/lerobot` at `5aa74557`](https://github.com/huggingface/lerobot/tree/5aa74557f84c54d4b458f8b9643c5aa2982acfed).
Use the exact commit installed or checked out on the workstation instead of
copying that value blindly.

Prepare a workflow file such as:

```json
{
  "mode": "teleoperate",
  "follower": {
    "type": "so101_follower",
    "id": "my-follower",
    "port": "/dev/ttyACM0",
    "use_degrees": true,
    "max_relative_target": 5
  },
  "leader": {
    "type": "so101_leader",
    "id": "my-leader",
    "port": "/dev/ttyACM1",
    "use_degrees": true
  },
  "offline": true,
  "provenance": "operator-selected"
}
```

The recipe input must name `workflow`, `follower_calibration` and, when a
leader is selected, `leader_calibration`. A `policy-evaluate` workflow must
also select an exact local policy path and revision. Optional device selectors
can bind leader/follower roles to stronger serial/topology observations rather
than port enumeration.

```sh
rlsok profile prepare-saved-setup --recipe lerobot-so101-direct \
  --source "$LEROBOT_SOURCE" --input inputs.json --output so101-direct-review
```

Review the generated source map, files and manifest, then follow
[saved setup review](saved-setup-review.md). The compared boundary includes
the workflow mode, arm types, distinct IDs and ports, calibration bytes, angle
convention, follower relative-target limit, optional policy identity and the
relevant LeRobot implementation source.

`offline: true` is a reviewed requirement, not enforcement of a network
sandbox. Run inside an OS/network sandbox if proof of no network access is
needed. Generated reports and copied inputs stay local unless the operator
chooses to upload them. RLSOK does not publish a participant's name, files or
results; any public attribution requires separate agreement.

The LeRobot ID locates calibration data and the port locates a bus. Neither is
cryptographic physical identity. An unchanged saved review is not a live arm
check, motion permit, hardware validation or customer acceptance.
