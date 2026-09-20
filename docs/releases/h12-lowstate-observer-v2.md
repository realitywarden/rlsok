# H1-2 LowState observer v2

Version 2 fixes source-evidence capture for the standalone download. Version 1
correctly created no command surface, but its documented standalone command did
not require the H1-2 checkout path and therefore could not reliably record the
checkout actually in use.

This package now requires `--source-root` to be the exact root of the
`h12_loco_manipulation` Git checkout. It refuses a subdirectory, missing Git
checkout or checkout without an origin remote. The output records the full
commit, dirty state, checkout name and origin URL rather than guessing from the
observer's extracted location.

Release archive: `rlsok-h12-lowstate-observer-v2.zip` (6,081 bytes), SHA-256
`9ef44d6888156346e87c9abd8fc4fd344ef4ea9b0f25d8f6182ea38c232c254b`.

The robot-facing behavior is unchanged: subscribe only to `rt/lowstate`, wait
for 50 non-zero ticks, validate finite telemetry for all 27 H1-2 motors, and
write one bounded JSON file. No DDS publisher, command message,
motion-switcher client, mode release or robot action is created.

```bash
python3 rlsok_lowstate_snapshot.py enp3s0 \
  --source-root /path/to/h12_loco_manipulation \
  --output h12-lowstate-status.json
```

The output continues to report contact/caught state and readiness for the next
move as `not_inferred`. A real state stream is observation evidence, not an
application-owned contact verdict, hardware authentication, motion-safety
decision, permission to move or customer acceptance.
