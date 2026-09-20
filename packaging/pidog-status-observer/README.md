# RLSOK PiDog Embodiment status observer candidate

This source-only observer is pinned to
`rockywuest/pidog-embodiment@e88a3979b7ad200c9ce016b849cd6a3b2bcc3a54`.
That revision contains the issue-12 PATH and robot_hat MCU diagnostics, but
upstream issue #12 is still open pending the owner's physical confirmation.
Do not present this candidate as an accepted PiDog result.

Run it only while the PiDog body and its normal Nox services are already
running for the owner's own work. Do not power, start, move or reconfigure the
dog solely for this capture.

The archive is plain Python and works on the Pi itself; it does not require the
x64 RLSOK executable. It needs Python 3, Git, the exact local checkout, the
three installed Nox unit files in `/etc/systemd/system`, the installed
`pidog`/`robot-hat` packages and the local bridge on port 8888.

```bash
cd rlsok-pidog-status-observer
python3 pidog_status.py \
  --repo "$HOME/pidog-embodiment" \
  --source-commit e88a3979b7ad200c9ce016b849cd6a3b2bcc3a54 \
  --output pidog-status.json
```

If the local bridge requires its bearer token, pass it only for this process:

```bash
RLSOK_PIDOG_STATUS_TOKEN='your-existing-local-token' \
python3 pidog_status.py \
  --repo "$HOME/pidog-embodiment" \
  --source-commit e88a3979b7ad200c9ce016b849cd6a3b2bcc3a54 \
  --output pidog-status.json
```

The token and environment-file contents are never written. The observer also
omits faces, photos, perception, audio and conversation history. It stores
only selected source/unit digests and fields, SDK versions, hostname, uptime,
battery voltage, selected behavior state and the robot_hat MCU verdict.

It performs exactly one loopback `GET /status`. It never calls `/action` or
the motion-producing `/selftest`, opens the daemon command socket, changes a
service or writes I2C. A passing file shows that this selected local setup
reported a powered, responding robot_hat MCU. It does not prove servo motion,
command delivery, PiDog serial identity, physical safety or acceptance.

If the command fails, send the full terminal output instead of changing the
observer or retrying movement endpoints.
