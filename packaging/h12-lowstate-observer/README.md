# RLSOK H1-2 LowState observer v2

This archive contains the subscribe-only observer proposed in
`correlllab/h12_loco_manipulation` PR #1. It targets upstream commit
`6fef8760741af122c59ca13e5f1960a1f79b230a` and requires the checkout root
actually in use so the result records its full commit, dirty state and origin.

Use it only while the H1-2 and its normal Unitree SDK2 environment are already
available. From the archive directory, replace `enp3s0` with the Ethernet
interface connected to the robot:

```bash
python3 rlsok_lowstate_snapshot.py enp3s0 \
  --source-root /path/to/h12_loco_manipulation \
  --output h12-lowstate-status.json
```

The script subscribes only to `rt/lowstate`, collects 50 non-zero samples,
summarizes all 27 H1-2 motors and reports upper-body indices 12–26 separately.
It does not import a command message, create a DDS publisher or motion-switcher
client, release a robot mode, or call a robot action.

Return `h12-lowstate-status.json`. If the command fails, return the exact
command and complete terminal output rather than changing the robot setup.

The result can establish that a real non-zero LowState stream was observed. It
does not authenticate the robot, prove that another process sent no commands,
infer grasp/contact from raw telemetry, decide readiness for the next move, or
authorize motion.

Focused offline check:

```bash
python3 -m unittest -v test_rlsok_lowstate_snapshot.py
```
