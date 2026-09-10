# Your first local Shadow evaluation

Evaluation version: **v1.5.0-shadow.5**. Start with one command boundary in an isolated simulation. This guide covers the supplied local evaluator; Cloud-managed production authorization is a separate product path.

## What runs, and where

Install the [versioned evaluation bundle](fanuc-shadow-self-service.md) into a separate directory. It contains a Node runtime, the CLI, the read-only Python collector, source materials and docs. It does not install or replace a robot controller. A public source checkout or separate Git branch can be reviewed before use.

The collector joins your chosen ROS domain to inspect graph metadata and installed interface definitions. It reads only the fact files named in your profile. It creates no command publisher, message subscription, action client or control service request. DDS discovery traffic still occurs. Evaluation consumes a local message/Goal example; it does not intercept, replay or forward live teleoperation commands.

The separate `profile export-controller` command reads controller-manager metadata and controller parameters through three read-only ROS services. SO-101/TRIK [source workspaces](source-shadow-workspaces.md) require this export to compare the selected live software binding. It never activates controllers, changes parameters or sends goals; its snapshot does not authenticate hardware or prove future execution state.

Zero RLSOK dispatch does not isolate your robot from other nodes. Keep the first run in Gazebo or another isolated simulator, with no path to physical controllers. Existing control code, clamping, collision checks, limits and emergency stops retain their responsibilities.

## What you need to prepare

| Input | Why it is needed |
| --- | --- |
| ROS distribution, RMW and isolated domain | Identify the actual discovery environment |
| One command endpoint, type and receiving node/server | State the precise boundary to evaluate; a similarly named state topic or logger is not a substitute |
| Installed interface definitions and one example message/Goal | Check the selected fields, units and meaning |
| Robot description and relevant controller/configuration/calibration files | Record a reviewed baseline and observe changed file bytes |
| A trusted read-only export, if checking active controller state | Local files alone cannot prove which configuration is loaded |
| Operator name, approval expiry and freshness window | Make the local baseline and time limits explicit |

No repository credentials, remote-machine access or cloud account are required by this workflow. The operator keeps private files locally. Integration effort depends on whether the interface semantics and read-only sources already exist; there is no measured universal setup-time estimate. For a small collaboration, agree the exact boundary and one proposed change before estimating work.

## Configure a velocity topic or action

Source your ROS installation and interface workspace, then run:

```sh
rlsok profile discover --output catalog.json
```

The [interface guide](interface-onboarding.md) walks through selecting and mapping actual interfaces. The optional browser at <https://rlsok.com/connect> processes imported files in memory; it requires internet to load. The standalone CLI can inspect saved settings, generate a workspace, approve, capture and evaluate without internet once the bundle and ROS dependencies are installed. Download or transfer those prerequisites before going offline. No cloud login, evidence upload or billing call is required for these local `profile` commands.

For a `geometry_msgs/msg/Twist` topic, select the intended subscription node explicitly and declare its command frame. The standard fields are `/linear` and `/angular`, each containing finite `x`, `y`, `z` numbers in m/s and rad/s. `TwistStamped` uses `/twist/linear`, `/twist/angular`, a matching `/header/frame_id` and structurally valid `/header/stamp`. An unstamped message contains no frame ID, so its declared frame cannot be independently checked in that message. These are structural/identity checks; no velocity safety envelope is inferred.

The collector records the selected node name/namespace and subscription count, endpoint, message type and recursive installed definition fingerprint. Missing or duplicated subscriptions on that node block. Other listeners may exist. Discovery does not prove hardware identity, readiness, QoS delivery, actual controller behavior or all command paths. Topics other than Twist/TwistStamped, arbitrary services and proprietary transports need separate engineering; selecting a nearby adapter does not add support.

The existing trajectory, Cartesian and program adapters remain available with their documented limits. Topic-only profiles need no robot joint list: the evaluator binds the six named Twist command channels using the existing v2 command-mapping convention.

To configure locally from reviewed settings, without the website:

```sh
rlsok profile inspect-connection --input connection.json
rlsok profile configure --input connection.json --output my-local-evaluation
```

Copy actual source files into the locations listed in `REQUIRED-FILES.txt`. Saved settings contain configuration and example commands but not those file bytes. A catalog is a discovery snapshot, never the fresh observation used to pass a run.

## Compare one changed setup with the same approval

Use the exported workspace in a separate simulation branch/package. The operator chooses and reviews the changed copy: for example, one controller/configuration file change relevant to the selected boundary. Keep the known working setup available. Do not modify calibration or send commands to real hardware merely to demonstrate a negative result.

From that workspace, after reviewing `profile.json`, `proposals.json` and actual files, set `ACTOR` and a future RFC3339 `EXPIRES_AT`, then:

```sh
rlsok profile approve --profile profile.json --actor "$ACTOR" --expires-at "$EXPIRES_AT" --output approval.json
rlsok profile capture --profile profile.json --output baseline.json
```

Apply the single reviewed change in the isolated copy and capture again. Keep the approved profile, approval and proposed message unchanged:

```sh
rlsok profile capture --profile profile.json --output changed.json
rlsok profile compare --profile profile.json --approval approval.json --baseline baseline.json --changed changed.json --proposals proposals.json --output comparison
```

Both observations and any timestamped fact exports must still be within the approved freshness window (maximum five minutes). If the change takes longer, restore the baseline and plan a short repeat with a suitable reviewed window. Never rewrite capture timestamps or copy expected values into observations. Use new output names; evidence is not overwritten. Any change to the profile or expected baseline requires a new explicit approval and starts a different comparison.

Read `comparison/comparison.md`, then `baseline/report.md` and `changed/report.md` inside that directory. A useful configuration-change demonstration has a matching baseline and a changed result that identifies the intended changed fact. A block caused only by stale/missing data does not demonstrate the intended drift. The compare command returns success when it writes the comparison; the decisions are in those reports.

To inspect a single observation, use `profile shadow` with `--observation` and the same profile/approval/proposals. It writes `report.md`, `report.json`, and one assessment, executable-policy description and chained Evidence JSON per path. `shadow` returns 0 for WOULD_ALLOW and 2 for WOULD_BLOCK.

## Read the result correctly

**WOULD_ALLOW** means the declared profile, local approval, observed inputs and supplied message/Goal passed the listed checks. It does not mean a motion is physically safe, formally verified or permitted for execution. **WOULD_BLOCK** means at least one check failed; the report lists the reason.

Recorded data includes the approved configuration and its hash, observation/proposal hashes, boundary metadata, check outcomes, expected/observed configuration digests, timestamps and local operator identity. Assessments and evidence allow the supplied artifacts to be checked for consistency. Operator identity and local observations are self-attested; they do not authenticate a remote approver or prove active hardware state. The workspace also contains private example messages and source files. Nothing in this local flow publishes them automatically.

A DBC, calibration or controller file can be included as an exact-byte fact. A changed hash can show that the file differs from the approved baseline. This does not parse DBC semantics, detect every incompatible change, or prove a compiled/running system uses that file.

Keep evaluation private by default. Agree separately on public notes, repository changes, attribution, recording or a case study. Willingness to discuss or contribute is not permission to publish private material. A technical discussion or introduction alone is not trial use or acceptance.

## Current limits

This release supplies reusable tooling and instructions. An individual project's exact graph, custom interfaces, active configuration source and simulator behavior still need to be confirmed with its owner. Synthetic local checks are not customer-specific Gazebo, LeRobot, ROS hardware, or production validation. See [release validation](releases/v1.5.0-shadow.5.md).
