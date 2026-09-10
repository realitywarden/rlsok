# Local Shadow result

**WOULD_ALLOW** — hexapod-gait

Evaluated: 2026-09-10T09:34:38.831Z. Source: ros2-read-only/v1.

WOULD_ALLOW means the declared configuration, local approval, observed interface and supplied message/goal passed these checks. It does not mean the proposed motion is safe or authorize a real command.

WOULD_BLOCK means at least one listed check failed. Review the failed input; do not replace observations with expected values or silently approve the changed setup.

RLSOK sent zero controller commands and uploaded no data. This run does not intercept other nodes: they can still operate a robot. Use an isolated simulation for the first evaluation.

## command — WOULD_ALLOW

Boundary: /cmd\_vel (geometry\_msgs/msg/Twist).

Selected receiver: /hexapod\_gait.

Reason: shadow:composable\_profile\_matched.

| Check | Result | Detail |
| --- | --- | --- |
| approval.profile | Matched | matched |
| approval.time | Matched | matched |
| observation.profile | Matched | matched |
| observation.freshness | Matched | matched |
| environment | Matched | matched |
| coverage | Matched | matched |
| observation.paths | Matched | matched |
| observation.facts | Matched | matched |
| topic.subscription | Matched | matched |
| topic.subscriber | Matched | matched |
| topic.endpoint | Matched | matched |
| topic.type | Matched | matched |
| topic.definition | Matched | matched |
| fact.file-1-gait\_node.py.source | Matched | matched |
| fact.file-1-gait\_node.py.freshness | Matched | matched |
| fact.file-1-gait\_node.py.value | Matched | matched |
| fact.file-2-kinematics.py.source | Matched | matched |
| fact.file-2-kinematics.py.freshness | Matched | matched |
| fact.file-2-kinematics.py.value | Matched | matched |
| fact.file-3-gait.launch.py.source | Matched | matched |
| fact.file-3-gait.launch.py.freshness | Matched | matched |
| fact.file-3-gait.launch.py.value | Matched | matched |
| fact.file-4-controllers.yaml.source | Matched | matched |
| fact.file-4-controllers.yaml.freshness | Matched | matched |
| fact.file-4-controllers.yaml.value | Matched | matched |
| fact.file-5-gazebo.launch.py.source | Matched | matched |
| fact.file-5-gazebo.launch.py.freshness | Matched | matched |
| fact.file-5-gazebo.launch.py.value | Matched | matched |
| fact.file-6-robot.urdf.source | Matched | matched |
| fact.file-6-robot.urdf.freshness | Matched | matched |
| fact.file-6-robot.urdf.value | Matched | matched |
| fact.file-7-runtime-settings.json.source | Matched | matched |
| fact.file-7-runtime-settings.json.freshness | Matched | matched |
| fact.file-7-runtime-settings.json.value | Matched | matched |
| fact.active-controller.source | Matched | matched |
| fact.active-controller.freshness | Matched | matched |
| fact.active-controller.value | Matched | matched |
| fact.gait-node-settings.source | Matched | matched |
| fact.gait-node-settings.freshness | Matched | matched |
| fact.gait-node-settings.value | Matched | matched |
| goal | Matched | matched |

Evidence: command.evidence.json; input assessment: command.assessment.json.

## What this result does not establish

- Shadow evaluation only: no hardware dispatch or production execution permit.
- Local approval and observation files are operator-supplied, not authenticated Cloud approval or hardware attestation.
- Graph discovery confirms visible server/subscriber metadata, not physical robot identity, QoS delivery, controller readiness or all execution paths.
- Topic proposals are supplied local message examples; no live messages are intercepted, forwarded or published. Other nodes can still command a robot: use an isolated simulation.
- Twist uses the operator-declared command frame; only TwistStamped includes a checked frame ID. Limits, collision checks and readiness remain the existing controller responsibility.
- File hashes prove local file content; timestamped JSON facts require a trusted read-only exporter of active controller state.
- Goal adapters check declared fields and configuration eligibility, not complete ROS serialization or physical motion safety.

Motor/current limits, collision avoidance, emergency stops, gait stability and readiness checks remain with the existing robot/control system. No safety or formal-verification claim is made.

The local operator name is self-attested. Keep results and configuration private; public case studies and contribution credit require agreement with participants.
