# Source-bound status observers v2

The MIRA, TRIK, LelyRobot, reBot B601-RS, dual Kinova and Ishan warehouse
observers now require `--source-root` pointing at the actual project checkout
used for the running ROS graph. Each observation reads and records the full Git
commit, dirty state, checkout name and all `origin` URLs. A typed commit string
is no longer accepted as evidence of the code that was actually selected.

Run from the archive's `experimental/composable-shadow` directory. Replace the
paths with the owner's real checkout and a new output filename:

```bash
python3 mira_status.py --source-root /path/to/mira --output mira-status.json
python3 trik_status.py --source-root /path/to/trik_ros2_control --output trik-status.json
python3 lely_status.py --source-root /path/to/Lelyrobot --bridge-variant python --output lely-status.json
python3 rebot_status.py --source-root /path/to/rebotarm_ros2 --output rebot-status.json
python3 dual_kinova_status.py --source-root /path/to/wearable-stack --output dual-kinova-status.json
python3 ishan_gazebo_status.py --source-root /path/to/ros_mobile_robot --output ishan-gazebo-status.json
```

The selected path must be the Git checkout root and must have an `origin`
remote. Dirty worktrees are recorded rather than silently treated as the named
commit. Absolute local paths are not written into the observation.

These remain subscription-only observers: they do not publish, call services,
open robot transports, launch a stack, enable a controller or move hardware.
The physical collectors must be run only during an owner's already-running
normal maintenance session. Ishan's collector remains simulation-only.

Focused offline checks cover source identity, ambiguity and selected-message
validation, plus absence of command APIs. They are not evidence that an owner
ran the package or that a physical robot was connected.
