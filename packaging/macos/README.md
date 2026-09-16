# RLSOK Local Check for Mac

Compare local robot settings with a reviewed copy. The included example needs
no robot, account, Node installation, or ROS environment. It sends no robot commands.

## Install and try

Use the `.pkg` for your Mac: **arm64** for Apple silicon, **x64** for Intel.
This package targets macOS 14 or later. After installation, open **RLSOK Local
Check 1.5.2** in Applications and choose **Run example**. It saves two reports
under Documents/RLSOK and opens their folder. The baseline matches; the changed
calibration is flagged. These are file comparison results, not permission to move a robot.

## Your own files

The app's **Open guide** button opens this document. The included `docs` folder
contains the saved-file recipes. Some recipes need Python or your existing ROS
environment; each recipe lists its own requirements. The command-line tool is:

```sh
"/Applications/RLSOK Local Check 1.5.2.app/Contents/Resources/local-check/bin/rlsok" profile help
```

This is the Local Check file comparison tool. It does not replace the Windows
management app or a robot's execution software. Your own configurations and
reports stay on your computer.

## Remove

Quit the app and move **RLSOK Local Check 1.5.2** from Applications to Trash.
Your reports in Documents/RLSOK are kept. No background service is installed.

## Package verification

Keep the installer and its checksum from the same release. Developer ID signing
and notarization status must be checked in the accompanying build/verification
record; building a package alone does not establish either. Do not disable
Gatekeeper globally.
