# RLSOK Local Check 1.5.5 for macOS

This is the self-contained Local Check file-review tool for macOS 14 or later.
It includes the exact RLSOK Local Check 1.5.5 source payload and a native Node.js
runtime for each processor family.

Version 1.5.5 replaces the former AppleScript choice dialog with a native SwiftUI
local console. It follows the current dark, high-density workspace hierarchy,
shows the exact package/source identity and zero-dispatch boundary, runs the
included example, keeps a visible session audit, and opens the local reports and
guide. It does not invent Cloud management or robot-connection capabilities that
are absent from this package.

Choose `arm64` for Apple silicon or `x64` for an Intel Mac. Install the matching
`.pkg`, open **RLSOK Local Check 1.5.5** in Applications, and choose **Run
example**. No robot, RLSOK account, Node installation or ROS environment is
required. One report matches and one changed-calibration report blocks; no robot
command is sent.

Both installers are compiled, installed and checked on the matching standard
GitHub-hosted macOS architecture before publication. The installed app executable
must pass its bundled-resource self-check, and the included CLI example must
produce `WOULD_ALLOW` and `WOULD_BLOCK`. Verification records and SHA-256
sidecars are included in the release.

The packages are not Developer ID signed or notarized. macOS may require an
explicit first-open approval in **System Settings → Privacy & Security**. Do not
disable Gatekeeper globally. A saved-file match is not evidence of the active
machine, physical safety, customer use or acceptance.
