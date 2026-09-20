# RLSOK warehouse Gazebo Shadow observer v1

This archive contains a subscription-only observer for the public
`ishan-xy/ros_mobile_robot` warehouse simulation at commit
`e3cadc4182f3cbc0fc2cde0eee2db0fba4939366`.

After the simulation is already running:

```bash
source /opt/ros/humble/setup.bash
source /path/to/ros_mobile_robot/install/setup.bash
python3 ishan_gazebo_status.py \
  --source-commit e3cadc4182f3cbc0fc2cde0eee2db0fba4939366 \
  --output ishan-gazebo-status.json
```

Return `ishan-gazebo-status.json` and the exact checkout commit. The reader
only discovers the `/cmd_vel` subscriber and subscribes once to `/odom`. It
does not publish a command, launch the simulation, call a service or touch
physical hardware.

Focused offline check:

```bash
python3 -m unittest -v test_ishan_gazebo_status.py
```
