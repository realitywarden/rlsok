# Tello passive observation entry point — 2026-09-11

Adds an optional after-call observer for the public `tello_simple_teleop`
service client, a separate local Unix-datagram collector, and an installation /
coverage guide. No ROS command transport or authorization gate is added.
An unavailable or full recorder drops the observation without deciding whether
the original command runs. Foxy's relative `Client.srv_name` is preserved and
explicitly does not claim resolved remapping or physical drone identity.

Public reference: RoboticsLabURJC/2022-tfg-guillermo-bernal,
`8a66ad7e3d08b0e92877107b184dff45375f99d3`.

Targeted checks performed:

- Eight focused Python checks on Linux: exact command/name copying; Foxy
  relative name; missing recorder/recovery; disabled recorder; actual bounded
  kernel queue saturation; malformed input/closed socket; preservation of the
  original call/future/spin under observer exceptions; separate collector
  process, local file permissions and invalid packet handling.
- Patch application checked against the pinned public client source.
- Two existing Core checks selected by name: queued authority invalidation on
  release/configuration/policy/selected-state changes; unselected noise and
  single-use consumption. These corroborate the existing generic contract,
  not a Ganglion deployment or race-free hardware integration.
- TypeScript compilation and diff review; no full test suite or GitHub Actions.

The upstream main (which sends takeoff/stop), ROS Tello driver, ROS command
client and physical drone were never run. The tests use fake clients and local
Unix datagrams. Current customer distro, local modifications and remappings
remain to be confirmed. Captures are local, unauthenticated observations, not
complete driver/flight traces or configuration approvals.

This is a separate source/example release. Runtime prerelease
`v1.5.0-shadow.8`, stable releases and existing download links remain available.
Also completes an omitted, explicitly approved contributor attribution and
preserves the requested architecture-only attribution boundary.
