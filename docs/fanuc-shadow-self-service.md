# FANUC / Humble: install, configure and evaluate three paths

Evaluation release: **v1.5.0-shadow.4**. Target: Ubuntu 22.04 x86_64 with
ROS 2 Humble and an isolated/simulated graph. This is a local, self-attested,
zero-dispatch prerelease, with a bundled Node runtime. No account, Cloud
upload, physical controller or global runtime upgrade is needed. This exact
release was built and reviewed; **installation, Humble, private action
definitions and physical FANUC operation have not been validated**. Prior
Jazzy results do not establish validation of this release.

The public stable installation remains runtime v1.4.5. Use the pinned
[evaluation release](https://github.com/realitywarden/rlsok/releases/tag/v1.5.0-shadow.4)
for the composable functionality. RLSOK is not a certified functional-safety
product. This evaluation checks declared inputs and configuration, not motion
safety, kinematics, collisions or every controller command path.

## 1. Install the evaluation in your own directory

Download the installer and its checksum into a new directory:

```sh
mkdir rlsok-shadow-download && cd rlsok-shadow-download
BASE=https://github.com/realitywarden/rlsok/releases/download/v1.5.0-shadow.4
curl -fLO "$BASE/install-shadow.sh"
curl -fLO "$BASE/install-shadow.sh.sha256"
sha256sum -c install-shadow.sh.sha256
sh install-shadow.sh "$HOME/rlsok-shadow-1.5.0-shadow.4"
EVAL="$HOME/rlsok-shadow-1.5.0-shadow.4"
rlsok() { "$EVAL/bin/rlsok" "$@"; }
rlsok profile help
```

The installer verifies the Linux archive checksum and extracts to a **new**
directory; it does not register services, change the production CLI, install
Python packages or connect to ROS. It accepts Ubuntu 22.04/24.04, which is a
target-environment rule, not a test result. Reopen the shell by setting `EVAL`
and the function again. To remove it, delete this evaluation directory after
keeping your separate workspaces and Evidence. No rollback of Cloud authority
is involved. For offline transfer, download the archive and `.sha256` from
the release, verify with `sha256sum -c`, and extract with `tar -xzf`.

The release includes `evaluation-release.json`, checksums, SBOM, dependency
licenses, the npm package and `rlsok-source-1.5.0-shadow.4.tar.gz`.
`SOURCE_COMMIT` and `BUILD-MANIFEST.json` inside the Linux archive identify
the source and packaging scope. GitHub's release asset digests provide another
checksum comparison. The evaluation launcher exposes only profile operations,
Evidence verification and version information.

## 2. Choose browser configuration or manual templates

The [interface configuration wizard](https://rlsok.com/connect) can import a
read-only catalog from `rlsok profile discover --output catalog.json`, map your
fields and export a ready workspace containing your actual files. Follow
[the interface onboarding guide](interface-onboarding.md) for that workflow.
It uses the same profile and goal validation rules as the CLI. The template
workflow below remains available for manual configuration.

### Manual templates: learn the format and collect interfaces

An optional offline example requires no ROS and uses visibly synthetic data:

```sh
rlsok profile demo --output "$HOME/fanuc-synthetic-example"
```

It illustrates the report format. It does **not** discover your graph or prove
Humble support. To evaluate your graph, initialize a different workspace:

```sh
CELL="$HOME/fanuc-isolated-cell"
rlsok profile init --template fanuc-humble --output "$CELL"
mkdir "$CELL/intake"
cp "$EVAL/materials/site-intake.template.json" "$CELL/intake/site-intake.json"
cp "$EVAL/materials/active-controller-export.template.json" "$CELL/intake/active-controller-export.json"
rlsok profile schema --output "$CELL/schemas"
source /opt/ros/humble/setup.bash
source /absolute/path/to/your-interface-workspace/install/setup.bash
export ROS_DOMAIN_ID=42
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp
```

Choose a domain reserved for the isolated graph; do not connect a hardware
driver. Source the **actually deployed interface version**. The collector needs
the standard Humble `rclpy`, `rosidl_runtime_py`, `rosidl_parser`,
`control_msgs` and custom interface packages. It does not install them.

Record `ros2 action list -t`, actual RMW/domain, OS, bridge and interface
versions in the intake file. Export each installed type (replace both custom
type names with your actual values):

```sh
rlsok profile describe-interface --type control_msgs/action/FollowJointTrajectory > "$CELL/intake/trajectory.interface.json"
rlsok profile describe-interface --type YOUR_PACKAGE/action/YOUR_ABSOLUTE_ACTION > "$CELL/intake/cartesian.interface.json"
rlsok profile describe-interface --type YOUR_PACKAGE/action/YOUR_TP_ACTION > "$CELL/intake/tp.interface.json"
```

If a command fails, keep the error and correct the missing package/type; an
empty redirected file is not an interface export. Include the absolute
`.action` source and one redacted complete goal per path. The recursive
Goal/Result/Feedback field tree and `interfaceSha256` bind **local installed
definitions**; the remote graph advertises a type name, not authenticated
schema or firmware. Confirm matching remote package provenance independently.

The example `AbsoluteCartesian` action is synthetic. The public bridge's
relative `JogCartesian` is a different contract. Confirm absolute semantics,
position units, orientation and frame conventions. `cartesian_pose` currently
requires meters and a normalized quaternion; W/P/R, millimeters or incompatible
custom fields require an explicit adapter change. Do not rename or silently
convert a relative action to make the absolute path appear supported.

## 3. Export actual facts and fill the profile

An exporter or operator must read active controller state using an existing
**read-only** facility. Complete `active-controller-export.json` from that
observation: its original timezone-aware `observedAt`, source/export method,
controller software, bridge revision, and both `tool` and `frame` objects.
Each object must contain `selectedId` and a nonempty `parameters` object with
**all** active values, units and orientation/convention labels. Set
`activeStateReadOnly: true` only when this describes the export. Blank template
fields are intentionally rejected. RLSOK cannot infer missing controller
parameters or authenticate this declaration.

```sh
rlsok profile fingerprint-controller \
  --input "$CELL/intake/active-controller-export.json" \
  --output "$CELL/controller-state-baseline.json"
```

This command reads a local export without ROS or controller connections. It
does not read expected profile values or refresh the observation timestamp.
It hashes the whole selected-ID/parameters object using
`selected-state-python-json/v1`: Python JSON, sorted keys, ASCII escaping,
compact separators, finite numbers, SHA-256 over UTF-8. Use the same exporter
and helper for baseline and changed runs; integer/float representation is part
of this encoding. It validates structure, not whether every active parameter
was honestly included.

Place read-only exports of the calibration and URDF actually consumed by the
vision/bridge into the workspace, keeping their active source/consumer and
export method in `site-intake.json`. Hash the bytes with `sha256sum`. A copied
unrelated file does not prove active calibration. The collector refuses fact
paths that escape the workspace or use symlinks; use real exported files.

Now edit `profile.json` and `proposals.json`:

| Field | Required operator input |
| --- | --- |
| `environment`, `robot`, `jointOrder` | Actual ROS/RMW/domain, robot/controller identity, URDF SHA-256 and exact joint order. |
| Three `paths` | Actual endpoints, type names and recursive interface hashes; preserve trajectory, absolute Cartesian and TP paths. |
| Adapter `fields` | JSON pointers into each actual goal, including absolute pose frame; see the schema manifest for units. |
| TP `allowedPrograms` | Independently reviewed exact names, with deployed program versions retained in intake; the selector alone does not fingerprint program contents. |
| `facts` | Expected reviewed values; calibration/URDF file paths; JSON paths point to `controller-state-baseline.json`. |
| Every path's `checks` | Keep controller software, tool, frame, calibration, URDF and bridge revision on all three paths. |
| `proposals` | Exactly one complete candidate goal for each declared path; these are local input objects and are never sent. |

Set `robot.urdfSha256` and the `robot_description` fact to the same reviewed
URDF digest. Do not feed `fixture-observation.json` into your graph evaluation.

## 4. Independent review, local approval and baseline

Have a reviewer other than the profile author check the actual definitions,
semantics, expected-state source, all three paths and six checks. Transfer the
profile through your normal trusted review process. The local CLI records an
actor string but **does not authenticate identity or enforce separation of
duties**. This is a procedural independent review, not Hosted approval or a
production Permit. The reviewer runs:

```sh
rlsok profile inspect --profile "$CELL/profile.json"
rlsok profile approve --profile "$CELL/profile.json" --actor REVIEWER_NAME \
  --expires-at FUTURE_RFC3339_TIME --output "$CELL/approval.json"
```

Replace placeholders, for example with a suitable UTC expiry ending in `Z`.
Any profile edit after this approval requires a new approval. Do not update
expected values just to make an observed failure pass.

While the isolated servers advertise all three action endpoints, capture and
evaluate using fresh actual-state exports. The default maximum observation
age is five minutes, including the original controller export timestamp.
Refresh an export by observing active state again, never by retimestamping it.
If a new JSON filename is needed after approval, retain the original approved
filename for the active input, and archive its previous contents separately.

```sh
rlsok profile capture --profile "$CELL/profile.json" --output "$CELL/baseline-observation.json"
rlsok profile shadow --profile "$CELL/profile.json" --approval "$CELL/approval.json" \
  --observation "$CELL/baseline-observation.json" --proposals "$CELL/proposals.json" \
  --output "$CELL/baseline"
```

Expect exit 0 and **three** `WOULD_ALLOW` outcomes only when all observed
bindings match the independently reviewed expectations. A missing server may
stop capture entirely; a missing/changed input blocks or errors. Neither is a
complete pass. Commands preserve previous outputs; use new names per run.

## 5. Change the isolated calibration under the same approval

Keep profile, approval and goals unchanged. In the isolated/simulated system,
change the calibration actually used by the simulated vision/bridge and export
its new bytes to the **same fact path**. Archive the old bytes first. Refresh
other active exports if needed. Merely editing a detached proxy file proves
only file-mismatch detection; state that narrower scope in the returned result.

```sh
rlsok profile capture --profile "$CELL/profile.json" --output "$CELL/changed-observation.json"
if rlsok profile shadow --profile "$CELL/profile.json" --approval "$CELL/approval.json" \
  --observation "$CELL/changed-observation.json" --proposals "$CELL/proposals.json" \
  --output "$CELL/changed-calibration"; then
  echo 'Unexpected allow: inspect every calibration dependency before accepting this run.'
else
  code=$?
  echo "Shadow exit: $code (2 is expected for a recorded block; also check the report exists)."
fi
```

Expect three `WOULD_BLOCK` outcomes, each with a failed
`fact.calibration.value` check and `fact_mismatch:calibration` in the report
and that path's `.assessment.json`. Other failures must be explained too;
an expired approval by itself is not successful calibration-drift evidence.

## 6. Verify and interpret Evidence; return one material set

For each run and path, retain `.release.json`, `.evidence.json`,
`.assessment.json` and the common `report.json`. For example:

```sh
for run in baseline changed-calibration; do
  for action in trajectory cartesian tp_program; do
    rlsok verify-evidence "$CELL/$run/$action.evidence.json" \
      --release "$CELL/$run/$action.release.json"
    rlsok profile verify-assessment --assessment "$CELL/$run/$action.assessment.json" \
      --release "$CELL/$run/$action.release.json"
  done
done
```

Use your path IDs if renamed. Evidence verification checks the hash chain and
release binding. Assessment verification checks the detailed input assessment
against the release's `testReportSha256`; this is where the exact calibration
failure is retained even when the gate's main reason is a configuration mismatch.
Neither command authenticates the local reviewer/exporter or proves physical
state. `LOCAL_SELF_ATTESTED` and `declared_paths_only` remain visible.

The CLI has no dispatcher/action client and the collector only inspects graph
metadata/files. Reports record zero controller goals and no hardware signal.
Those software counters do not measure other processes. For acceptance, attach
isolated-server or independent observer records showing **0 goals, cancels,
stop, hold, TP calls and other controller commands** throughout both runs.
Do not issue `ros2 action send_goal`, cancel requests or fanucpy commands.
The optional source Humble kit under `experimental/composable-shadow` supplies
rejecting simulated servers and observer counters; its automated Humble run
has not been completed by RLSOK for this release.

Return one locally reviewed material set through an agreed channel:

1. Completed intake file; installed action exports; private absolute `.action`
   and three redacted goals with units/semantics; workspace/bridge versions.
2. Profile and approval, expected-state review, active tool/frame export method,
   calibration/URDF consumer provenance and intended TP program versions.
3. Baseline and changed observations, both complete result directories,
   observer counters, runtime version/source, and any failed-command stderr.

Remove secrets before sharing and review operational identifiers. Do not change
files inside a hash-bound Evidence set while calling its original hashes valid;
provide a separately labeled redacted copy if necessary. Unknown private
definitions or export methods block only the corresponding site adaptation and
customer acceptance. Installation, offline learning and intake can start now.

## Data boundary

**These profile commands make no Hosted Cloud request.** Inputs, complete goals,
controller exports and calibration/URDF bytes remain on the local machine.
Reports contain `cloudUploaded: false`, hashes, identifiers, endpoint/interface
metadata, checks, release specifications and Evidence. Profile paths, joint
names, TP allowlists, reviewer names and configuration information may appear;
the output is not anonymous. The installer downloads from GitHub, and ROS
capture joins your selected local DDS graph; these are separate from Cloud upload.

The Hosted reference walkthrough is a separate fixed server-side example.
Its reviewed Cloud source (`08b6375f2200f0f5b18c03386f3829849645883e`) stores
organization/principal linkage, generated releases/ExecSpecs, decisions,
runtime/reference Evidence, action hashes, permit/zero-dispatch flags,
hash-chain sequence and timestamps, and audit events. The artifact workflow
can also store **uploaded contents**, in addition to filename/type/size/hash
and associated release metadata. Do not describe the whole Hosted service as
metadata-only. No three-path Hosted upload adapter is required by this guide.
These are source-level findings, not confirmation of a particular deployed
revision, retention period or deletion SLA; those operational terms remain
to be confirmed if Hosted evaluation is selected. See the inventory in
[the integration guide](https://github.com/realitywarden/rlsok/blob/v1.5.0-shadow.4/docs/fanuc-humble-integration.md).
