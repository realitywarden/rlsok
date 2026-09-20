# Ishan warehouse Gazebo Shadow observer v3

Version 3 corrects the expected ROS graph identity for the Humble / Fortress
bridge. The `parameter_bridge` executable reports the node
`/ros_gz_bridge`; version 2 incorrectly required `/parameter_bridge` and
therefore rejected Ishan's live graph before reading odometry.

Run from the extracted archive's `experimental/composable-shadow` directory:

```bash
python3 ishan_gazebo_status.py \
  --source-root /path/to/ros_mobile_robot \
  --output ishan-gazebo-status-v3.json
```

The observer still creates no publisher, sends no command, calls no service
and launches no simulation. It discovers the existing `/cmd_vel` subscriber,
subscribes once to the existing `/odom` stream and records the actual source
checkout. This is simulation evidence, not a physical-robot result.
