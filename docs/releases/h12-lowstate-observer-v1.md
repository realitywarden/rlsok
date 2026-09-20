# H1-2 LowState observer v1

This project-specific package is the immutable companion to CorrellLab
`h12_loco_manipulation` PR #1 at source commit
`6fef8760741af122c59ca13e5f1960a1f79b230a`.

Release archive: `rlsok-h12-lowstate-observer-v1.zip` (5,492 bytes), SHA-256
`c7ab62203999f2089ee42f9a68e2a8b227001c8b62abeb9128d529a84e43909c`.

The observer uses the same H1-2 state type, `rt/lowstate` topic and 27-motor
layout as the public real-robot controller. It waits for 50 non-zero ticks,
validates finite motor telemetry and writes one bounded local JSON file. The
upper-body section contains waist and arm indices 12–26.

It creates no DDS publisher, command message or motion-switcher client and
calls no robot action. The JSON therefore separates what was observed from
what is not available: a real state stream may be observed, while contact,
caught state and readiness for the next move remain `not_inferred` until an
application-owned signal exists.

Run it only during an existing normal H1-2 session:

```bash
python3 rlsok_lowstate_snapshot.py enp3s0 \
  --output h12-lowstate-status.json
```

Replace `enp3s0` with the robot-facing interface. A returned file is evidence
of that bounded observation, not hardware authentication, motion safety,
permission to move, customer acceptance or proof about other processes.
