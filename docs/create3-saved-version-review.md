# Compare two saved Create 3 version reports

This Local Check 1.5.7 command compares an operator-selected reference with a
second saved `version` output. It does not connect to a robot, run SSH, ask for
credentials, start ROS, or send a robot command. Older 1.5.6 packages do not
include this command.

Obtain each text file through your existing authorized maintenance process.
RLSOK does not establish whether that process is available on your firmware,
authenticate the origin, or verify when the text was collected. Do not weaken
SSH security or enable new services to use this offline comparator.

From the RLSOK source workspace:

```sh
node scripts/run-rlsok.cjs profile compare-create3-versions \
  --baseline /private/reviewed-version.txt \
  --current /private/current-version.txt \
  --output /private/create3-review-01
```

In the self-contained Local Check package, use `rlsok profile
compare-create3-versions` with the same arguments (`bin/rlsok` on Linux/macOS,
`bin/rlsok.cmd` on Windows). The offline comparison needs no Python or ROS.

Read `report.md` and `report.json`. By default **only** `robotId`,
`navigationSerialNumber`, `productVersion` and `osVersion` are compared. To
include other available version fields, select the complete set explicitly:

```sh
node scripts/run-rlsok.cjs profile compare-create3-versions \
  --baseline /private/reviewed-version.txt \
  --current /private/current-version.txt \
  --fields robotId,navigationSerialNumber,productVersion,osVersion,bootloaderVersion,navBoardRevision,mobilityVersion,powerVersion,safetyVersion \
  --output /private/create3-review-02
```

`--fields` replaces the default selection; the report always lists the exact
scope. No unknown value becomes verified just because both files say unknown.

| Result | Meaning within the selected fields | Exit |
| --- | --- | --- |
| `UNCHANGED` | All selected values are reported and equal | 0 |
| `CHANGED` | At least one reported selected value differs | 1 |
| `NEEDS_MATERIAL` | Missing/unavailable selected value, duplicate known field, or absent/invalid product discriminator | 1 |

Malformed UTF-8, control characters, files over 128 KiB and invalid options are
input errors. Duplicate known fields are refused even when identical; do not
concatenate multiple captures. Values are compared literally after trimming
outer whitespace; this is not a firmware-compatibility solver.

Other selectable fields are `tskFingerprint`, `mobilityBootloaderVersion`,
`networkManagerVersion`, `localManagerVersion`, `cloudManagerVersion`,
`schedulerVersion`, `otaManagerVersion`, `connectivityManagerVersion`,
`buildType` and `osBuildDate`. All recognized fields appear in the JSON with
`reported`, `missing` or `unavailable` state. `unknown`, `Program not installed`,
empty and other unavailable markers have a null value. Unselected unavailable
fields do not block the narrower comparison and are **not** established facts.

Boot count and previous OS version are context only: rebooting does not by
itself change stable device identity. Input SHA256 hashes still distinguish the
original files. Unrecognized lines are counted by line number but not echoed,
so a shell prompt or unrelated credential line is not copied into the report.

The reference file is not an approval record. `UNCHANGED` is not permission to
move, physical unit authentication, evidence of a fresh live connection, or
proof of safety firmware, motor mapping or calibration. A changed software
value does not necessarily mean a different physical machine.

Reports include the selected robot identifiers and all recognized version
values. Keep them private. If sharing a synthetic/redacted reproduction, edit
the inputs **before** comparison; editing a report afterwards breaks its
relationship to its recorded input hashes. The included tests use invented
values and establish parser/CLI behavior, not a physical Create 3 trial.
