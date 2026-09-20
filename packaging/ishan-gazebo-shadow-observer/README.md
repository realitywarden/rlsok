# RLSOK warehouse Gazebo Shadow observer v4

This archive contains a subscription-only observer for the public
`ishan-xy/ros_mobile_robot` warehouse simulation at commit
`ec909071f6d9275661372bba196ba47857f7bea8` (the portable-path PR revision).

After the simulation is already running:

```bash
source /opt/ros/humble/setup.bash
source /path/to/ros_mobile_robot/install/setup.bash
python3 ishan_gazebo_status.py --version
python3 ishan_gazebo_status.py \
  --source-root /path/to/ros_mobile_robot \
  --output ishan-gazebo-status.json
```

Return `ishan-gazebo-status.json`. The reader records the exact checkout
commit, dirty state and origin itself. The version command must print `4`.
The reader accepts either the verified `/ros_gz_bridge` graph identity or the
exact `/_NODE_NAMESPACE_UNKNOWN_/_NODE_NAME_UNKNOWN_` sentinel that Fast DDS
can expose for a valid bridge endpoint. In the latter case the JSON preserves
the sentinel and marks `nodeIdentity` as `middleware_unknown`; it never invents
a bridge identity. The reader only discovers the unique, correctly typed
`/cmd_vel` subscriber and subscribes once to `/odom`. It
does not publish a command, launch the simulation, call a service or touch
physical hardware.

Focused offline check:

```bash
python3 -m unittest -v test_ishan_gazebo_status.py
```
