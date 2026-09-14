# Pair the saved ROS bridge and Sunrise application

Source: [LufsSeccus/Ros2_Kuka_External_Control_Bridge_API at 26863e16](https://github.com/LufsSeccus/Ros2_Kuka_External_Control_Bridge_API/tree/26863e16ab73d8da98a8b99b65f2dd40394296d9).
The first review compares source/configuration copies; message logs and robot
telemetry are not needed. Nothing here starts ROS, opens UDP or deploys Java.

The selected files are `UDP_bridge.java`,
`kuka_udp_bridge_node/src/udp_bridge_node.cpp`,
`kuka_udp_bridge_node/launch/dual_robot.launch.py`, its package.xml and CMakeLists.txt.
Keep the C++ and Java versions together: a change on either side appears in the
report. This says which saved files changed, not whether a protocol is compatible.

The reviewed C++ bridge declares `robot_ip`, `robot_port`, `client_port` and
`network_interface`. Its defaults use robot port 30300 and client port 30333.
Java declares `PORT_ROBOT = 30300`, with an initial `PORT_CLIENT = 30333`.
The dual launch selects namespaces `/robot1` and `/robot2`, interfaces eth0/eth1
and local ports 30333/30335. The README's `robot_id` parameter is not declared
in this pinned C++ source; use the implementation when reviewing parameters.
These are source facts, not assertions about the currently deployed cabinet.

Save `selection.json`:

```json
{
  "id": "kuka-sunrise-review",
  "sourceCommit": "26863e16ab73d8da98a8b99b65f2dd40394296d9",
  "files": {},
  "selectors": {}
}
```

```sh
rlsok profile prepare-saved-setup --recipe kuka-sunrise \
  --source /path/to/Ros2_Kuka_External_Control_Bridge_API \
  --input selection.json --output setup-01
rlsok profile capture-setup --manifest setup-01/manifest.json --output observed-01.json
# Inspect the copied files first; this is your explicit saved baseline:
rlsok profile approve-setup --observation observed-01.json --actor YOUR_NAME --output baseline-01.json
```

Create a separate copy of `setup-01`. As an offline example only, change Java's
`PORT_ROBOT = 30300` to `PORT_ROBOT = 30301` in its copied `sunrise` file. Keep
the original baseline unchanged. Capture the new manifest and run:

```sh
rlsok profile review-setup --baseline baseline-01.json \
  --observation observed-02.json --output review-02
```

The result is `REVIEW_REQUIRED`, identifying `/files/sunrise`. Do not deploy
this deliberately mismatched example. For actual local files, `files` can
override `bridge`, `sunrise`, `launch`, `package` and `build` paths, and optionally
add `settings` pointing to saved JSON containing your actual parameter overrides.
Only differences from public files and their selection need customer input.

This phase does not intercept the `cmd_vel`, `goal_pose`, `arm_cmd_joints`,
`arm_goal_pose`, `arm_speed` or `base_speed` topics. It does not establish
which Java application is running, validate commands or replace KUKA controls.
