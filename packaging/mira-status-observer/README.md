# RLSOK MIRA status observer v1

This small ROS 2 tool records one live PX4 `VehicleStatus` sample from an
already running MIRA maintenance session. It is separate from the Windows and
macOS Local Check downloads.

## Requirements

- the physical MIRA is already powered under the owner's normal maintenance
  procedure, remains disarmed, and has propellers removed or otherwise disabled;
- ROS 2 is sourced and can already see `/fmu/out/vehicle_status`;
- `px4_msgs/msg/VehicleStatus`, `rclpy` and `rosidl_runtime_py` are installed;
- `ROS_DISTRO` is set and `ROS_DOMAIN_ID` is either unset (domain 0) or a decimal
  value from 0 through 232.

Do not launch, power or reconfigure the robot solely to run this observer.

## Capture

From the extracted archive root:

```sh
python3 experimental/composable-shadow/mira_status.py --output mira-status.json
```

The command refuses to replace an existing output. A successful capture prints:

```text
OBSERVED | MIRA VehicleStatus read only | hardware dispatch: NO
```

The observer creates one ROS subscription. It has no publisher or service
client and does not arm, enter Offboard, call a MIRA service or publish
`/cmd_vel`.

## What the file proves

The JSON records the visible ROS distribution, RMW implementation, domain,
single publisher endpoint, selected `VehicleStatus` fields and an observation
digest. It proves only that this ROS graph exposed that topic at capture time.

It does **not** authenticate a Pixhawk, airframe or vehicle; prove installed
firmware; validate estimation, battery, sensor calibration or failsafes; certify
flight readiness; or grant permission to arm or move. The system owner must
provide the exact MIRA checkout and maintenance context before the capture can
be described as physical-MIRA evidence.

## Included source

The archive preserves these repository paths:

- `experimental/composable-shadow/mira_status.py`
- `experimental/composable-shadow/collect.py`
- `experimental/composable-shadow/controller_state.py`
- `experimental/composable-shadow/test_mira_status.py`
- this README and the repository `LICENSE`

Run the focused offline checks with:

```sh
python3 -m unittest discover -s experimental/composable-shadow -p test_mira_status.py -v
```

Those checks do not connect to ROS or a robot.
