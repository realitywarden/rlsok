# Pioneer-X ESP32 state observer v1

This is an independent, subscriber-only first-connection check for the public
Pioneer-X micro-ROS graph. The reviewed firmware at commit
`39f67a0697f8b28669c26edfe5ca2124348756d7` publishes two existing
state topics from `robot_esp32_node`: `/wheel_ticks`
(`std_msgs/msg/Int32MultiArray`) and `/posicion_estimada`
(`geometry_msgs/msg/Point`). The reader does not connect to the ESP32,
open SCADA, start micro-ROS, select an algorithm or publish a motor command.

José approved an **offline** source-based evaluation, not this live run. Use
this observer on a physical Pioneer-X only if its owner agrees, and only
during a session already being run for the owner's normal work. Do not power,
move or reconfigure the robot for RLSOK.

## Requirements

- An already-running ROS 2/micro-ROS graph exposing the two topics above.
- ROS 2 Python packages `rclpy`, `std_msgs`, `geometry_msgs`, and
  `rosidl_runtime_py` in the sourced environment.
- The actual Pioneer-X source checkout used for the session; its commit,
  origin and dirty flag are recorded as **operator-selected context**.

## Capture

From the extracted ZIP root:

```sh
python3 experimental/composable-shadow/pioneer_status.py \
  --source-root /path/to/pioneer-ros2-diff-drive \
  --output pioneer-status.json
```

The command refuses to overwrite an existing file. If it fails, the exact
terminal output is sufficient; do not alter the robot to make the observer
pass. If it succeeds, the JSON records one pair of messages received within
five seconds, ROS endpoint metadata, environment and a digest.

The two public message types have no source timestamp or device attestation.
Even a successful JSON does **not** establish the physical chassis, ESP32,
flashed firmware, sensor accuracy, selected tracker configuration, command
path or safe motion. The owner must separately confirm that this capture was
from the physical platform in its normal session. It grants no permission to
move. No owner-run physical Pioneer-X result exists yet.

## Included source and focused checks

- `experimental/composable-shadow/pioneer_status.py`
- `experimental/composable-shadow/collect.py`
- `experimental/composable-shadow/controller_state.py`
- `experimental/composable-shadow/source_checkout.py`
- `experimental/composable-shadow/test_pioneer_status.py`
- this README and the repository `LICENSE`

```sh
python3 -m unittest discover -s experimental/composable-shadow -p test_pioneer_status.py -v
```

Those checks use synthetic message objects and do not connect to ROS or a
robot.
