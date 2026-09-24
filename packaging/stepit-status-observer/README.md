# StepIt live status observer v1

This is a small, independent RLSOK reader for Giovanni Remigi's public
StepIt ROS 2 path. Run it only while an owner-approved StepIt robot is already
running normally. It does not launch StepIt, open the serial port, call a ROS
service, publish a robot command, or switch a controller.

The public `robot.launch.py` example defaults to `use_dummy=true`. That fake
mode publishes `/joint_states` too, so receiving a joint state by itself is
**not** evidence of a physical robot. This observer also subscribes to the
live `/robot_description` and refuses to produce an observation unless the
StepIt hardware plugin explicitly declares `use_dummy=false` and its
joint-to-motor-ID mapping is complete and unique.

## Requirements

- Ubuntu/ROS 2 environment already used for StepIt; ROS 2 Python packages
  `rclpy`, `sensor_msgs`, `std_msgs`, and `rosidl_runtime_py` available.
- An already-running StepIt graph exposes exactly one
  `/joint_state_broadcaster` publisher on `/joint_states` and one
  `/robot_state_publisher` publisher on `/robot_description`.
- The actual StepIt Git checkout used for the session is available. Its
  committed revision and dirty flag are recorded as **operator-selected**
  source context; the reader cannot attest that the running process came
  from that checkout.

Do not power, move, reconfigure, or change a robot merely for this check.

## One capture

From the extracted archive root in a terminal with StepIt's ROS 2 environment
already sourced:

```sh
python3 experimental/composable-shadow/stepit_status.py \
  --source-root /path/to/your/stepit-checkout \
  --output stepit-status.json
```

If the normal session is still using fake hardware, the command ends with
`stepit_dummy_or_unverified_hardware_mode` and writes no JSON. That is the
correct result; do not edit the URDF or start physical hardware for RLSOK.
On success it prints `OBSERVED | StepIt non-dummy ROS joint-state path |
hardware dispatch: NO` and writes one new JSON file (never overwriting an
existing one).

The output records the ROS domain, publisher endpoints, selected checkout,
live description digest, declared joint-to-motor-ID mapping, one joint-state
sample, and a digest of the record. It does not authenticate a physical motor,
Teensy, USB/serial device, firmware or actual controller code. The owner must
separately confirm that this was captured during a real-motor session.
It is observation, **not** an approval to send motion commands.

If the command fails, send the exact terminal output. If it succeeds, share
the JSON only after removing anything you consider private; no credentials,
calibration files or full logs are requested.

## Included source and checks

The ZIP preserves these repository paths:

- `experimental/composable-shadow/stepit_status.py`
- `experimental/composable-shadow/collect.py`
- `experimental/composable-shadow/controller_state.py`
- `experimental/composable-shadow/source_checkout.py`
- `experimental/composable-shadow/test_stepit_status.py`
- this README and the repository `LICENSE`

Focused source-only checks (no ROS or robot connection):

```sh
python3 -m unittest discover -s experimental/composable-shadow -p test_stepit_status.py -v
```
