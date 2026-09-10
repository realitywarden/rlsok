# Hexapod: fresh gait and downstream controller facts in an isolated simulation

The source mapping is [hexapod_ros2 at 656eebab](https://github.com/ariegweomamerie/hexapod_ros2/tree/656eebab5587977a1f41d44657cb853433927053). Its two reference launches remain:

```sh
ros2 launch Hexapod_Robot_description gazebo.launch.py
ros2 launch hexapod_gait gait.launch.py
```

This evaluation adds fresh observations to the `/cmd_vel` input mapping: the gait node's typed parameters, its observed JointTrajectory output connection and the active downstream `leg_controller` with the exact 18 ordered leg joints. The face controller is separate. Selected gait/IK/launch/controller source files and the expanded model remain bound to the review. This does not insert a gate into the gait loop or certify IK, walking stability, physical limits or a later Pi/PWM HAL.

Use an already isolated Gazebo environment first. Other nodes can send commands even though RLSOK sends none. The supplied experiment uses only the public model's neutral stance and never publishes `/cmd_vel`; its local nonzero Twist example is evaluated as data only.

## Prepare the actual observations

After the model, gait timer and controllers are running, export both sources:

```sh
rlsok profile export-controller --manager /controller_manager \
  --controller leg_controller --node /leg_controller --output baseline-controller.json
rlsok profile export-node-settings --node /hexapod_gait \
  --downstream-node /leg_controller --topic /leg_controller/joint_trajectory \
  --type trajectory_msgs/msg/JointTrajectory --output baseline-gait.json
rlsok profile discover --output catalog.json
rlsok profile prepare-source --recipe hexapod-gait --source "$CHECKOUT" \
  --catalog catalog.json --urdf expanded.urdf --settings runtime-settings.json \
  --example local-twist.json --device-id isolated-hexapod --frame base_footprint \
  --controller-state baseline-controller.json --node-settings baseline-gait.json \
  --output hexapod-review
```

The fixed public mapping currently uses the root node names above. An unrelated controller or a namespaced input alongside root-node parameter exports is rejected. The node exporter performs two read-only parameter/link reads. The downstream link must have exactly the selected gait publisher and controller subscriber of the expected type; it does not publish a probe trajectory. Missing or ambiguous links fail export. Parameter and controller export timestamps are preserved: copying an old file does not make it fresh.

Review all facts and the local candidate, then use the normal `profile approve`, `profile capture` and `profile shadow` commands from [source workspaces](source-shadow-workspaces.md). Before **every** capture, re-export the current controller and gait node, and refresh with both:

```sh
rlsok profile refresh-source --workspace hexapod-review --source "$CHECKOUT" \
  --urdf expanded.urdf --settings runtime-settings.json \
  --controller-state current-controller.json --node-settings current-gait.json
```

Do not capture after an export or refresh fails. Keep the old profile and approval for a changed-configuration comparison. Both JSON facts use their original `observedAt`; the existing profile freshness check applies to each export separately. The exporter observes ROS parameter values and visible endpoints, not arbitrary private variables, authenticated firmware or every possible bypass.

The public GaitNode reads parameters into member variables during construction. A successful ROS parameter-service update alone does not prove those cached values changed. For the supplied change case, the experiment restarts **only the gait process** with an explicit `cycle_time:=2.0` launch override, after an initial `1.0` run. It leaves source, model and controllers unchanged, waits again for 18-joint gait output and simulator feedback, exports fresh facts, and requires the original approval to block the changed facts. No mechanical numbers are prescribed for customer hardware.

Earlier Hexapod source workspaces did not include these two fresh exports. Create a new reviewed workspace with this release; keep older evidence. Do not rewrite an older profile or pretend that an old file-only approval covered the new facts.

## Reproduce this one source experiment

With the pinned checkout, a built runtime, Linux Node, Jazzy and Gazebo Harmonic dependencies already installed:

```sh
bash experimental/composable-shadow/run_hexapod_gazebo_experiment.sh \
  /absolute/rlsok /absolute/hexapod_ros2 /absolute/linux/node /absolute/new-output
```

The script refuses a network namespace containing non-loopback interfaces. It builds only `Hexapod_Robot_description` and `hexapod_gait`, starts Gazebo headlessly with the original model, uses the original clock bridge and three controllers, and runs the unmodified public gait/IK code. It records actual clock, gait trajectories and joint feedback as evidence that the timer and downstream simulation ran. The baseline/changed reports and hashes of the preserved approval/profile/candidate are saved. It stops its own processes when finished. This is public-source simulation evidence, not a customer's working-tree confirmation, physical trial or acceptance.
