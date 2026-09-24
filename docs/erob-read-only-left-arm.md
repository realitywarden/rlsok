# EROB left arm: one read-only observation during a normal session

This is for the public `xiaobailong866/erob-ros2-control` source reviewed at
`daffacd0a7d555d51a84f2901205024cdc625555`. It is a proposed first
connection, not a claim that the owner's physical arm has run RLSOK.

The public `hardware.launch.py` loads `RealLeftArm` with
`erob_hardware/ErobHardwareInterface`, alongside a mock right arm and head,
then starts `joint_state_broadcaster`. The separate MoveIt demo uses mock
hardware. We therefore do **not** accept a `/joint_states` message by itself
as evidence of the left-arm path.

Only if the owner is **already running the physical left arm as part of normal
work** and agrees with this scope, open a second ROS 2 Humble terminal in the
same ROS domain. Do not start `hardware.launch.py`, activate a controller,
enable a drive, change EtherCAT state, or move the arm just for this check.
From an extracted RLSOK source archive:

```bash
source /opt/ros/humble/setup.bash
source /path/to/erob_ws/install/setup.bash
cd /path/to/rlsok/experimental/composable-shadow
python3 erob_status.py --source-root /path/to/erob-ros2-control \
  --output erob-left-status.json
```

The command creates only a ROS subscriber node. It reads one existing
`/robot_description` and one newly received `/joint_states` message, checks
unique publisher endpoints and their GIDs, rejects the fake-only description,
and requires all seven left-arm joint positions. It does not call a ROS
service, open the EtherCAT master, start a launch file, publish a command, or
write to the robot. It writes one local JSON file and will not overwrite an
existing output.

If the command fails, stop there and send only the complete
`erob_status_capture_failed:...` line. If it succeeds, the useful response is
the JSON plus one sentence confirming whether the physical left arm was
connected and the usual hardware launch was already running. Please remove
private paths or network details before sharing. The JSON includes the local
checkout commit and dirty flag, but omits the checkout path and origin remote.
No photo, video, motor movement, or extra hardware session is needed.

The JSON proves a ROS sample beside a live description *declaring* the real
left-arm plugin. It does not independently prove EtherCAT OP state, the
physical arm's identity, that the selected source checkout is what the running
process loaded, or safe/authorized motion. If the source or running launch
differs from the reviewed public version, review that difference before
interpreting the result. A successful first capture is not repeat use.
