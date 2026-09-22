# RLSOK Local Check 1.5.7 for macOS

The native local file-checking app for macOS 14 or later includes the exact
1.5.7 source payload and a Node.js runtime for your processor. Choose `arm64`
for Apple silicon or `x64` for Intel, install the matching `.pkg`, then open
**RLSOK Local Check 1.5.7** and choose **Run example**. No robot, account,
separate Node installation or ROS environment is needed for the example.

This release adds offline comparison of saved Create 3 version reports and an
opt-in observer for an already-running MowgliNext firmware-status topic, plus
offline comparison of its reported firmware and selected saved wheel/PID values.
Read the [1.5.7 changes and limits](https://github.com/realitywarden/rlsok/blob/v1.5.7/docs/releases/v1.5.7.md).
Live Mowgli observation additionally requires the owner's existing ROS/message
environment, Git and Python; the Mac app does not supply a mower connection.

Before publication, each exact native installer is installed on a matching
standard GitHub-hosted macOS runner. The installed SwiftUI executable must pass
its resource/version self-check, the bundled CLI must report 1.5.7, and the
included example must produce `WOULD_ALLOW` and `WOULD_BLOCK`. Per-architecture
verification records and SHA-256 sidecars accompany this release.

The app retains its dark local console and does not replace the separate cloud
or robot execution stack. It sends no robot commands. Saved comparisons do not
authenticate a physical device or prove live settings, safe motion, customer use
or acceptance. Mowgli live DDS and physical-mower compatibility are unverified.

The packages are not Developer ID signed or notarized. Follow the first-open
instructions in System Settings → Privacy & Security; do not disable Gatekeeper
globally. Keep previous installations and reviewed baselines until you choose
to remove them. Previously emailed releases remain unchanged.
