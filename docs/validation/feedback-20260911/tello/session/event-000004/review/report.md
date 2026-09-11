# Tello passive Shadow: WOULD_BLOCK

This review occurred after the owner's service call. RLSOK sent 0 commands and blocked 0 commands.

Reasons: server_binding_missing_or_ambiguous, selected_configuration_changed.

Changed groups: servers.

Approval: de78458c5afeacf39c3c28acaaf476ef99329966cbeee421a20b888eeb973895

Request/selected endpoint: ee96dc0b08e1602eab6926222d2e502e91f55edca110113ab95f6dd738ae1231

- The owner submitted the request before this review. No result can block, cancel, retry, or authorize it.
- WOULD_ALLOW means the selected observed software configuration matches the local baseline; it is not command safety or flight approval.
- ROS graph names and local files are not authenticated physical drone identity or proof of loaded driver parameters.
- The selected client-to-service association is graph correlation under an explicitly reviewed mapping, not DDS request attribution.
- Only the instrumented client is covered. Server responses, flight completion, other clients, cmd_vel and driver keepalives remain outside this record.
- Loss-free, complete capture and atomic state at command dispatch are not established. Hashes detect content changes, not malicious rewriting.
