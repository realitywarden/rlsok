# Wearable dual Kinova status observer v1

This project-specific utility subscribes to the already-running wearable
rig's shared `/real/session_state` and `/real/joint_states` topics plus its
left and right telemetry topics. It requires the exact two public high-level
bridge node names, connected session messages for both arms, both telemetry
streams and seven selected joints per arm. The public mock launch does not
provide those session or telemetry paths and is rejected.

The observer creates subscriptions only. It does not open either arm's single
Kortex session, start bringup, publish a target, call a service, home an arm or
send a stop. Use it only while both arms are already running for the owner's
normal work. The result establishes that the selected dual real-bridge ROS
paths were live only when paired with the owner's physical-session
confirmation. It does not authenticate either arm or network peer, prove
motion safety, approve motion or establish acceptance.
