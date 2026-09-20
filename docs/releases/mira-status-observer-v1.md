# RLSOK MIRA status observer v1

This separate robot-integration utility captures one read-only PX4
`VehicleStatus` observation from an already running, disarmed MIRA ROS 2 graph.
It packages the exact collector, its focused offline test and the small shared
Python modules it imports; no npm build is required.

The observer creates one subscription and has no publisher or service-client
surface. Focused offline checks cover the selected output, ambiguous-publisher
rejection, incomplete-status rejection and absence of command/service APIs.
They do not constitute a ROS, Pixhawk or physical-robot run.

This release is not a Windows or macOS Local Check update and does not change
those update feeds. It requires the owner's existing ROS 2 environment and
installed `px4_msgs` definition. A visible topic is not authenticated vehicle
identity, flight readiness, motion authorization or customer acceptance.
