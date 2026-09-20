# Ishan warehouse Gazebo Shadow observer v4

Version 4 fixes the live Humble / Fortress failure reported from the released
v3 archive. Fast DDS exposed the bridge endpoint as the exact ROS middleware
sentinel `/_NODE_NAMESPACE_UNKNOWN_/_NODE_NAME_UNKNOWN_`, so v3 rejected the
endpoint before reading odometry even though its topic, type and endpoint count
were correct.

V4 accepts that exact sentinel without claiming a known node identity. The JSON
preserves the observed node value and records `nodeIdentity` as either
`verified` or `middleware_unknown`. Arbitrary node names, wrong message types
and multiple endpoints remain hard failures. The output also carries
`observerVersion: "4"`, and `python3 ishan_gazebo_status.py --version` must
print `4` so an old extracted package cannot be mistaken for the current one.

The release is accepted only after the exact published ZIP runs against the
actual ROS 2 Humble / Gazebo Fortress launch at portable-path PR commit
`ec909071f6d9275661372bba196ba47857f7bea8`. That acceptance discovers
`/cmd_vel`, observes one `/odom` sample and asserts zero RLSOK publishers and
zero commands. It is live simulation evidence, not physical-robot evidence.

Run from the extracted archive's `experimental/composable-shadow` directory:

```bash
python3 ishan_gazebo_status.py --version
python3 ishan_gazebo_status.py \
  --source-root /path/to/ros_mobile_robot \
  --output ishan-gazebo-status-v4.json
```
