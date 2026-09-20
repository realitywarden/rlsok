# LelyRobot ultrasonic observer v1

This project-specific utility reads one `/ultrasonic_left`
`sensor_msgs/msg/Range` sample from an already-running LelyRobot graph. It
requires the unique publisher to be `/arduino_bridge`, records the exact source
commit and operator-selected Python/C++ bridge variant, validates finite range
metadata and writes a canonical observation hash.

The reader only creates a ROS subscription. It does not open serial, start
bringup, publish `/cmd_vel`, call a service or send a stop command. Use it only
during normal owner maintenance; do not power or launch the robot for RLSOK.
The output proves only that the selected ROS sensor path produced one sample.
It does not authenticate the Arduino or firmware, prove motor safety or
command delivery, or establish customer acceptance.
