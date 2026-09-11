# Local passive Tello service observation

Start with [the complete guide](../../../docs/tello-passive-shadow.md).
The observer records a copy after an existing client call returns. The separate
watcher compares fresh software configuration with an explicitly approved local
baseline. Its WOULD_ALLOW / WOULD_BLOCK report never changes whether the original
call runs. RLSOK sends, blocks, cancels and retries zero commands.
