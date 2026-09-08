# Composable ROS 2 Shadow evaluations

For required inputs, offline use, standard velocity topics and readable before/after reports, start with [your first local evaluation](local-shadow-first-evaluation.md).

One runtime combines reusable goal adapters, action endpoints, and selected
configuration checks. Each operator supplies a profile rather than a private
fork. The first example covers the reported FANUC M-10iA / R-30iA Mate,
ROS 2 Humble, fanucpy-based bridge scenario. It evaluates three declared paths:
FollowJointTrajectory, an absolute Cartesian action, and an allowlisted TP
program action. No command, goal, cancel, stop, or hold is sent.

This is **local, self-attested Shadow evaluation**. It is not official FANUC
support, a physical-robot validation, or the existing Hosted UR5e walkthrough.
Custom action package names, fields, interface hashes, joint names, controller
software and calibration in the template are synthetic. Replace them with the
installed definitions and independently reviewed values before evaluating an
actual isolated graph. Humble/Ubuntu 22.04 is the intended graph environment;
the collector also uses the corresponding common ROS 2 graph APIs on Jazzy.

For the complete first evaluation, supported schemas and Hosted data inventory,
see [FANUC/Humble integration](fanuc-humble-integration.md). The isolated
simulation can be completed with example data; private site files are only
needed when moving to the operator's deployed graph.

## Try the complete synthetic example

Install the [v1.5.0-shadow.1 evaluation package](fanuc-shadow-self-service.md)
to start without Node/npm or a source build. Its bundled CLI can run
`rlsok profile demo --output ./fanuc-demo`. For a source checkout:

```sh
npm ci
npm run build
node dist/apps/cli/rlsok.js profile demo --output ./fanuc-demo
```

The output contains a profile, sample sources, goal proposals, a local baseline,
and two reports. All three paths WOULD_ALLOW with matching observations. A
changed calibration produces WOULD_BLOCK on all three dependent paths. Both
reports record zero dispatch. The `fixture/v1` collector label remains visible.
This command requires Node 22.12+ but does not require ROS or a robot.

## Evaluate your isolated or simulated graph

After installing a build containing this feature, use `rlsok` below (or replace
it with `node /absolute/path/to/dist/apps/cli/rlsok.js` for a source checkout).

1. Create a workspace: `rlsok profile init --template fanuc-humble --output ./my-cell`.
   `ros2-trajectory` creates a smaller composition using the same evaluator.
   `fanucpy-public-humble` uses the public bridge's relative JogCartesian and
   RunProgram field names; it does not replace the email's absolute action.
   Its source values, definition fingerprints and bounds still need review.
2. Source `/opt/ros/humble/setup.bash` and the workspace containing your custom
   action packages. Set the intended isolated `ROS_DOMAIN_ID`. Install the
   normal Humble `rclpy`, `rosidl_runtime_py`, `rosidl_parser` and action packages.
3. Edit `profile.json`: actual ROS distribution, RMW, domain, robot identifiers,
   URDF digest, joint order, action names/types, goal field pointers and checks.
   Run `rlsok profile describe-interface --type your_package/action/YourAction`
   for each type, including FollowJointTrajectory, and review its type tree.
   Put the returned `interfaceSha256` in that path. The hash binds the locally installed ordered
   Goal/Result/Feedback field tree, nested types and container bounds using
   `rosidl-action-fields-tree/v1`; it is not just a hash of the action name.
   The ROS graph reports the remote type name, not its definition fingerprint;
   this does not authenticate remote definitions or firmware. Deploy matching
   interface packages and verify their provenance separately.
4. Provide real read-only fact sources under the profile directory. A
   `file_sha256` fact hashes local bytes. A `json_value` fact reads a string at
   an RFC 6901 pointer from a JSON export containing its original `observedAt`.
   The collector preserves the export timestamp, so an old export stays old.
   Exporters must read active controller configuration; copied expected values
   do not establish an observation. File sources cannot escape the workspace
   or use symlinks, and reads are size bounded.
5. Review and approve the expected profile, independently of the current
   observation. Do not update expected values merely to make a failure pass:

```sh
rlsok profile inspect --profile ./my-cell/profile.json
rlsok profile approve --profile ./my-cell/profile.json --actor reviewer \
  --expires-at 2026-09-06T00:00:00Z --output ./my-cell/approval.json
```

Choose a future expiry appropriate for the test. This creates only an explicit
local Shadow baseline. Changing any profile field requires a new baseline.
It never grants a production execution permit or authenticates the reviewer.

6. Capture a fresh read-only graph observation and evaluate one candidate for
   every declared execution path:

```sh
rlsok profile capture --profile ./my-cell/profile.json --output ./my-cell/observation.json
rlsok profile shadow --profile ./my-cell/profile.json --approval ./my-cell/approval.json \
  --observation ./my-cell/observation.json --proposals ./my-cell/proposals.json \
  --output ./my-cell/run-001
```

Use a new output file/directory per run; commands never overwrite previous
evidence. WOULD_BLOCK exits 2 and still writes a report; malformed input exits
2 without producing a success report. Capture failures produce no observation.
The collector only inspects graph metadata and fact sources. It creates no
action clients and does not invoke fanucpy or control the robot.

## Compose the checks you need

| Module | Inputs and behavior |
| --- | --- |
| `joint_trajectory` | JSON pointers to `joint_names` and `points`; checks exact joint order, finite vectors and increasing ROS durations. Requires FollowJointTrajectory. |
| `cartesian_pose` | Pointers to position, normalized quaternion and frame; accepts arrays or ROS `x/y/z` and `x/y/z/w` objects. Alternatively map each scalar component with ordered pointers. Absolute position is in meters. |
| `cartesian_delta` | Ordered pointers to relative millimeter/WPR-degree offsets, positive mm/s velocity and frame; checks declared axis and velocity bounds. |
| `tp_program` | Pointer to a program selector and a strict list of allowed program names. Produces a `program` contract with no physical units. |
| Fact selection | Each path's `checks` selects shared facts. Missing, stale, future, wrong-source or changed facts block the dependent path. |
| Definition binding | Endpoint, remote action type name, local recursive definition hash and one visible action-server node must match. RMW, domain and ROS distribution are approval-bearing. |

For FANUC, the example checks controller software, bridge revision, calibration,
URDF, selected tool configuration and frame configuration on all three paths.
Tool/frame exporters should hash **both the selected identifier and complete
active parameters**; a tool number alone cannot detect a changed TCP. The
calibration file must be the one actually used by the vision/bridge process;
hashing an unrelated local copy cannot establish the active eye-to-hand binding.
ROS graph discovery alone cannot read the FANUC controller's tool/frame state.

Reuse the same modules for another robot by editing the profile and proposals.
A different action type can reuse Cartesian/program adapters when its data can
be represented by the declared pointers/envelope. An incompatible semantic
contract needs another reusable adapter. Do not label it supported merely by
renaming an action. Goal checks do not validate every arbitrary custom field,
ROS serialization, kinematics, collision constraints or physical motion safety.

The evaluation requires proposals/observations for all **declared** paths.
Omitting one custom path prevents a complete pass. Unlisted actions, other
network interfaces and bypasses are outside coverage. Graph server counts are
counts of visible server nodes; Humble cannot prove separate same-name server
instances within one node through this graph API. Repeating an evaluation is
allowed in Shadow: the CLI issues no reusable execution authorization.

## Evidence and Hosted Cloud data

Each path uses the existing ExecutionConfiguration v2 and ShadowExecutionGate,
and emits its release plus standard hash-chained Evidence. `report.json`
contains path outcomes, failed checks, profile/configuration hashes, interface
metadata, timestamps and the local input assessment bound by testReportSha256.
It is an input-check assessment, not a certification or independent test result.
Each path's `.assessment.json` is also exported separately. Use
`rlsok profile verify-assessment --assessment <file> --release <release.json>`
to compare its hash with that release's `testReportSha256`, then verify the
Evidence/release pair. Exact failed checks such as `fact_mismatch:calibration`
are retained in the assessment even when the gate reports a configuration mismatch.
Raw goals are replaced by hashes in exported Evidence; raw observations and
goals remain in your local input files. Identifiers, paths, joint names and
reviewer names can still appear in reports. Verify each bundle, for example:

```sh
rlsok verify-evidence ./my-cell/run-001/cartesian.evidence.json \
  --release ./my-cell/run-001/cartesian.release.json
```

This verifies consistency with the supplied release, not authenticated source
provenance. Protect the local profile, baseline, source exports and evidence.

**The composable profile CLI uploads nothing to Hosted Shadow.** Its reports
say `cloudUploaded: false`. Current Hosted reference Shadow runs a fixed
server-side example. The existing runtime Cloud evidence API has a per-action
identity/permit contract; there is no composable multi-action upload adapter in
this feature, and these locally generated approvals are not Cloud approvals.
Current Cloud paths can store an ExecSpec, decision/evidence bundle, action and
configuration hashes, robot/controller identifiers, timestamps, permit state
and audit chain. Artifact draft metadata includes filename, type, size and
SHA256; separate upload interfaces can store file contents. Thus the complete
Cloud product must not be described as storing metadata only.

## Details still required for a real FANUC integration

Confirm the deployed revision and obtain the email's absolute action definition
and payload example, current controller/bridge versions, selected tool/frame
exports, active calibration/URDF bytes, intended TP allowlist and ROS/RMW/domain
values. The public snapshot below already establishes trajectory and program
interfaces and example joint names; they should not be requested as unknown
unless his deployed version differs. Keep the first evaluation isolated and
zero-dispatch, then review the resulting evidence with the operator.

## Public FANUC interface snapshot and relative Cartesian module

The email describes a custom **absolute Cartesian** action. The author's
[public fanucpy_ros2 snapshot](https://github.com/Ureed-Hussain/fanucpy_ros2/tree/ed04e2ca0eb7781168a08688c682fb314c85ba59)
instead declares **relative JogCartesian**. These may describe different
versions or interfaces; the public repository does not establish the exact
interface used by the email sender. Neither public branch inspected (`main`
and the dependency-update branch) nor that snapshot's README exposed a separate
absolute Cartesian action. `/fanuc/cartesian_pose` is a published state topic,
not an alias for an absolute action.

The public interfaces and configuration establish these names:

| Endpoint | Type and goal fields |
| --- | --- |
| `/fanuc_arm_controller/follow_joint_trajectory` | `control_msgs/action/FollowJointTrajectory`; `trajectory.joint_names`, `trajectory.points` |
| `/fanuc/jog_cartesian` | `fanucpy_ros2_interfaces/action/JogCartesian`; `header`, `delta_x_mm`, `delta_y_mm`, `delta_z_mm`, `delta_w_deg`, `delta_p_deg`, `delta_r_deg`, `velocity_mm_s` |
| `/fanuc/run_program` | `fanucpy_ros2_interfaces/action/RunProgram`; `program_name` |

Sources: [JogCartesian.action](https://github.com/Ureed-Hussain/fanucpy_ros2/blob/ed04e2ca0eb7781168a08688c682fb314c85ba59/src/fanucpy_ros2_interfaces/action/JogCartesian.action),
[RunProgram.action](https://github.com/Ureed-Hussain/fanucpy_ros2/blob/ed04e2ca0eb7781168a08688c682fb314c85ba59/src/fanucpy_ros2_interfaces/action/RunProgram.action),
and [interface documentation](https://github.com/Ureed-Hussain/fanucpy_ros2/blob/ed04e2ca0eb7781168a08688c682fb314c85ba59/docs/interfaces.md).

The reusable `cartesian_delta` module reads three translation pointers in
millimetres, three W/P/R rotation pointers in degrees, a velocity pointer in
mm/s and a frame pointer. All values must be finite; every translation and
rotation axis must stay within the declared bounds. Velocity must be explicitly
positive and within its bound, and the frame must match. It emits a distinct
six-dimensional `cartesian_delta` contract. It does not convert relative deltas
into an absolute pose or replace the separate `cartesian_pose` module. Unlike
the upstream driver's zero-velocity default selection, this Shadow module
rejects zero velocity so it does not assume an unobserved driver default.

For the public goal shape, configure translation pointers
`/delta_x_mm`, `/delta_y_mm`, `/delta_z_mm`; rotation pointers `/delta_w_deg`,
`/delta_p_deg`, `/delta_r_deg`; velocity `/velocity_mm_s`; frame
`/header/frame_id`. The `tp_program` module can use `/program_name`.
Changing these pointers, bounds or other profile fields requires new local
approval. The default three-path fixture remains a synthetic absolute-pose example.

The [checked-in M-10iA configuration](https://github.com/Ureed-Hussain/fanucpy_ros2/blob/ed04e2ca0eb7781168a08688c682fb314c85ba59/src/fanucpy_ros2_bringup/config/fanuc_m10ia.yaml)
lists `joint_1` through `joint_6`, frame label `fanuc_world`, translation bound
50 mm, rotation bound 2 degrees, default jog velocity 25 mm/s and a configured
velocity ceiling 2000 mm/s. These are published defaults, not verified site
limits. Motion and TP execution default to disabled; the TP allowlist's empty
sentinel permits nothing. The trajectory bridge defaults to stopping at each
waypoint and does not reproduce `time_from_start` timing.

Actual site calibration, active tool/frame parameters, deployed controller and
bridge versions, selected TP allowlist, recursive interface hashes and runtime
observations still need to be supplied and confirmed. In particular, confirm
the email's absolute Cartesian definition independently; the public relative
interface must not be substituted for it. No hardware or Cloud integration is
claimed by this source inspection or local adapter.
