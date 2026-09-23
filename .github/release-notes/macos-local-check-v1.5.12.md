# RLSOK Local Check 1.5.12 for macOS

This native local checking app for macOS 14 or later includes the exact 1.5.12 source payload and a Node.js runtime for the selected processor. Choose `arm64` for Apple silicon or `x64` for Intel. The included example needs no robot, account, separate Node installation or ROS environment.

The local Interface setup assistant can read an expanded URDF and selected controller configuration, suggest structurally identifiable fields, discover or import ROS interfaces, combine private versioned template fragments and export a checked workspace. Units, frames, physical meaning and active-controller identity still require explicit review. It uses no AI service, cloud upload or robot-command endpoint. See the [changes and limits](https://github.com/realitywarden/rlsok/blob/v1.5.12/docs/releases/v1.5.12.md).

Before publication, each exact installer is installed on a matching standard GitHub-hosted macOS runner. Native installation, version/resource checks, the setup assistant command and the included `WOULD_ALLOW` / `WOULD_BLOCK` example must pass. Verification records and SHA-256 sidecars accompany the installers.

These packages are not Developer ID signed or notarized. They do not establish private-interface compatibility, physical robot use or customer acceptance. Follow the first-open instructions in System Settings → Privacy & Security; do not disable Gatekeeper globally.
