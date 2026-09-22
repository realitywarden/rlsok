# RLSOK Local Check 1.5.11 for macOS

The native local file-checking app for macOS 14 or later includes the exact
1.5.11 source payload and a Node.js runtime for your processor. Choose `arm64`
for Apple silicon or `x64` for Intel, install the matching `.pkg`, then open
**RLSOK Local Check 1.5.11**. No robot, account, separate Node installation or
ROS environment is needed for the included example.

The **Interface setup** page now opens the same Local Setup Assistant available
on Windows and Linux. It discovers or imports interfaces, composes ordered
private template fragments, matches endpoints and exports a local workspace.
The assistant binds only to this Mac and has no cloud-upload or robot-command
endpoint. See the
[1.5.11 changes and limits](https://github.com/realitywarden/rlsok/blob/v1.5.11/docs/releases/v1.5.11.md).

Before publication, each exact native installer is installed on a matching
standard GitHub-hosted macOS runner. The installed SwiftUI executable must pass
its resource/version self-check, the CLI must report 1.5.11, expose the setup
assistant, retain the feedback-grounded profile commands, and the included
example must produce `WOULD_ALLOW` and `WOULD_BLOCK`. Verification records and
SHA-256 sidecars accompany it.

The packages are not Developer ID signed or notarized. They send no robot
commands. This release does not establish private-interface compatibility,
customer use or acceptance. Follow the first-open instructions in System
Settings → Privacy & Security; do not disable Gatekeeper globally.
