# Workbench offline Shadow profile v1

This package is scoped to Quchaosheng's `workbench-mobile-home-robot`
repository and its `ActionAdapter.dispatch(SemanticAction)` boundary.

It proves one narrow sequence: a clean, exact source checkout and the output of
the repository's offline planner form a tested Draft; a separate approval
record binds the exact Draft and configuration digest; the approved baseline
would allow in Shadow; changing only the planner artifact digest afterwards is
blocked before dispatch.  Every goal, zero, stop, hold, cancel, retry and
`ActionAdapter.dispatch` count remains zero.

The profile preserves the repository's own readiness result:
`REPOSITORY_BASELINE_READY_PHYSICAL_BRINGUP_BLOCKED`.  It is software/offline
evidence, not a deployment, simulation, physical-robot result, authenticated
third-party claim or customer acceptance.  The included approval command is a
local review-record mechanism; it does not impersonate Hosted Cloud browser
approval.  For a customer mapping, the repository owner supplies the final
device/controller/runtime identities and approves the resulting exact Draft
through their normal independent approval path.
