# reBot Arm B601-RS status observer v1

This project-specific utility subscribes to the real controller's
`/rebotarm/joint_states` and `/rebotarm/arm_status` topics. It requires the
unique publisher of both topics to be `/reBotArmController`, rejecting the
public fake-driver node, and records the six B601-RS arm joints, controller
mode, enable/control-loop flags, state machine, status codes and errors.

The observer creates subscriptions only. It does not open SocketCAN, start
bringup, publish a command, call a service, enable the arm or send a stop.
Use it only when the owner's physical arm is already running for normal work.
The result establishes an owner-run selected ROS state path only when paired
with the owner's physical-session confirmation. It does not authenticate the
arm or CAN peers, prove motor safety, approve motion or establish acceptance.
