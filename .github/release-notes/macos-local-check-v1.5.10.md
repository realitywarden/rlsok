# RLSOK Local Check 1.5.10 for macOS

The native local file-checking app for macOS 14 or later includes the exact
1.5.10 source payload and a Node.js runtime for your processor. Choose `arm64`
for Apple silicon or `x64` for Intel, install the matching `.pkg`, then open
**RLSOK Local Check 1.5.10**. No robot, account, separate Node installation or
ROS environment is needed for the included example.

The new **Interface setup** page explains the local discover, compose and
confirm workflow. The bundled CLI composes ordered, versioned template
fragments without an AI service or cloud upload. Paths and facts combine;
later robot defaults override earlier ones, while conflicting ROS
distributions and contract limits fail closed. See the
[1.5.10 changes and limits](https://github.com/realitywarden/rlsok/blob/v1.5.10/docs/releases/v1.5.10.md).

Before publication, each exact native installer is installed on a matching
standard GitHub-hosted macOS runner. The installed SwiftUI executable must pass
its resource/version self-check, the CLI must report 1.5.10 and expose the
composition command, and the included example must produce `WOULD_ALLOW` and
`WOULD_BLOCK`. Verification records and SHA-256 sidecars accompany it.

The packages are not Developer ID signed or notarized. They send no robot
commands. This release does not establish private-interface compatibility,
customer use or acceptance. Follow the first-open instructions in System
Settings → Privacy & Security; do not disable Gatekeeper globally.
