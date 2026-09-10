# Observed feedback verification

The adjacent `nav2`, `nav2-gazebo` and `hexapod` folders contain the actual targeted observations and results for the .8 feedback work. The [verification manifest](observed-feedback-verification.json) identifies the product source-file hashes used for the checks. These are inspectable local review artifacts, not authenticated physical attestations or customer-run results.

Nav2 folders include the original local approvals, baseline observations, exact candidate, manifest and each case's report. An allowed case alone has a `shadow-handoff.json`. Incomplete captures preserve the error reason and do not invent current facts. The Gazebo command-topic log is real transport discovery from the private namespace. The test world and bridge configuration describe the actual selected software base; they are not a mechanical model of customer hardware.

Hexapod includes fresh original controller/gait exports, observed activity samples and the baseline/changed evaluator evidence. The `workspace` subset retains the exact profile, local approval and candidate needed to inspect the comparison. The public owner's mesh/source files are not republished here. Retrieve the pinned upstream checkout when reproducing the experiment. An unchanged controller digest and a changed gait digest are distinct facts; neither is proof of physical safety or customer acceptance.

Commands and limits: [Nav2 observed workflow](../../nav2-observed-shadow.md), [Hexapod observed workflow](../../hexapod-observed-shadow.md), [release validation record](../../releases/v1.5.0-shadow.8.md).
