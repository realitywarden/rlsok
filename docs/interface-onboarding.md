# Configure and reuse your ROS 2 interface setup

Evaluation release: **v1.5.0-shadow.4**. This workflow discovers local graph
metadata, lets you map supported action or velocity-message meanings, and exports files the local
Shadow CLI consumes. It sends **zero controller commands**. It is not a new
stable Runtime release, Cloud approval, hardware attestation or motion permit.

## 1. Install separately and discover your actual interfaces

Install the versioned evaluation package using the first section of
[the installation guide](fanuc-shadow-self-service.md). Use its `bin/rlsok`,
or the `rlsok` shell function shown there. Source your ROS 2 installation and
your installed interface workspace. Use an isolated or simulated graph.

```sh
rlsok profile discover --output catalog.json
```

The command observes visible action servers and topic subscriptions for three seconds and records
the actual ROS distro, RMW implementation, domain, endpoint names, server-node
counts, subscriber identities/counts and installed message or Goal/Result/Feedback definition fingerprints. It creates
no action client, command publisher or service request. DDS discovery traffic
is still required. It does not subscribe to messages, discover service commands or make calls to
controller exports. Missing installed definitions remain visible as unavailable.
Conflicting graph identities/types fail discovery; endpoints with multiple
visible server nodes cannot be selected. Counts cannot distinguish multiple
same-name servers inside a single node.

Limits: 128 action endpoints and 128 topic endpoints, 4096 unambiguous graph node identities, a 1 MiB catalog,
512 message definitions and 8192 fields per installed interface. Narrow the
isolated ROS domain if these limits are exceeded. Output files must be new.
The catalog contains private names and definitions; handle it accordingly.

## 2. Choose and map interfaces in your browser

Open **<https://rlsok.com/connect>** and import `catalog.json`.
Choose the paths to evaluate and select the meaning for each path. The page
does not infer custom semantics from a message name. Confirm the conventions
from your actual interface documentation, map fields using the installed Goal
or Message field suggestions, and paste one actual example Goal or message object per path.
For velocity topics, explicitly select the intended receiving node; a logger is not necessarily the command boundary. Duplicate subscriptions on that node are rejected.

| Adapter | Accepted meaning and layout | Limits |
| --- | --- | --- |
| Joint trajectory | `control_msgs/action/FollowJointTrajectory`; mapped joint-name and point arrays; exact robot joint order; radians; increasing time | Point fields remain standard ROS `positions`, optional vectors and `time_from_start`; custom action types or point layouts are unsupported |
| Absolute Cartesian | XYZ meters; normalized quaternion X/Y/Z/W; frame string | Explicit component pointers support renamed/nested fields; no Euler or unit conversion |
| Relative Cartesian | XYZ millimeters; W/P/R degrees; positive mm/s velocity; frame string | Explicit per-component bounds and field mappings; never treated as an absolute pose |
| Velocity topic | `geometry_msgs/msg/Twist` or `TwistStamped`; fixed linear/angular XYZ in m/s and rad/s; explicit receiver and command frame | Checks finite vectors, plus frame ID and timestamp structure for stamped messages; no velocity safety bounds or live forwarding |
| TP program | Exact string selector; explicit program allowlist | Does not inspect program contents or side effects |

Pointers use RFC 6901 syntax relative to the Goal or Message object, for example
`/target/pose/position/x`. Suggestions stop at 512 entries / 16 levels and use
index `0` for sequences. A manually entered pointer is checked against the full
installed definition. Arrays can use numeric component indices. The validator
checks that each pointer exists and that mapped example values satisfy the
selected adapter; it does not certify full ROS serialization or extra fields.

Different endpoint names and compatible field layouts reuse these adapters.
Unknown protocols, custom trajectory shapes, unsupported rotation conventions,
missing frame fields and incompatible semantics need separate engineering;
selecting a similar-looking adapter does not make them compatible.

## 3. Supply your real configuration baseline

Enter your configuration/device IDs, robot model, controller implementation,
joint order (actions only) and observation freshness window. Choose the real robot-description
file. Add the relevant calibration/configuration files or timestamped JSON
exports. Files are limited to 8 MiB each and 24 MiB total in the browser.

- A file fact binds the exact selected bytes by SHA-256.
- A JSON fact selects a nonempty string through an explicit pointer. Its source
  must contain the read-only exporter's actual `observedAt` timestamp. Numeric
  values require a suitable string/digest export; the wizard does not coerce them.
- Selecting a replacement file explicitly changes the proposed expected baseline.
  Every listed fact is checked on every selected path in browser-created setups.
- A local URDF or calibration hash proves file content, not that the file is
  active on a controller. Actual tool/frame selection and complete active
  parameters need a trusted read-only exporter. The wizard does not create one.

For supported active-controller export normalization, the existing
`rlsok profile fingerprint-controller` command remains available; see
[the FANUC guide](fanuc-shadow-self-service.md). Never copy expected values into
an observation or replace stale timestamps merely to get a passing decision.

## 4. Export and continue locally

Review runs the same portable profile/goal/onboarding validators distributed in
the evaluation package. It binds selected paths to the catalog fingerprints,
requires an unambiguous visible server node or selected topic subscription, verifies required fields and goal
coverage, and checks the robot description is a declared fact for every path.
It does not use the catalog as a fresh observation or approve robot motion.

**Download workspace ZIP** includes `profile.json`, `proposals.json`,
`catalog.json`, `connection.json`, the selected files under `files/`, and
`README.md`. Extract into a new private directory. With the evaluation CLI
available in your shell, run from that directory:

```sh
rlsok profile inspect-connection --input connection.json
rlsok profile inspect --profile profile.json
```

Review the generated profile, goals and actual fact files. Set `ACTOR` to your
operator name and `EXPIRES_AT` to a future RFC3339 timestamp, then run:

```sh
rlsok profile approve --profile profile.json --actor "$ACTOR" --expires-at "$EXPIRES_AT" --output approval.json
rlsok profile capture --profile profile.json --output observation.json
rlsok profile shadow --profile profile.json --approval approval.json --observation observation.json --proposals proposals.json --output report
```

Capture and evaluate promptly within the configured freshness window. Refresh
stale controller exports through the actual read-only source. Use new output
names for subsequent captures, approvals and reports; the CLI does not overwrite
evidence. Any profile, mapping, expected baseline, endpoint or allowlist change
requires a new local approval. Local operator names are not authenticated by
Cloud. Read the human-readable `report/report.md` and inspect individual checks in `report/report.json` and follow the existing
Evidence verification procedure in [the full guide](composable-shadow.md).

**Save reusable settings** writes `connection.json`, including private Goal data,
definitions and expected values, but not fact file bytes. Import it into the
wizard to reuse selections and mappings. Reconfirm interface meanings and
reselect actual files before exporting a complete workspace. Importing a new
catalog starts a new setup; rediscovery alone does not certify changed semantics.

The local alternative creates configuration files from saved settings:

```sh
rlsok profile configure --input connection.json --output new-workspace
```

This writes a new directory, validates configuration and mapped goals, and lists
required source paths in `REQUIRED-FILES.txt`. Copy your actual files to those
relative paths before capture. It does not invent missing files or observations.

## Privacy, versioning and validation status

The wizard processes file bytes in browser memory, uses no upload endpoint or
browser persistence, and excludes `/connect` from site analytics/attribution.
Normal page delivery requests still reach the website. Both downloaded settings
and workspaces contain private information. Store them securely. Closing the
tab clears working data; keep downloaded settings if you need to resume.

The website vendors the portable Runtime validators with source-file checksums
and a versioned source manifest. Profile schema version remains 1; the new catalog
and connection contracts are also version 1. The Linux evaluation and npm
tarball include the collector, validators, generated schemas and this guide.
Stable Runtime remains v1.4.5; Cloud/API/schema and Windows updates are separate.

See [the first-evaluation guide](local-shadow-first-evaluation.md) for required inputs, offline use, result meaning and a same-approval before/after comparison. Validation scope is recorded in [the release notes](releases/v1.5.0-shadow.4.md). No private customer integration or physical robot validation is claimed.
