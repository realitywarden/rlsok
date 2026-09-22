# RLSOK Local Check 1.5.8 for Windows

For Windows 10/11 x64. Extract the whole ZIP and open `START-HERE.html`, then
run the included example. Node.js is bundled; no account, ROS or database is
needed for saved-file checks.

Version 1.5.8 lets a Piper setup explicitly use an operator-reviewed USB path
when a camera exposes no readable unit serial. It requires the reviewed stream
interface/index, never silently falls back from serial, and records that USB
topology identifies a port rather than a unique camera. See the
[changes and limits](https://github.com/realitywarden/rlsok/blob/v1.5.8/docs/releases/v1.5.8.md).

The final ZIP is extracted and executed on Windows before publication. The
verification record identifies the exact archive hash, embedded source and
runtime, confirms the Piper guide/command, and records the matching
`WOULD_ALLOW` / changed-calibration `WOULD_BLOCK` example results.

This is separate from the Windows management workspace. No full suite or
physical robot test is claimed, and the release does not establish customer
GUI integration, repeat use or acceptance. Previous releases and the independent
desktop update feed remain unchanged.
