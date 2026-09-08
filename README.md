# RLSOK

[![CI](https://github.com/realitywarden/rlsok/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/realitywarden/rlsok/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/realitywarden/rlsok?display_name=tag)](https://github.com/realitywarden/rlsok/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

RLSOK binds learned-policy execution to the exact release, robot, controller,
and approval intended to run. The robot-side gate rechecks Hosted Cloud before
ROS 2 dispatch and writes verifiable Evidence.

## Zero-to-Shadow

For reusable interface selection and field mapping, open the
[browser configuration wizard](https://rlsok.com/connect) and follow
[the interface onboarding guide](docs/interface-onboarding.md). Files are
processed in the browser; exported workspaces are consumed by the local CLI.

For the FANUC/Humble composable workflow, download the separate
[v1.5.0-shadow.3 evaluation package](https://github.com/realitywarden/rlsok/releases/tag/v1.5.0-shadow.3)
and follow the [installation-to-Evidence guide](docs/fanuc-shadow-self-service.md).
This locally reviewed/built prerelease has not been validated on Humble or a
physical FANUC. It does not change the stable Cloud or v1.4.5 installer below.

Start with [inputs, offline use and result interpretation](docs/local-shadow-first-evaluation.md).

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
