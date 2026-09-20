# Workbench instrumented Shadow submissions v2

This package implements the two corrections Quchaosheng requested after
independently reproducing v1.

First, the zero-dispatch counts no longer come from a literal result object.
The evaluator imports `ExecutionController` from the exact selected
`workbench-mobile-home-robot` checkout, injects an
`InstrumentedShadowAdapter` at its real `ActionAdapter.dispatch` boundary and
reads the counters from that adapter before and after both submissions.  The
adapter fails closed if it is ever called.  Shadow `WOULD_ALLOW` remains a
proposal, so the downstream controller is intentionally not executed.

Second, drift is no longer manufactured inside `evaluate()`.  The operator
runs the repository's ordinary offline planner twice, prepares two separate
Draft files, approves only the exact baseline Draft and submits both existing
Drafts through the same evaluator and the same instrumented runtime instance.
The evaluator requires the configuration difference to be exactly
`plannerArtifactDigest`.  The baseline reports `WOULD_ALLOW`; the changed
Draft reports both `approved_draft_digest_mismatch` and
`configuration_digest_mismatch` and is blocked before dispatch.

The profile remains offline software evidence.  The repository's
`REPOSITORY_BASELINE_READY_PHYSICAL_BRINGUP_BLOCKED` state is preserved.  It
does not establish deployment, physical hardware, code adoption or customer
acceptance.

The main commands are:

```bash
python3 workbench_offline_shadow.py prepare --source-root /path/to/workbench \
  --expected-commit 716864c08ea383b29b29d46c0a1452cf579a3b2a \
  --demo-json baseline-demo.json --output baseline-draft.json

python3 workbench_offline_shadow.py prepare --source-root /path/to/workbench \
  --expected-commit 716864c08ea383b29b29d46c0a1452cf579a3b2a \
  --demo-json changed-demo.json --output changed-draft.json

python3 workbench_offline_shadow.py approve --draft baseline-draft.json \
  --approver independent-reviewer --approved-at 2026-09-20T13:20:00Z \
  --output approval.json

python3 workbench_offline_shadow.py evaluate \
  --baseline-draft baseline-draft.json --changed-draft changed-draft.json \
  --approval approval.json --source-root /path/to/workbench --output result.json
```
