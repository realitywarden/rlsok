# RLSOK Local Check 1.5.8 for macOS

The native local file-checking app for macOS 14 or later includes the exact
1.5.8 source payload and a Node.js runtime for your processor. Choose `arm64`
for Apple silicon or `x64` for Intel, install the matching `.pkg`, then open
**RLSOK Local Check 1.5.8** and choose **Run example**. No robot, account,
separate Node installation or ROS environment is needed for the example.

This release lets a Piper setup explicitly use an operator-reviewed USB path
when a camera exposes no readable unit serial. It requires the reviewed stream
interface/index, never silently falls back from serial, and records that USB
topology identifies a port rather than a unique camera. Read the
[1.5.8 changes and limits](https://github.com/realitywarden/rlsok/blob/v1.5.8/docs/releases/v1.5.8.md).

Before publication, each exact native installer is installed on a matching
standard GitHub-hosted macOS runner. The installed SwiftUI executable must pass
its resource/version self-check, the CLI must report 1.5.8, the Piper guide and
command must be present, and the included example must produce `WOULD_ALLOW`
and `WOULD_BLOCK`. Verification records and SHA-256 sidecars accompany it.

The packages are not Developer ID signed or notarized. They send no robot
commands. This release does not establish customer GUI integration, repeat use
or acceptance. Follow the first-open instructions in System Settings → Privacy
& Security; do not disable Gatekeeper globally. Keep previous installations and
reviewed baselines until you choose to remove them.
