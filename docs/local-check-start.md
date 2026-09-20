# Try RLSOK on your computer

RLSOK Local Check **1.5.5** compares robot settings with a copy you reviewed.
Try the included example first: one report shows matching settings, and the
other identifies a changed calibration value. No robot, ROS installation or
account is needed for this example. Nothing is sent to a robot.

## Which computer can I use?

- **Ubuntu 22.04 or 24.04, Intel/AMD 64-bit:** use the download below. The
  package includes its runtime; `curl`, `sha256sum` and `tar` are required.
- **Windows 10/11, 64-bit:** use the self-contained ZIP from the download page.
- **macOS 14 or later, Apple silicon or Intel:** use the native installer for
  your processor. Its local console runs this same zero-command example.

## 1. Download and run the example

Open Terminal on Ubuntu. Copy this whole block, paste it and press Enter.
Use a new folder name if `rlsok-first-check` already exists.

```sh
mkdir rlsok-first-check && cd rlsok-first-check &&
curl -fLO https://github.com/realitywarden/rlsok/releases/download/v1.5.5/rlsok-local-check-1.5.5-linux-x64.tar.gz &&
curl -fLO https://github.com/realitywarden/rlsok/releases/download/v1.5.5/rlsok-local-check-1.5.5-linux-x64.tar.gz.sha256 &&
sha256sum -c rlsok-local-check-1.5.5-linux-x64.tar.gz.sha256 &&
tar -xzf rlsok-local-check-1.5.5-linux-x64.tar.gz &&
./rlsok-local-check-1.5.5/bin/rlsok profile demo --output first-result
```

Already extracted the package? Run `./bin/rlsok profile demo --output first-result`
from its directory instead. Use a new output folder for another attempt.

## 2. Read what changed

Open these files in your text editor:

- `first-result/baseline/report.md`: **WOULD_ALLOW** — the sample settings match.
- `first-result/changed-calibration/report.md`: **WOULD_BLOCK** — the sample
  calibration changed. The report gives the reason.

These are comparison results for sample inputs, not permission to move a robot.
No administrator access, account signup or background service is needed.
If the download or checksum fails, stop and use a fresh folder after fixing
the error. Keep the archive and checksum from the same release.

## 3. Use your own files when you are ready

[Choose a saved-file guide](https://rlsok.com/download#fanuc-first-use) for
your project. Some guides need Python, Git or your existing ROS environment;
each lists its requirements. A saved file cannot establish which settings a
running robot is using. Keep private configurations and reports on your machine.

For help, send the first failing step and the error text with private details
removed to [support@rlsok.com](mailto:support@rlsok.com), or use
[the RLSOK Discord](https://discord.gg/yVcwqf3jxz).

## Existing installations and older emails

This package installs in its own directory. It does not upgrade the older
robot runtime or Windows management app. Old releases, checksums, guides and
emailed URLs remain available at their original version. To try this version,
use a new directory and retain existing workspaces and reviewed baselines.

The separate installer is available as `install-local.sh` with its matching
`.sha256` file in [this release](https://github.com/realitywarden/rlsok/releases/tag/v1.5.5).
The `install-shadow.sh` name is also supplied for existing instructions; both
scripts select this exact package version. Do not use a source-template script.

See [release notes and verification scope](releases/v1.5.5.md).
