# Dobot Magician homing pre-run review

This offline recipe implements the configuration half of a Dobot pre-run check
without calling the homing service. It is based on
[`jkaniuka/magician_ros2` at `6d322f4c`](https://github.com/jkaniuka/magician_ros2/tree/6d322f4cc2d752f6bb59c67b4cdb09317a287721).

The public homing service is not read-only: its callback invokes
`set_homing_command(0)`. Never call it during discovery or merely to prove that
RLSOK works.

Prepare `selection.json` with the port, selected tool, sliding-rail choice,
service name and the nodes that must be alive in the actual program:

```json
{
  "port": "/dev/ttyUSB0",
  "tool": "gripper",
  "slidingRail": false,
  "homingService": "/dobot_homing_service",
  "requiredNodes": ["/dobot_homing_srv", "/dobot_state_updater"],
  "provenance": "operator-selected"
}
```

Then prepare the recipe input with `selection`, the actual selected
`homing_parameters`, `axis_limits` and `ptp_parameters` files. Point
`sourceCommit` to the exact 40-character source revision and optionally bind
`dobot-arm` to a serial/topology identity from the local device inventory.

```sh
rlsok profile prepare-saved-setup --recipe dobot-magician-homing \
  --source "$MAGICIAN_SOURCE" --input inputs.json --output dobot-review
```

Capture, review and approve only the saved configuration using the
[saved-setup workflow](saved-setup-review.md). Before a real homing operation,
separately confirm the built/installed revision, selected USB device, expected
publisher/service types and counts, required node liveness, diagnostics/alarms,
current tool/rail selection and the effective homing parameters. RQT can help a
human inspect topology; a screenshot alone is not a fresh machine-readable
gate.

Joint or Cartesian command trials occur only after homing and require their own
reviewed interface, limits and examples. This recipe neither validates those
motions nor sends them. Device serial/name/version/ID queries in the public
driver are unauthenticated diagnostics; they are not cryptographic identity.
