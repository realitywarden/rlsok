#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 4 ]; then
  echo 'Usage: run_hexapod_gazebo_experiment.sh RUNTIME_ROOT SOURCE_CHECKOUT LINUX_NODE NEW_OUTPUT_DIRECTORY' >&2
  exit 2
fi
export ROS_DISTRO=jazzy ROS_VERSION=2 ROS_PYTHON_VERSION=3 AMENT_PREFIX_PATH=/opt/ros/jazzy
export PATH="/opt/ros/jazzy/bin:$PATH"
export LD_LIBRARY_PATH="/opt/ros/jazzy/lib:/opt/ros/jazzy/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PYTHONPATH="/opt/ros/jazzy/lib/python3.12/site-packages${PYTHONPATH:+:$PYTHONPATH}"
exec unshare --net bash -c 'set -e; ip link set lo up multicast on; ip route add 224.0.0.0/4 dev lo; exec python3 "$1/experimental/composable-shadow/hexapod_gazebo_experiment.py" --runtime "$1" --source "$2" --node "$3" --output "$4"' hexapod-experiment "$@"
