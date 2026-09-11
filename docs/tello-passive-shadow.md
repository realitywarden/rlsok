# Tello: local passive configuration review

This extends [the log-only observer](tello-passive-observation.md) into a complete
local configuration-review workflow. RLSOK copies a request **after** your
existing client's `call_async`, observes selected software facts, and compares
them with a baseline you explicitly approve. It sends no Tello commands and
cannot block, cancel, retry or authorize the original request.

`WOULD_ALLOW` means the selected observed configuration matches the baseline.
`WOULD_BLOCK` means it differs or the evidence is incomplete, inconsistent or
expired. These are **post-call reports**, not flight permission or command-safety
checks. Both leave the original service call independent of the result.

```text
existing client → original call_async → existing service/driver
                       ↓ after call_async returns
               copy exact cmd + client names/time
                       ↓ nonblocking local datagram, no reply channel
               separate recorder reads graph + selected files
                       ↓ compares with your approved baseline
               private report.json and report.md
```

## Install and select

Use the [v1.5.0-shadow.9 Linux x86_64 bundle](https://github.com/realitywarden/rlsok/releases/tag/v1.5.0-shadow.9).
Verify its published SHA256 and extract into a new directory. It includes Node
and the CLI; no Cloud account, payment or internet access is needed during
observation or review. Python 3.8+, your existing `rclpy`, `rosidl_runtime_py`
and installed `tello_msgs` are also needed. The real ROS experiment for this
release used **Jazzy**, not the customer's physical Tellos or confirmed Foxy.
For another architecture, build this tag with Node 22 using `npm ci --ignore-scripts`
and `npm run build`, then use `node dist/apps/cli/rlsok.js` as the CLI.

```sh
RLSOK_BUNDLE=/absolute/path/to/rlsok-shadow-evaluation-1.5.0-shadow.9
RLSOK="$RLSOK_BUNDLE/bin/rlsok"
PASSIVE="$RLSOK_BUNDLE/lib/rlsok/experimental/composable-shadow/tello-passive"
TELLO_PACKAGE=/absolute/path/to/tello_ws/src/tello_simple_teleop
```

The [pinned public client](https://github.com/RoboticsLabURJC/2022-tfg-guillermo-bernal/blob/8a66ad7e3d08b0e92877107b184dff45375f99d3/tello/tello_ws/src/tello_simple_teleop/tello_simple_teleop/tello_simple_teleop.py)
uses `tello_action` / `tello_msgs/srv/TelloAction`. The request is `string cmd`,
the response `uint8 rc`. Review the supplied patch, then apply it from the
package directory:

```sh
cd "$TELLO_PACKAGE"
git apply --check "$PASSIVE/client-observation.patch"
cp "$PASSIVE/tello_observer.py" tello_simple_teleop/tello_observer.py
git apply "$PASSIVE/client-observation.patch"
```

Do not force a failing patch. If the earlier logger-only patch is installed,
check and reverse that exact old patch first, then apply this one and replace
the helper; do not apply both. For a regular non-symlink install, run
`colcon build --packages-select tello_simple_teleop` from your workspace root,
then source `install/setup.sh` in both terminals. For source builds of RLSOK,
the helper folder is `<checkout>/experimental/composable-shadow/tello-passive`.

**Do not run the public `main()` as an installation test:** it automatically
sends `takeoff` and `stop`. Do not start its driver just to test this recorder;
the driver sends its own startup/keepalive traffic. Any actual drone operation
remains your existing procedure, independently of this passive observer.

```sh
CAPTURE_DIR=$(mktemp -d /tmp/rlsok-tello.XXXXXX)
export RLSOK_TELLO_SOCKET="$CAPTURE_DIR/events.sock"
cp "$RLSOK_BUNDLE/materials/tello-selection.example.json" "$CAPTURE_DIR/manifest.json"
```

Replace every example selection in `manifest.json` with the actual path:

- Fully qualified client node, server node and service endpoint, from the
  current launch/remap and read-only graph information.
- `clientServiceName`: the exact `self.cli.srv_name` string. Foxy can preserve
  relative `tello_action`; adding a slash does not resolve a remap. Events keep
  `serviceResolutionVerified: false`. Graph correlation is not DDS attribution.
- Actual selected file paths: patched **installed** client, observer helper,
  selected launch/configuration and relevant server source. Paths can be
  absolute or relative to the manifest. Select 1–32 files, each at most 2 MiB,
  with unique IDs. Review these files before approving a baseline.

The manifest, ROS distribution/RMW/domain, selected node/endpoint associations,
installed service definition and selected file hashes all participate in the
comparison. There must be exactly one selected client association and one
server. Multiple Tello associations on that client or servers on that endpoint
are ambiguous and cannot pass. For two drones, select separate unambiguous
software paths and private sockets; this does not authenticate physical identity.
File hashes do not establish which parameters the running driver loaded.

## Capture, explicitly approve, then compare

Source the same ROS environment in the recorder terminal. Export the **same
absolute** `RLSOK_TELLO_SOCKET` in the existing client terminal before importing
or starting that client. The helper reads it once on import.

If the selected client and server are already present, review the manifest and
selected files first, then capture a fresh baseline and approve it locally:

```sh
"$RLSOK" profile capture-tello --manifest "$CAPTURE_DIR/manifest.json" \
  --output "$CAPTURE_DIR/baseline.json"
EXPIRES=$(date -u -d '+1 hour' '+%Y-%m-%dT%H:%M:%SZ')
"$RLSOK" profile approve-tello --observation "$CAPTURE_DIR/baseline.json" \
  --actor your-name --expires-at "$EXPIRES" --output "$CAPTURE_DIR/approval.json"
```

A missing/ambiguous binding, differing two-pass read or snapshot older than
30 seconds is rejected. Expiry must be in the next day. Approval is a local
reviewed baseline, not a signed identity assertion or permission to fly.

For a short-lived client, start capture **without** `--approval`, before your
own normal client session. It records requests and fresh configuration without
manufacturing an approval or verdict:

```sh
"$RLSOK" profile watch-tello --manifest "$CAPTURE_DIR/manifest.json" \
  --socket "$RLSOK_TELLO_SOCKET" --output "$CAPTURE_DIR/first-capture" --duration 300
```

Wait for `Tello passive Shadow ready`. A complete, fresh
`first-capture/event-000001/observation.json` can be used as the approval input
from another terminal after reviewing the selection. Approve within 30 seconds;
replace stale or incomplete captures instead of editing timestamps. Discovery
may miss a very short-lived client; attaching mid-session marks the missing
sequence prefix. Such observations cannot form a valid baseline. Do not trigger
a flight just to obtain a passing snapshot.

Stop capture with Ctrl+C, then start comparison before the next existing client
session, using a new output directory:

```sh
"$RLSOK" profile watch-tello --manifest "$CAPTURE_DIR/manifest.json" \
  --approval "$CAPTURE_DIR/approval.json" --socket "$RLSOK_TELLO_SOCKET" \
  --output "$CAPTURE_DIR/shadow-session" --duration 300
```

Each event has `event.json`, fresh `observation.json`, `review/report.json` and
`review/report.md`. Reports contain the exact-request/selected-endpoint hash,
baseline and current hashes, reasons and changed groups. Different command
strings may both match configuration; this workflow does not judge them safe.

Malformed data or a recorder/ROS/file error produces `failure.json` with
`configurationDecisionAvailable: false`, never a passing verdict. `summary.json`
counts captures, decisions and failures. Files stay local with private
permissions; existing sockets, approval files and sessions are not overwritten.
Missing or stale evidence cannot establish a configuration match. The watcher
never silently refreshes approval after a change.

To re-review while the request and observation are still fresh:

```sh
"$RLSOK" profile review-tello --approval "$CAPTURE_DIR/approval.json" \
  --observation "$CAPTURE_DIR/shadow-session/event-000001/observation.json" \
  --event "$CAPTURE_DIR/shadow-session/event-000001/event.json" \
  --output "$CAPTURE_DIR/review-again"
```

Exit 0 means configuration match; 1 means `WOULD_BLOCK`; 2 means CLI error.
Re-review after 30 seconds correctly fails freshness. Keep the original report
as historical evidence. After intentional changes, review a fresh snapshot and
create a new approval explicitly.

## Stop and evidence limits

Ctrl+C stops the recorder and removes its socket. It sends no stop to the drone.
Unset `RLSOK_TELLO_SOCKET` and restart the client to disable observation. To
revert source, first check `git apply -R --check` with this exact patch, reverse
it, remove the helper and rebuild only the client package as appropriate.
The old `tello_capture.py` remains available for Python-only JSONL recording.

The helper preserves the original call/future/spin. Missing receivers, full
queues and recorder exceptions drop observations without retries or synchronous
disk writes in the inserted call. Serialization and the local syscall still
cost time; this is not a hard-real-time or zero-overhead guarantee. The separate
recorder creates an observer node for graph queries, not a command client,
publisher, parameter setter or drone transport.

Only the instrumented client's call-return boundary is covered. Server receipt,
response, completion, physical drone identity, flight success, other clients,
`cmd_vel`, direct SDK calls and driver keepalives are outside this record.
Two-pass reads are not atomic state at dispatch. Complete loss-free capture is
not established; final dropped packets may be invisible. Hashes detect ordinary
content changes, not malicious rewriting. This dedicated Tello review does not
manufacture an URDF, core ExecSpec, Permit or enforcement gate.

The included `ros_service_experiment.py` uses the actual patched public client
class and installed serializer against a unique localhost mock service; it
never executes the public `main()` or imports a Tello driver. Its results are
software evidence, not the customer's two-drone trial.

Remaining facts for the actual setup: current Ubuntu/ROS, checkout commit and
local changes, exact launch/namespace/remap, and acceptance of the small client
patch. The repository and existence of two Tellos are already known.
