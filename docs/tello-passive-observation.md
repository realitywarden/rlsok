# Tello: observe an existing service call locally

This experimental entry point answers the service-based Tello trial: copy the
existing client's command into a local record, with **no RLSOK command sending
and no RLSOK command blocking**. It uses Python's standard library. It needs no
Cloud account, payment, Node runtime or internet connection during capture.

## What is observed

The public reference is
[RoboticsLabURJC/2022-tfg-guillermo-bernal at 8a66ad7](https://github.com/RoboticsLabURJC/2022-tfg-guillermo-bernal/tree/8a66ad7e3d08b0e92877107b184dff45375f99d3/tello/tello_ws/src).
Its `tello_simple_teleop/tello_simple_teleop/tello_simple_teleop.py` sends
`TelloAction.Request.cmd` through `self.cli.call_async(self.req)` to
`tello_action`, then spins for its future. The actual
[TelloAction.srv](https://github.com/RoboticsLabURJC/2022-tfg-guillermo-bernal/blob/8a66ad7e3d08b0e92877107b184dff45375f99d3/tello/tello_ws/src/tello_ros/tello_msgs/srv/TelloAction.srv)
has a string `cmd` and an initial response `rc`. The README also contains an
older `tello_command` spelling; the code and interface are the reference here.

```text
existing teleop → existing call_async → original tello_action server/driver
                       ↓ after call_async returns
                 copy client-reported service + cmd
                       ↓ nonblocking local Unix datagram, no reply channel
                 separate RLSOK capture → private local JSONL
```

The patch inserts observation **after** the original call. It never calls,
wraps, replaces or cancels the client, never uses its return as permission,
and leaves the original wait and future unchanged. A recorder exception,
missing receiver or full queue drops the observation. There is no retry and
no synchronous disk or network request in this added call. Copying/serializing
and the local syscall still cost CPU time: this is not a hard-real-time or
zero-overhead guarantee.

This observes the instrumented client boundary, not all clients on the ROS
graph. It records the client-reported service and exact string, session/sequence,
timestamp and preceding failed-delivery count. `client_call_async_returned`
means just that: it does **not** prove server receipt, response, completion,
flight success or the identity of either physical drone. The initial service
response and separate driver response topic are not captured by this first
entry point. Other clients, `cmd_vel`, driver startup/keepalive traffic and
direct SDK commands are outside its coverage.

Foxy's `Client.srv_name` preserves the name supplied to `create_client`, which
can be relative and does not prove a remapped endpoint. The record deliberately
sets `serviceResolutionVerified: false`; it never pretends that adding a slash
resolves a namespace/remap. Confirm the actual launch/remap alongside the record
when distinguishing multiple drones.

The report is an observation, **not** an approval, Permit, WOULD_ALLOW verdict,
configuration match or enforced Shadow gate. Empty capture is not evidence
that no drone commands occurred. Dropped final packets cannot be reported by a
later packet; even a gap-free log is not an authenticated complete trace.

## Install and prepare

Use your existing Linux Tello workspace and its existing ROS distribution.
The source README describes Foxy, while committed build artifacts mention
Python 3.10; neither establishes what your current machine runs. This helper
uses Python 3.8+ and Linux Unix-domain sockets, independently of ROS APIs.

Get this repository's source and set these two paths to your actual locations:

```sh
RLSOK_SOURCE=/absolute/path/to/rlsok
TELLO_PACKAGE=/absolute/path/to/tello_ws/src/tello_simple_teleop
PASSIVE="$RLSOK_SOURCE/experimental/composable-shadow/tello-passive"
```

Review `$PASSIVE/client-observation.patch`. It targets the public source above.
For that source, first check and then apply from the **package directory**:

```sh
cd "$TELLO_PACKAGE"
git apply --check "$PASSIVE/client-observation.patch"
cp "$PASSIVE/tello_observer.py" tello_simple_teleop/tello_observer.py
git apply "$PASSIVE/client-observation.patch"
```

If the check fails, keep your current code and provide its diff; do not force
the patch. Only the optional import and after-call recording point are needed.
With a normal non-symlink ROS install, rebuild only this package from the
workspace root and source its install:

```sh
colcon build --packages-select tello_simple_teleop
. install/setup.sh
```

No driver, flight-control layer, launch/remap or original command is replaced.
Removing the added lines and helper restores the original source; unset the
environment variable and restart the client to disable capture immediately
without changing source.

## Capture and read

Create a private local directory and start the separate receiver. It refuses
to overwrite existing sockets or output files.

```sh
CAPTURE_DIR=$(mktemp -d /tmp/rlsok-tello.XXXXXX)
export RLSOK_TELLO_SOCKET="$CAPTURE_DIR/events.sock"
python3 "$PASSIVE/tello_capture.py" --socket "$RLSOK_TELLO_SOCKET" \
  --output "$CAPTURE_DIR/observations.jsonl" --duration 300
```

In the terminal running your existing client, export the **same absolute**
`RLSOK_TELLO_SOCKET` value **before** starting that client. The module reads the
variable once when imported. Keep the capture directory private (0700).
The collector prints `Local recorder ready` when bound. It stops after the
duration or Ctrl+C and removes its own socket; the JSONL stays local.

Do not run the reference teleop `main()` as an installation check: it
automatically sends `takeoff` then `stop`. Do not start the real driver just
to test the recorder either: its own startup/keepalive logic sends commands.
First run the focused offline check below. Any later operation of the actual
Tellos uses your existing procedure; RLSOK's passivity does not stop the other
software from moving them.

```sh
cd "$PASSIVE"
python3 -m unittest -v test_passive.py
```

That test uses a fake client and local Unix datagrams, not a drone or a ROS
command transport. To inspect a saved report:

```sh
python3 -m json.tool --json-lines "$CAPTURE_DIR/observations.jsonl"
```

Python 3.8 does not have json.tool's `--json-lines`; use
`cat "$CAPTURE_DIR/observations.jsonl"` there. Each valid row includes
`rlsokCommandDispatch: false`, `rlsokCommandBlocked: false`,
`driverReceiptVerified: false`, `physicalResultVerified: false`.
These describe this observer's behavior, not all software on the machine.
A malformed packet is logged as an invalid observation, never interpreted as
a valid command. Local timestamps and source identity are self-reported.

## Information needed for the actual setup

Please confirm the current Ubuntu/ROS version, checkout commit plus local
changes, exact client/driver launch and namespace/remap, and whether this small
client-side recording point is acceptable. The public reference is already
known; there is no need to resend the repository. If two drones have different
namespaces or clients, include that selection so each record can be attributed
to the right software path. This still does not authenticate a physical drone.

ROS service discovery alone cannot provide request bodies. Current Jazzy
[service introspection](https://github.com/ros2/ros2_documentation/blob/jazzy/source/Tutorials/Demos/Service-Introspection.rst)
is another possible route, but it is disabled by default and requires
`CONTENTS` on an instrumented client/server to expose request data. This old
source does not configure it. We do not assume upgrading the ROS stack or
running `ros2 service echo` will make it available on the current setup.

Once the local record is available, selected configuration checks can be
scoped to the actual software path. No configuration or command policy is
invented here, and the existing generic velocity/trajectory profiles are not
presented as Tello service support.
