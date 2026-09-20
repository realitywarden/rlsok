# Warehouse Gazebo Shadow observer v1

This project-specific observer is pinned to
`ishan-xy/ros_mobile_robot@e3cadc4182f3cbc0fc2cde0eee2db0fba4939366`.
The source maps ROS `/cmd_vel` (`geometry_msgs/msg/Twist`) through one
`ros_gz_bridge` parameter bridge to the Gazebo DiffDrive plugin. Gazebo
odometry returns through the same bridge on `/odom`.

Run the reader only after the simulation is already running:

```bash
source /opt/ros/humble/setup.bash
source /path/to/ros_mobile_robot/install/setup.bash
python3 ishan_gazebo_status.py \
  --source-commit e3cadc4182f3cbc0fc2cde0eee2db0fba4939366 \
  --output ishan-gazebo-status.json
```

The reader requires exactly one `/parameter_bridge` subscription to
`/cmd_vel`, exactly one `/parameter_bridge` publisher on `/odom`, and one
odometry sample with `odom` plus a non-empty body frame. It records the ROS
distro, RMW, domain, endpoint GIDs, source commit, frames, pose and velocity.

It creates one odometry subscription only. It does not create a publisher,
send a Twist, launch Gazebo, call a service or open hardware. The result can
demonstrate the source-selected Shadow observation flow in simulation. It is
not a physical-robot connection, authenticated simulator instance, safety
claim, controller gate or permission to reuse this configuration on hardware.
