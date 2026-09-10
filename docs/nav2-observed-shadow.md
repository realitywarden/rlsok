# Nav2: review an observed graph and the exact goal before a Shadow handoff

This evaluation reads running ROS 2 Jazzy nodes. It is intended for an isolated software graph first. It does not create a ROS action client, publish velocity commands, install a hardware driver or intercept another application's dispatch. `WOULD_ALLOW` records the exact reviewed goal in a local file; it grants no robot execution permission.

The initial supported graph uses Nav2 1.3.12, `controller_server → velocity_smoother → optional collision_monitor → selected base subscriber`. The base in the supplied experiment is an explicit Python software fixture. The record identifies it as such. The same manifest format can select another existing local graph for review, but its actual implementation and physical command paths require the operator's separate validation.

## Review and check

Source your existing Jazzy installation and use the Linux evaluation bundle's `bin/rlsok`, or the built checkout CLI. Start no physical driver for this first experiment. Supply a manifest with the selected absolute node names, actual remapped command topics, command message type, installed packages and `/follow_path` endpoint. The experiment writes a complete example manifest and a two-pose Goal into its output directory.

```sh
rlsok profile capture-nav2 --manifest manifest.json --output baseline-observation.json
rlsok profile approve-nav2 --observation baseline-observation.json --goal goal.json \
  --actor YOUR_LOCAL_REVIEWER --expires-at YOUR_RFC3339_EXPIRY --output approval.json
rlsok profile shadow-nav2 --manifest manifest.json --approval approval.json \
  --goal goal.json --output first-check
```

Review the selected parameters, graph, software association and exact Goal before creating the local approval. Approval requires an observation that started within the last 30 seconds; expiry must be in the next 24 hours. This is an inspectable local approval, not a signed Cloud or vendor authorization. Do not edit observation timestamps or silently replace the approval after a change.

`shadow-nav2` captures a new observation during that invocation. It binds the three selectors supported by the installed Jazzy FollowPath IDL: `controller_id`, `goal_checker_id`, `progress_checker_id`. Selectors must be explicit and loaded. The entire Path, including frames, stamps and every pose, is checked. A different path or selector needs its own explicit review. It is not enough that both plugins were loaded at approval time. `path_handler_id` is not in this Jazzy interface and is rejected. A syntactically valid Path is not a geometric or collision-free-path certification.

On a match, `shadow-handoff.json` contains a detached, deeply frozen copy of precisely that goal. On a rejected check, that file is absent and `report.json` records why. Goal mutation while the read is in progress, expired or modified approval, replayed observations, incomplete capture and capture timeout all block before the Shadow sink. There is no live robot transport behind the sink.

## What is observed and bound

- Two bounded passes read parameters, lifecycle state, the action server and command-topic endpoint metadata. Conflicting passes fail. Every selected Nav2 stage must be active; exactly one selected publisher/subscriber must connect each edge, without another visible publisher on the selected command input. Extra Twist/TwistStamped subscriptions at the selected base expose an observed bypass. Topic type, QoS compatibility and endpoint identifiers are checked. A restarted endpoint requires review even if its name is unchanged.
- Smoother feedback, scale, frequency, timeout, deadband and all limit vectors participate in the comparison. The snapshot also conservatively fingerprints the nodes' typed parameter records, including optional configuration. The observer preserves the known uninitialized deprecated collision-monitor `max_points` state when the `min_points` alternative is declared; it does not invent a limit. Other unavailable selected parameters fail capture.
- CLOSED_LOOP also requires the actual smoother subscription, a unique visible odometry publisher, topic, duration and observed parent/child frames. The current velocity sample is recorded as volatile and excluded from approval hashes. OPEN_LOOP uses commanded velocity as its reference; this provides no measured physical envelope.
- Loaded plugin IDs, implementation names and parameters are bound, as is the recursively described installed FollowPath interface. Installed package metadata and manifest associations are local declarations about node provenance, not authentication of a remote binary.

ROS metadata is not an atomic lock on the execution system. The two passes can detect an observed change but cannot prevent changes after the last read, detect a change that reverts between both samples, discover private non-ROS bypasses or authenticate a malicious DDS participant. The collision monitor's selected configuration and path are observed; this does not certify the current scan data, effective physical stopping distance or the safety of a robot. Use these results to review integration, not as a functional-safety or cybersecurity certificate.

## Reproduce only this graph experiment

The explicit experiment needs Linux network namespaces, installed Jazzy Nav2 controller, velocity smoother, collision monitor and DWB plugins, plus the existing ROS Python and TF dependencies. It refuses a namespace with interfaces other than loopback. Its only publications are software odometry and static transforms; a temporary Twist publisher is created as a negative-case endpoint but never publishes a message.

```sh
bash experimental/composable-shadow/run_nav2_graph_experiment.sh \
  /absolute/path/to/built/rlsok /absolute/path/to/linux/node /absolute/new/output-directory
```

This script runs the listed feedback cases only. It changes parameters/lifecycle of the Nav2 processes it creates in its private network namespace, writes observations and per-case reports, and stops those processes on exit. It is not a full Nav2 test suite. The default mode uses the explicit software base. Add `--gazebo` to run the core cases against a ROS-GZ bridge and an actual Gazebo DiffDrive model instead; that mode requires observed Gazebo odometry and records the Gazebo command-topic publisher/subscriber metadata. Neither mode claims customer hardware use. Inspect the output's summary and the actual per-case reasons; a generic failure alone does not establish the intended negative case.

Source references for the installed version: [FollowPath IDL](https://github.com/ros-navigation/navigation2/blob/1.3.12/nav2_msgs/action/FollowPath.action), [smoother semantics](https://github.com/ros-navigation/navigation2/blob/1.3.12/nav2_velocity_smoother/src/velocity_smoother.cpp), [collision-monitor polygon configuration](https://github.com/ros-navigation/navigation2/blob/1.3.12/nav2_collision_monitor/src/polygon.cpp).
