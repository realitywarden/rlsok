# What runs in Local Check

RLSOK Local Check is built from this public repository. You can review or build
the same components instead of installing an unsigned desktop package.

| Function | Source |
| --- | --- |
| CLI entry and profile commands | `apps/cli/index.ts`, `apps/cli/profile.ts` |
| Read-only ROS graph collector | `experimental/composable-shadow/collect.py` |
| Controller and node-setting exporters | `experimental/composable-shadow/controller_state.py`, `experimental/composable-shadow/node_settings.py` |
| Profile, observation and proposal validation | `packages/composable-shadow/schema.ts`, `packages/composable-shadow/onboarding.ts` |
| Goal/message validation | `packages/composable-shadow/goals.ts` |
| Comparison and zero-dispatch decision | `packages/composable-shadow/index.ts` |
| Saved-file capture and comparison | `packages/composable-shadow/saved-setup.ts`, `packages/composable-shadow/saved-setup-recipes.ts` |
| Evidence hashing and chaining | `packages/core/evidence.ts` |
| Linux bundle recipe | `scripts/build-linux-x64-bundle.cjs` |
| Windows standalone Local Check recipe | `scripts/build-windows-local-check.py` |
| Native Mac package recipe | `scripts/build-macos-local-check.py` |

The source tree is [Apache-2.0 licensed](../LICENSE). Release assets publish a
SHA-256 checksum and GitHub asset digest. Those digests let you compare a
download with the release; they do not prove that a binary came from an
independently reproduced build. The native Mac package is unsigned and is not
notarized. You do not need to bypass Gatekeeper to review or build the source.

Local Check's evaluation path creates no robot dispatcher. The ROS collector
uses discovery and read-only graph/service queries; it does not create a command
publisher, action client or control-service caller. DDS discovery still uses the
network selected by the operator's ROS domain. Saved-file review does not start
ROS or open serial, CAN, UDP or TCP devices. These statements describe the
reviewed source and scoped tests, not every unrelated application in a user's
workspace.

See [the local start guide](local-check-start.md) for the packaged route and
[the first evaluation guide](local-shadow-first-evaluation.md) for the exact
zero-dispatch scope. Building from source uses the repository's lockfile and
the version prerequisites in `package.json`; compare the checked-out commit to
the release tag before running it.
