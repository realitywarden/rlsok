# RLSOK

[![CI](https://github.com/realitywarden/rlsok/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/realitywarden/rlsok/actions/workflows/ci.yml)
[![Local Check 1.5.3](https://img.shields.io/badge/Local_Check-1.5.3-blue)](https://github.com/realitywarden/rlsok/releases/tag/v1.5.3)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

RLSOK helps you see when robot settings no longer match the version you reviewed.
It includes local configuration checks and a separate workflow for reviewing
robot software execution approvals.

**[Website](https://rlsok.com) · [Try the example](https://rlsok.com/download) · [Documentation](https://rlsok.com/docs) · [What changed](https://rlsok.com/updates)**

## Start on your own computer

Choose your computer at **[rlsok.com/download](https://rlsok.com/download)**.
You do not need a RLSOK account for these local entry points.

| Your computer | What to download | First step |
| --- | --- | --- |
| Windows 10/11, 64-bit | Local Check 1.5.2, a 35 MB ZIP with Node included | Extract the whole ZIP and open `START-HERE.html`. No ROS or database installation is needed for the file checks. |
| Mac with Apple silicon or Intel | Local workspace 1.3.2, about 198 MB or 200 MB; Node and the database are included | Choose the package for your chip, follow the installer guide, then open RLSOK from Applications. These packages are unsigned and not Apple-notarized; read the first-open instructions. |
| Ubuntu 22.04 or 24.04, Intel/AMD 64-bit | Local Check 1.5.3, about 45 MB with its runtime included | Follow [the local first-run guide](docs/local-check-start.md). No robot, ROS installation or account is needed for the included example. |

On Windows, `Run example.cmd` compares original inputs with an intentionally
changed calibration value. Open the reports to see the difference, then follow
[the Windows and Mac guide](https://rlsok.com/learn/check-robot-files-on-windows-or-mac)
to move on to your own saved files. The file checks send no robot commands;
a matching report does not establish what is currently running on a robot.

The separate **Windows local-workspace installer** needs Node 22+ and
PostgreSQL 16/17. If you only want file checks, start with the smaller ZIP above.
Older releases and emailed download links remain available.

## Get help or share a result

Use [GitHub Discussions](https://github.com/realitywarden/rlsok/discussions/35)
or [the RLSOK Discord](https://discord.gg/yVcwqf3jxz). Tell us your operating
system, which download you chose, the step you tried and a short error with
private information removed. English and Chinese are welcome.

Prefer to inspect or build what runs locally? See the
[source-to-binary map](docs/source-transparency.md) for the collector,
comparison, evidence and platform packaging entry points.

For EtherCAT arms, the [EtherCAT + ros2_control guide](docs/ethercat-ros2-control-shadow.md)
defines the zero-command selection and live-observer boundary. For mobile-robot
bringup, the [navigation preflight](docs/navigation-preflight.md) checks DDS
peers, clock skew, lidar, TF, scan/odometry and Nav2 lifecycle facts without
publishing a command.

## Zero-to-Shadow

For reusable interface selection and field mapping, open the
[browser configuration wizard](https://rlsok.com/connect) and follow
[the interface onboarding guide](docs/interface-onboarding.md). Files are
processed in the browser; exported workspaces are consumed by the local CLI.

For the FANUC/Humble composable workflow, download the separate
[Local Check 1.5.3 package](https://github.com/realitywarden/rlsok/releases/tag/v1.5.3)
and follow the [installation-to-Evidence guide](docs/fanuc-shadow-self-service.md).
This local workflow has not been validated on Humble or a
physical FANUC. It does not change the stable Cloud or v1.4.5 installer below.

Start with [inputs, offline use and result interpretation](docs/local-shadow-first-evaluation.md).
For the inspected hexapod, SO-101, TRIK, LelyRobot and rover source layouts,
use [project-specific source workspaces](docs/source-shadow-workspaces.md).
These mappings require the actual local catalog and reviewed inputs; they are
not customer deployment or acceptance claims.

For configurable ROS 2 action and Twist topic graphs, `rlsok profile help` provides a composable
local Shadow workflow with reusable trajectory, Cartesian and program modules.
See [composable Shadow profiles](docs/composable-shadow.md) for the FANUC/Humble
example, read-only capture, configuration-drift tests and current support scope.
The [FANUC/Humble integration guide](docs/fanuc-humble-integration.md) includes
exportable interface schemas and the complete isolated Humble acceptance run.

The official v1.3.0 robot integration is Universal Robots UR5e on Ubuntu 24.04
x86_64, ROS 2 Jazzy, Fast DDS, and the official Universal Robots ROS 2 driver.
It is validated in the driver's mock-hardware simulation; no physical-robot
validation is claimed. Other valid JointState/FollowJointTrajectory graphs are
identified explicitly as generic protocol support, not official robot support.

```bash
curl -fsSL https://rlsok.com/install.sh | sudo sh
source /opt/ros/jazzy/setup.bash
rlsok setup
```

The packaged runtime bundle is self-contained. Normal users do not need Node.js,
npm, a source checkout, API keys, Workspace IDs, hand-calculated hashes, or a
blank ExecSpec.

`rlsok setup` detects the supported platform and live ROS graph, asks for the
policy artifact, automatically identifies a supported UR5e and its namespace,
joint order, active scaled controller, state source, and action, generates exact
bindings, pairs through the browser, creates a tested Draft, waits for
independent approval, runs a live zero-dispatch Shadow, writes Evidence, and
verifies the stored hash automatically.

Keep the gate running, then propose from policy code without ROS names:

```bash
rlsok observe
```

```python
from rlsok import propose
propose(next_joint_positions)
```

The Python surface can only submit a proposal. Release approval and controller
authority remain in the RLSOK gate.

## Local state

- credentials: `~/.config/rlsok/cloud-credentials.json`
- setup state: `~/.config/rlsok/setup.json`
- releases, protected artifacts, proposals, and Evidence:
  `~/.local/share/rlsok`

Re-run the installer to upgrade. Remove the runtime with
`sudo /opt/rlsok/uninstall.sh`; user configuration and Evidence are preserved.
Installer activation is transactional: if verification fails, the previous
runtime and CLI/Python registrations are restored. This installation rollback
does not restore execution authority; release revocation and approval remain
Cloud-controlled.

## Development verification

Development requires Node.js 22.12+ and npm 10.5+. Production use does not.

```bash
npm ci
npm run verify
npm run package:smoke
npm run bundle:linux-x64
```

The Ubuntu Jazzy CI path uses both a real DDS reference graph and the official
UR ROS 2 driver with mock hardware. It proves automatic UR5e identification and
that Shadow receives proposals while attempting zero controller goals. It does
not claim physical-robot validation.

See [Product quickstart](docs/PRODUCT_QUICKSTART.md),
[ROS 2 setup](docs/ROS2_REFERENCE_SETUP.md),
[architecture](docs/ARCHITECTURE.md), and
[Cloud contract](docs/CLOUD_CONTRACT_V1.md). Integrators should also read the
[Fleet/OTA authorization boundary](docs/FLEET_OTA_AUTHORIZATION_BOUNDARY.md)
and [external compatibility runbook](docs/EXTERNAL_COMPATIBILITY_RUNBOOK.md).

People who explicitly opted in to public attribution are listed in
[Technical contributors and reviewers](TECHNICAL_CONTRIBUTORS.md). Attribution
does not imply endorsement, partnership, customer status, official support, or
vendor certification.

Physical UR5e validation remains pending. External hardware operators should
use the [authoritative physical UR5e validation runbook](docs/PHYSICAL_UR5E_VALIDATION.md),
which produces automatic-discovery, exact-binding, zero-dispatch, negative
authority, revocation, and checksum-verifiable evidence.

## Responsibility boundary

RLSOK is not functional-safety software, a motion planner, E-stop, safety PLC,
certified controller, or hard real-time system. Independent safety systems,
controller limits, site procedures, and hazard analysis remain required.
Shadow is the default mode and never dispatches a controller goal.

## License

Apache-2.0. See [LICENSE](LICENSE).

## Configuration feedback evaluation

The [2026-09-10 guide](docs/email-feedback-evaluation-20260910.md) provides a SO-101 controller type-change workflow, PAROL6/Kortex/xArm source workspaces, command-boundary diagrams and the [propulsor source review and patch](docs/pliant-propulsors-review.md). These are local Shadow and source-review deliverables, not customer acceptance or hardware certification.
