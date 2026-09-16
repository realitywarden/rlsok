# Check an absolute Cartesian W/P/R input without sending it

Local Check 1.5.2 adds `cartesian_absolute_wpr` for custom actions whose
absolute XYZ target uses millimetres and whose native FANUC W/P/R values use
degrees. It keeps these values as supplied. It does not convert a quaternion,
transform frames, normalize angles or turn the target into a relative jog.

Use [the FANUC setup guide](fanuc-shadow-self-service.md) for all three paths,
the installed interface fingerprints, active-state facts and isolated-graph
workflow. This adapter does not complete those facts for you.

## Map the fields explicitly

This is a **generic field-mapping example**, not a customer's action or a
ready-to-approve profile. Replace pointers with fields from the installed
Goal definition:

```json
{
  "adapter": "cartesian_absolute_wpr",
  "fields": {
    "position": ["/x", "/y", "/z"],
    "rotation": ["/w", "/p", "/r"],
    "velocity": "/velocity",
    "frame": "/header/frame_id",
    "expectedFrame": "operator-selected-frame",
    "defaultVelocityMmS": 25,
    "maxVelocityMmS": 2000
  }
}
```

XYZ and WPR must each have three distinct finite numeric fields. Velocity
must be an integer from 0 through 65535, matching a uint16 command field.
Zero means the driver uses a configured default: RLSOK checks the explicit
`defaultVelocityMmS` against the explicit maximum. Both values must come from
the reviewed setup and be bound with the driver configuration facts; the
example numbers are not a robot speed recommendation. The checker does not
discover that default from the controller.

The frame must equal `expectedFrame` exactly, including a nonempty value.
This is deliberately stricter than a driver that accepts an empty frame.
A matching ROS label proves neither the active user/tool frame nor a TF
transform. Supply separate trusted read-only exports of those active states.

The browser's [interface setup page](https://rlsok.com/connect) uses the same
mapping and validation rules. Import a real read-only catalog, choose
**Absolute XYZ + W/P/R (mm/degrees)**, map the fields and enter both reviewed
velocity values. The downloaded workspace remains local; a source schema
alone is not proof of a running graph or installed matching definitions.

## What the result means

An all-zero pose is a literal absolute target, **not a no-op**. Redacted zero
examples are for schema checks only and must never be dispatched. A matched
input is not a reachability, collision, calibration-accuracy or motion-safety
result. Goal stamps are not turned into a scheduling/freshness guarantee;
the separate observation timestamps still apply.

Keep FollowJointTrajectory and the TP-program path in the profile where both
exist. TP names must match an explicitly reviewed allowlist exactly; RLSOK
does not trim/uppercase a name to make it pass. A name alone does not bind
program content: include a read-only program artifact fingerprint as a checked
fact where available. Program success, measured final pose and subsequent
controller communication recovery are separate observations, outside this
zero-dispatch input check.

Private schemas, pose examples, calibration and controller exports belong in
the local workspace. Published examples and offline checks do not establish
Humble installation, customer hardware compatibility, actual use or acceptance.
