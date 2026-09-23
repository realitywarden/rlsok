# RLSOK Local Check for Mac

Prepare a local check workspace for your robot without an account, AI service,
or robot command. The optional example needs no robot, Node installation or ROS environment.

## Install and try

Use the `.pkg` for your Mac: **arm64** for Apple silicon, **x64** for Intel.
This package targets macOS 14 or later. After installation, open **RLSOK Local
Check __RLSOK_VERSION__** in Applications. Its native local console opens on
**Interface setup**. Choose **Open Local Setup Assistant**, then open your project
folder. The assistant shows recognized files, missing facts and the next action.
It can import a saved interface catalog without ROS; live discovery needs your
sourced ROS environment. File structure cannot establish units, physical meaning
or active hardware identity. Confirm these before exporting a workspace.

**Run example** remains available. It saves two reports under Documents/RLSOK:
one matching baseline and one flagged calibration change. These are file
comparison results, not permission to move a robot.

## Your own files

The console's **Guide** button opens this document. The included `docs` folder
contains the saved-file recipes. Some recipes need Python or your existing ROS
environment; each recipe lists its own requirements. The command-line tool is:

```sh
"/Applications/RLSOK Local Check __RLSOK_VERSION__.app/Contents/Resources/local-check/bin/rlsok" profile help
"/Applications/RLSOK Local Check __RLSOK_VERSION__.app/Contents/Resources/local-check/bin/rlsok" setup-assistant
```

This is the Local Check file comparison tool. It does not replace the Windows
management app or a robot's execution software. Your own configurations and
reports stay on your computer.

## Remove

Quit the app and move **RLSOK Local Check __RLSOK_VERSION__** from Applications to Trash.
Your reports in Documents/RLSOK are kept. No background service is installed.

## Package verification

Keep the installer and its checksum from the same release. Developer ID signing
and notarization status must be checked in the accompanying build/verification
record; building a package alone does not establish either. Do not disable
Gatekeeper globally.
