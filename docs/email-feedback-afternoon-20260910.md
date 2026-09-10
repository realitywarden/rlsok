# Local review additions from technical correspondence — 10 September 2026

Available in **v1.5.0-shadow.7**, alongside the [earlier controller experiments](email-feedback-evaluation-20260910.md). These are local review tools and reference explanations. They do not establish customer installation, live device identity, Nav2 integration, physical safety or acceptance. No command below dispatches to a robot.

## Nav2: compare the selected configuration and the exact goal separately

The new `profile compare-nav2` command makes the [Jazzy reference](FEEDBACK_ADAPTER_REFERENCE_CONTRACTS.md#nav2-jazzy-execution-boundary-reference) executable as a **supplied-input comparison**, without adding ROS transport or an execution gate.

```sh
rlsok profile compare-nav2 --baseline baseline.json \
  --changed changed.json --output new-review-directory
```

It writes `nav2-review.json` and `nav2-review.md`. Exit 0 means `MATCH` within the selected supplied facts; exit 1 means `REVIEW_REQUIRED`; exit 2 means incomplete/invalid input. It never creates approval. Errors do not leave a usable review report. Each JSON input is limited to 2 MiB. Unknown fields, non-finite JSON numbers and malformed schema values are rejected.

Start from [the explicitly synthetic input](../examples/adapter-references/nav2-review-input.json). Its empty Path is an opaque hashing sample, **not a runnable navigation goal**. For a real review, replace synthetic metadata, selected configuration hashes and versions with reviewed observations, set `inputSource` to `operator-supplied`, and supply your own exact goal. The tool does not collect those observations, authenticate their origin, establish their completeness, prove freshness for execution, or validate path geometry.

| Selected input | What the comparison does |
| --- | --- |
| Identical numeric limits; changed `feedback`, `scale_velocities`, `smoothing_frequency`, `velocity_timeout` or `deadband_velocity` | Changes the selected configuration digest. `OPEN_LOOP` is smoothing against prior commands, not a measured physical envelope. |
| `CLOSED_LOOP` odometry topic, source node, frame and duration | Binds those sources separately from the changing sample. Missing source metadata makes the input incomplete. The same fields are excluded in `OPEN_LOOP`. |
| Timestamp policy | Includes `stamp_smoothed_velocity_with_smoothing_time` when `timestampConsumed` is true. The explicit consumption decision is itself selected. |
| Controller → smoother → optional selected gate(s) → base | Checks supplied adjacency and unambiguous selected edges. Missing/bypassed links, unexpected publishers on selected inputs, or an unconfirmed complete path yield `INCOMPLETE`. Selected stage identities/configuration/version changes require review. These are consistency checks on assertions, not live ROS topology verification. |
| Loaded plugin IDs, implementations, versions and configuration digests | Binds the allowed configuration independently of the exact per-goal choice. |
| Exact Path plus resolved `controller_id`, `goal_checker_id`, `progress_checker_id` | Changes the command digest on substitution, including when the loaded plugin set stays unchanged. Empty selectors resolve only for a single loaded plugin; ambiguous or unknown selectors are incomplete. |
| Selected software/runtime versions | Requires review on selected source changes even if the action endpoint and goal remain identical. |
| Current odometry samples, diagnostics and unselected scheduling priority | Do not change the selected configuration digest. This comparison makes no real-time guarantee. |

The schema intentionally targets [Navigation2 Jazzy at f4108e5b](https://github.com/ros-navigation/navigation2/tree/f4108e5b1c2bce804a1aa0c7be6673a8eb4a1501). That version's `FollowPath` has the three selectors above and no `path_handler_id`. Other distributions need their own inspected mapping.

Run the seven local CLI examples from a built source checkout:

```sh
node examples/adapter-references/run-nav2-review.cjs ./new-nav2-examples
```

In the Linux evaluation bundle, the equivalent is:

```sh
/path/to/evaluation/bin/node \
  /path/to/evaluation/lib/rlsok/examples/adapter-references/run-nav2-review.cjs \
  ./new-nav2-examples
```

These examples produce inputs, full reports and a summary for matching input, same-limit frequency change, CLOSED_LOOP binding, broken path, per-goal controller substitution, same-API runtime change and volatile-only change. [Recorded CLI results](evidence/afternoon-20260910/nav2-cli-summary.json) are synthetic and separate from the five focused unit-test groups. None is a customer Nav2 run. FollowPath dispatch, authenticated topology collection and time-of-dispatch enforcement remain outside this delivered comparison tool.

## Engineering Assurance Layer: focused review

The adjacent tool was reviewed at [9701f183](https://github.com/ty-knowgic/engineering-assurance-layer/tree/9701f183169ef024d908825d019c439186edc2ac). Comparing two declared parameter sets and recording exact YAML paths is useful for finding configuration incoherence. The directed distinction between over-declaration and conservative configuration is more useful than flagging every numerical difference.

The wording should remain conditional on the actual downstream path and the selected controller. A configured smoother is a command-space stage. A YAML comparison does not establish that the robot actually receives that output, that another publisher cannot bypass it, or that the physical platform achieves a stated acceleration. Under `OPEN_LOOP`, prior commands provide the reference velocity. In `CLOSED_LOOP`, the odometry source also matters. Physical capability needs independent evidence before changing limits.

Three small direct parser/rule probes produced these [recorded results](evidence/afternoon-20260910/eal-focused-review.json):

1. With unchanged limits, changing `feedback` from `OPEN_LOOP` to `CLOSED_LOOP` and frequency from 20 to 50 Hz leaves the rule output unchanged. This demonstrates the current declared-numeric scope; it is not by itself a bug in a tool claiming only that scope.
2. With two DWB plugins, `Slow` matches the smoother and `Fast` declares 4× its forward velocity and 3× its acceleration. `[Slow, Fast]` produces no findings or unsupported/unchecked markers; merely reordering the same plugins to `[Fast, Slow]` produces the expected two findings. The parser silently selects the first plugin, while a Nav2 goal can select another. Report each supported plugin separately, or emit an explicit ambiguous/partial-coverage result until the selected plugin is supplied.
3. A YAML `.nan` acceleration is accepted and becomes `NAV2_LIMIT_HEADROOM` / LOW, described as conservative. Reject non-finite selected numeric values explicitly, with an invalid-input/coverage result; do not silently omit them and then report the remaining checks as sufficient.

The [reproducer](../examples/adapter-references/review_eal_nav2.py) includes all synthetic YAML construction. Run it with Python, PyYAML and Pydantic already available, pointing at the pinned EAL checkout. It uses temporary files and does not change that checkout. Only the parser and coherence functions were exercised, not the CLI's policy/strictness filter, full `make verify`, Gazebo or hardware. These findings were not patched into or accepted by the upstream project.

## Hexapod: confirmed launch reference, separate configuration comparison

The `hexapod-gait` source workspace now generates `LAUNCH-REFERENCE.md` and preserves both reference launch commands in `source-map.json`, for [hexapod_ros2 main at 656eebab](https://github.com/ariegweomamerie/hexapod_ros2/tree/656eebab5587977a1f41d44657cb853433927053):

```sh
ros2 launch Hexapod_Robot_description gazebo.launch.py
ros2 launch hexapod_gait gait.launch.py
```

These identify the existing Gazebo/gait bringup in a separately prepared, isolated simulation environment. RLSOK does not execute them or set up Gazebo. Follow [prepare-source / refresh-source](source-shadow-workspaces.md) with the actual catalog, expanded URDF, runtime settings and local command example. Record any current uncommitted parameter differences in the selected source/settings before comparison. The reference commit is not an attestation of the current working tree.

The reviewed entry boundary is `/cmd_vel` → `hexapod_gait`. Per-leg foot targets, inverse kinematics, 18 joint outputs and the downstream leg controller are distinct later stages. File-drift detection is delivered; end-to-end customer simulation and those downstream stages have not been validated here.

## Maintain one launch source of truth

For flexible Python launch systems such as CRANE+, the ROS launch code continues to choose the hardware path. An integration supplies the resolved, minimal selected facts: for example the mock/real hardware component, controller identity, ordered command mapping, relevant clock semantics and their provenance. RLSOK compares those selected facts; it does not independently interpret or reproduce arbitrary Python launch control flow.

The existing [generic selected-identity contracts](FEEDBACK_ADAPTER_REFERENCE_CONTRACTS.md#execution-critical-launch-and-hardware-binding) express this boundary. The [self-service interface configuration](interface-onboarding.md) can select explicit fields. When a selected output meaning changes, update the mapping once at the integration boundary and review a new baseline. Do not also maintain a shadow copy of every launch condition in the gate. An unrelated camera or logging change should remain outside the selected set unless the approved behavior actually consumes it.

The source-workspace convenience command has a deliberately coarser tradeoff: it hashes selected source files/settings as exact bytes, so comments or formatting in those files can require another review. It is not the same thing as the semantic projection above. A fine-grained CRANE+ collector has not been implemented or tested, and the source-file workflow should not be presented as one.

## Motor-test services, local operation and authorization

For a mobile base, selecting hardware component + drive controller + wheel mapping is a useful starting boundary. It records an assumed mapping; it does not verify wheel polarity, mechanical calibration or actual movement.

Placement depends on the command path: the intended flow is **request → integration-owned configuration/authority check → selected command transport → driver → motors**. If an existing motor-test ROS service can itself move the motors, protecting only a later bringup does not protect that earlier service. It would need its own correctly placed adapter or an independently enforced restriction. The present local review tool does not intercept that service.

This can be useful both on a local robot and in remote deployment when reviewing changed software/configuration. It is not an emergency stop, collision monitor, functional-safety certification, remote-control authentication system or a substitute for DDS/network access controls. A bypassing publisher or compromised observation source is outside an unauthenticated local comparison's guarantee. A concrete Lidarbot mapping still needs the current service interface, its command recipient and the relevant version/configuration; none is invented here.

## Elite model changes and SCHUNK SVH configuration

The already implemented [selected identity reference](FEEDBACK_ADAPTER_REFERENCE_CONTRACTS.md) distinguishes an accurately observed CS63→CS66 model change from replacement by another arm of the same model. The latter would require trustworthy unit identity if continuity is selected. Controller software is distinct from ROS driver/SDK software and is an additional criterion only when the claimed scope selects it. The present Elite contract selects model plus driver/SDK; it does not claim unit or controller-software continuity. Existing focused [Elite tests](../tests/adapter-references/selectedIdentityBinding.test.ts) show model/driver changes blocking fake dispatch while unselected serial/controller-software changes do not invalidate that narrower configuration. No Elite-owned live observer is supplied.

The [SVH projection](FEEDBACK_ADAPTER_REFERENCE_CONTRACTS.md#schunk-svh-selected-command-path) starts from the pinned upstream driver YAML, with selected hand/controller, ordered joints, partial-goal policy, consumed interfaces and update rate. Its contract also distinguishes effective firmware-selected settings and driver/library provenance. Raw `/dev/ttyUSB*` enumeration is not unique physical identity. Comments, an unselected opposite hand and unrelated state publishing are outside that semantic projection. The existing same-file SVH tests cover selected configuration drift using fake transport. They do not establish hardware settings actually observed on a customer's hand or prove the YAML is the whole firmware state.

These two existing implementations were inspected for the follow-up; they were not rebuilt as new vendor drivers or subjected to another broad test campaign.

## Same action API, different runtime

The `same-api-new-runtime` CLI example keeps the endpoint, goal, plugins and selected topology unchanged while changing one selected driver runtime version. It returns `REVIEW_REQUIRED`, with `software` as the changed group. The generic runtime provenance contract already applies the same principle to lifecycle, resource, timing and failure semantics under an unchanged API.

This example is illustrative, not a Webots/Lyrical migration test. A compatibility envelope can replace exact version identity only when an integration explicitly defines and qualifies that envelope. An unchanged action signature or successful compilation does not supply that evidence.
