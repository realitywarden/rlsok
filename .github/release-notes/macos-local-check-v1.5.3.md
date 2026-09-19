# RLSOK Local Check 1.5.3 for macOS

This is the self-contained Local Check file-review tool for macOS 14 or later. It includes the exact RLSOK Local Check 1.5.3 source payload and a native Node.js runtime for each processor family.

Choose `arm64` for Apple silicon or `x64` for an Intel Mac. Install the matching `.pkg`, open **RLSOK Local Check 1.5.3** in Applications, and choose **Run example**. The included example needs no robot, RLSOK account, Node installation or ROS environment. It writes a matching report and a changed-calibration report locally and sends no robot command.

Both installers were built, installed and executed on the matching standard GitHub-hosted macOS architecture. The verification records and SHA-256 sidecars are included in this release.

The packages are not Developer ID signed or notarized. macOS may require an explicit first-open approval in **System Settings → Privacy & Security**. Do not disable Gatekeeper globally. Signing and notarization require an Apple Developer identity and are separate from native build, installation and execution verification.

This Mac Local Check is independent from the older Mac management workspace and from the robot runtime. A matching file review is not evidence of the active machine, physical safety, customer use or acceptance.
