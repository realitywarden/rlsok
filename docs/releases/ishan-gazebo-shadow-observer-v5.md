# Ishan warehouse Gazebo Shadow observer v5

Version 5 removes the remaining dependence on a display-formatted DDS node
name. In Ishan's Humble / Fortress Fast DDS graph, discovery can expose the
bridge endpoints with placeholder node metadata even though the topic, type
and participant are valid. V5 keeps the raw node namespace and name, accepts
only the standard unknown-node markers, and proves that the unique `/cmd_vel`
subscriber and `/odom` publisher share the same 12-byte DDS participant GID
prefix. Arbitrary node names and endpoints from different participants remain
hard failures.

The JSON records `observerVersion: "5"` and `source.bridgeEvidence`, including
whether the match used the verified ROS node name or the DDS participant GID.
The observer remains read-only: it creates no publishers, sends no commands and
calls no services.

Run from the extracted archive's `experimental/composable-shadow` directory:

```bash
python3 ishan_gazebo_status.py --version
python3 ishan_gazebo_status.py \
  --source-root /path/to/ros_mobile_robot \
  --output ishan-gazebo-status-v5.json
```
