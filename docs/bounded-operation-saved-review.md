# Review a bounded operation without taking over local control

Use this Local Check recipe when one higher-level authorization covers a bounded physical operation while a local controller continues making fast corrections. A compliant gripper holding an object is one example.

This check does **not** observe slip, interpret live perception, command a controller, stop hardware or decide that an operation is physically safe. It compares the exact files and operator-declared inputs selected for review. Local control must continuously measure the physical state, decide when the declared envelope has ended and respond immediately. Independent safety mechanisms retain force limits, stopping behaviour and the safe physical response.

## Minimum saved inputs

Select these four files:

1. `operation.json`: the bounded task, maximum validity, allowed local adjustments, continuously measured signals, terminating-condition IDs and the ownership split.
2. `operating-envelope.json`: every terminating condition with its signal, comparator, threshold, unit, debounce and human-readable interpretation.
3. The exact controller configuration used for the operation.
4. The exact calibration/configuration assumptions used by that controller.

If perception affects the local state, also select the perception/control configuration. If temporal state matters, add `temporal-state.json` containing named states, hashes of operator-selected reference observations and the expected transitions. The hashes bind reviewed reference material; RLSOK does not decide what a live image means.

Do not include secrets, raw customer data or an entire dataset merely to make the file set look complete. A small reference index with SHA-256 digests is enough when the underlying reference material is retained privately by the operator.

## Inspect the contract

Start from [`examples/bounded-operation-review`](../examples/bounded-operation-review). Update every selected value and the source commit; the example values are not robot defaults.

```bash
rlsok profile inspect-saved-inputs \
  --recipe bounded-operation \
  --source /path/to/selected/source-checkout \
  --input selected-files.json \
  --output inspection
```

The inspector rejects missing ownership, an unbounded validity period, condition IDs that do not match, invalid scalar/range thresholds, duplicate temporal states or transitions referencing unknown states. `NO_STATIC_ISSUES` means only that the selected declarations are internally consistent.

## Save and compare the selected files

Use the included `setup-manifest.json` with the normal saved-setup flow:

```bash
rlsok profile capture-setup --manifest setup-manifest.json --output observed.json
rlsok profile approve-setup --observation observed.json --actor reviewer --output baseline.json

# Before a later operation, capture the selected files again.
rlsok profile capture-setup --manifest setup-manifest.json --output current.json
rlsok profile review-setup --baseline baseline.json --observation current.json --output comparison
```

Any changed selected file requires review before a new bounded operation. A local envelope exit must be handled immediately by local control; it is not safe to wait for this file comparison. After termination, `new-check-before-next-operation` means the saved inputs are checked again before another operation starts.

## What this can and cannot establish

- It can show whether the reviewed task/controller/calibration/envelope/perception contract and reference index are unchanged.
- It cannot prove that the running binary loaded those files, that a sensor is calibrated, that a classifier is correct, that the object remains inside the envelope, or that a stop is safe.
- Reference observations and expected transitions are configuration evidence, not live perception evidence.
- Hardware-specific validation still needs the real controller/export format and test evidence from the system owner.
