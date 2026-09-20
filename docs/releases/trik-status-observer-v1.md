# TRIK wheel and odometry observer v1

This separate observer records two state messages from an **already-running**
TRIK ROS 2 graph:

- `/joint_states` (`sensor_msgs/msg/JointState`) for
  `base_left_wheel_joint` and `base_right_wheel_joint`;
- `/diff_drive_controller/odom` (`nav_msgs/msg/Odometry`).

It creates subscriptions only. It does not connect to the TRIK brick TCP
server, publish `/cmd_vel`, call controller services, activate controllers or
write zero motor power. Run it only while the owner is already using the robot
for normal maintenance; do not power or launch the robot solely for this
capture.

```bash
source /opt/ros/jazzy/setup.bash
source /path/to/trik_ws/install/setup.bash
python3 trik_status.py --output trik-status.json
```

The command requires exactly one publisher of each selected type, both wheel
joint names, finite wheel/odometry values and non-empty odometry/body frames.
It writes a digested JSON observation with ROS distro, RMW, domain, publisher
endpoints, message timestamps, wheel states and odometry.

The observation does **not** authenticate the physical brick, flashed Python
script, motor/encoder wiring, wheel calibration, firmware or future execution
state. Publisher GIDs are observation context, not durable device identity.
Use `rlsok profile export-controller` separately if the selected controller
configuration also needs to be reviewed.
