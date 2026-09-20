# Technical contributors and reviewers

RLSOK thanks the people below for technical contributions or review feedback.
Every person listed here explicitly opted in to public attribution.

Attribution describes the contribution only. It does not imply endorsement,
partnership, customer status, official support, vendor certification, or an
organization relationship. No logos are used.

- [Xiaoyang](https://github.com/xiao-yang25) — Reviewed DDS command-path trust,
  path-scoped failure behavior, and the distinction between authenticated
  evidence and raw ROS graph identity.
- Laurentiu Popa — Provided technical review feedback on RLSOK.
- [Ruddrho Mollik](https://github.com/ruddrho/ros2-vision-guided-robot-arm-color-sorting-robot)
  — A ROS 2 Vision-Guided Pick-and-Place Robotic Arm. Provided architecture
  feedback on selecting camera calibration, robot-camera transforms, workcell
  setup, and object/bin mapping as execution-relevant inputs.
- [Aditya Jindal](https://github.com/AdityaJindal07) — Independent contributor.
  Provided lifecycle ERROR/FAILURE continuity feedback on requiring fresh
  execution authority after invalidating internal state.
- [Bartosz Burda](https://github.com/selfpatch/ros2_medkit) — selfpatch.ai /
  ros2_medkit. Provided architecture feedback on separating fault/degradation
  ownership from execution authorization and consuming available capabilities
  at that boundary. Independent feedback; no endorsement, integration, or
  support relationship implied.
- [Atsushi Kuwagata](https://rt-net.jp) — RT Corporation. Clarified the
  distinct roles of URDF hardware limits, MoveIt planning constraints,
  ros2_control drive limits, and live encoder/controller posture, helping avoid
  blindly binding all sources into one execution identity.
- [Rune Søe-Knudsen](https://www.universal-robots.com/) — Universal Robots.
  Provided technical review and clarification regarding Universal Robots ROS 2
  driver speed-scaling behavior and the scaled trajectory controller. This
  attribution should not be interpreted as an endorsement by either Rune
  Søe-Knudsen or Universal Robots.

The machine-readable source of truth is
[`docs/technical-contributors.json`](docs/technical-contributors.json). Add a
person only after explicit opt-in, and include only their requested display
name, factual contribution, and preferred public URL if one was supplied.
