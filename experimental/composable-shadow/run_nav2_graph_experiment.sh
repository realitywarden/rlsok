#!/usr/bin/env bash
set -eo pipefail
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo 'Usage: run_nav2_graph_experiment.sh RUNTIME_ROOT LINUX_NODE NEW_OUTPUT_DIRECTORY [--gazebo]' >&2
  exit 2
fi
# This installed-deb-only experiment needs no overlay discovery. Avoid loading
# unrelated workspaces or running every installed package's environment hook.
export ROS_DISTRO=jazzy ROS_VERSION=2 ROS_PYTHON_VERSION=3
export AMENT_PREFIX_PATH=/opt/ros/jazzy
export GZ_IP=127.0.0.1
export PATH="/opt/ros/jazzy/bin:$PATH"
export LD_LIBRARY_PATH="/opt/ros/jazzy/lib:/opt/ros/jazzy/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PYTHONPATH="/opt/ros/jazzy/lib/python3.12/site-packages:/opt/ros/jazzy/local/lib/python3.12/dist-packages${PYTHONPATH:+:$PYTHONPATH}"
set -u
exec unshare --net bash -c 'set -e; ip link set lo up multicast on; ip route add 224.0.0.0/4 dev lo; exec python3 "$1/experimental/composable-shadow/nav2_graph_experiment.py" --runtime "$1" --node "$2" --output "$3" ${4:+"$4"}' nav2-experiment "$@"
