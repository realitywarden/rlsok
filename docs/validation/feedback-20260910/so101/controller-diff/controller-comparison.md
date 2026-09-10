# Controller configuration comparison

Configuration changed.

Baseline: 2026-09-10T06:55:41.171Z

Changed: 2026-09-10T06:56:25.901Z

Historical, self-attested ROS software exports. No approval, motion command, hardware attestation or freshness decision is produced.

## controller

Before:

    {
      "name": "arm_controller",
      "state": "active",
      "type": "joint_trajectory_controller/JointTrajectoryController",
      "claimed_interfaces": [
        "shoulder_pan/position",
        "shoulder_lift/position",
        "elbow_flex/position",
        "wrist_flex/position",
        "wrist_roll/position"
      ],
      "is_async": false,
      "update_rate": 100,
      "required_command_interfaces": [
        "shoulder_pan/position",
        "shoulder_lift/position",
        "elbow_flex/position",
        "wrist_flex/position",
        "wrist_roll/position"
      ],
      "required_state_interfaces": [
        "shoulder_pan/position",
        "shoulder_lift/position",
        "elbow_flex/position",
        "wrist_flex/position",
        "wrist_roll/position"
      ],
      "is_chainable": false,
      "is_chained": false,
      "exported_state_interfaces": [],
      "reference_interfaces": [],
      "chain_connections": []
    }

After:

    {
      "name": "arm_controller",
      "state": "active",
      "type": "position_controllers/JointGroupPositionController",
      "claimed_interfaces": [
        "shoulder_pan/position",
        "shoulder_lift/position",
        "elbow_flex/position",
        "wrist_flex/position",
        "wrist_roll/position"
      ],
      "is_async": false,
      "update_rate": 100,
      "required_command_interfaces": [
        "shoulder_pan/position",
        "shoulder_lift/position",
        "elbow_flex/position",
        "wrist_flex/position",
        "wrist_roll/position"
      ],
      "required_state_interfaces": [],
      "is_chainable": false,
      "is_chained": false,
      "exported_state_interfaces": [],
      "reference_interfaces": [],
      "chain_connections": []
    }

## action-endpoints

Before:

    [
      {
        "endpoint": "/arm_controller/follow_joint_trajectory",
        "type": "control_msgs/action/FollowJointTrajectory"
      }
    ]

After:

    []

## parameter:action_monitor_rate

Before:

    {
      "type": 3,
      "value": "20.0"
    }

After:

    null

## parameter:allow_integration_in_goal_trajectories

Before:

    {
      "type": 1,
      "value": true
    }

After:

    null

## parameter:allow_nonzero_velocity_at_trajectory_end

Before:

    {
      "type": 1,
      "value": true
    }

After:

    null

## parameter:allow_partial_joints_goal

Before:

    {
      "type": 1,
      "value": false
    }

After:

    null

## parameter:cmd_timeout

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:command_interfaces

Before:

    {
      "type": 9,
      "value": [
        "position"
      ]
    }

After:

    null

## parameter:command_joints

Before:

    {
      "type": 9,
      "value": []
    }

After:

    null

## parameter:constraints.decelerate_on_cancel

Before:

    {
      "type": 1,
      "value": false
    }

After:

    null

## parameter:constraints.elbow_flex.goal

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.elbow_flex.max_deceleration_on_cancel

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.elbow_flex.trajectory

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.goal_time

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.shoulder_lift.goal

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.shoulder_lift.max_deceleration_on_cancel

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.shoulder_lift.trajectory

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.shoulder_pan.goal

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.shoulder_pan.max_deceleration_on_cancel

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.shoulder_pan.trajectory

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.stopped_velocity_tolerance

Before:

    {
      "type": 3,
      "value": "0.01"
    }

After:

    null

## parameter:constraints.wrist_flex.goal

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.wrist_flex.max_deceleration_on_cancel

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.wrist_flex.trajectory

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.wrist_roll.goal

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.wrist_roll.max_deceleration_on_cancel

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:constraints.wrist_roll.trajectory

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.elbow_flex.antiwindup_strategy

Before:

    {
      "type": 4,
      "value": "legacy"
    }

After:

    null

## parameter:gains.elbow_flex.d

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.elbow_flex.error_deadband

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.elbow_flex.ff_velocity_scale

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.elbow_flex.i

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.elbow_flex.i_clamp

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.elbow_flex.i_clamp_max

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.elbow_flex.i_clamp_min

Before:

    {
      "type": 3,
      "value": "-inf"
    }

After:

    null

## parameter:gains.elbow_flex.p

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.elbow_flex.tracking_time_constant

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.elbow_flex.u_clamp_max

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.elbow_flex.u_clamp_min

Before:

    {
      "type": 3,
      "value": "-inf"
    }

After:

    null

## parameter:gains.shoulder_lift.antiwindup_strategy

Before:

    {
      "type": 4,
      "value": "legacy"
    }

After:

    null

## parameter:gains.shoulder_lift.d

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_lift.error_deadband

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_lift.ff_velocity_scale

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_lift.i

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_lift.i_clamp

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.shoulder_lift.i_clamp_max

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.shoulder_lift.i_clamp_min

Before:

    {
      "type": 3,
      "value": "-inf"
    }

After:

    null

## parameter:gains.shoulder_lift.p

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_lift.tracking_time_constant

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_lift.u_clamp_max

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.shoulder_lift.u_clamp_min

Before:

    {
      "type": 3,
      "value": "-inf"
    }

After:

    null

## parameter:gains.shoulder_pan.antiwindup_strategy

Before:

    {
      "type": 4,
      "value": "legacy"
    }

After:

    null

## parameter:gains.shoulder_pan.d

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_pan.error_deadband

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_pan.ff_velocity_scale

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_pan.i

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_pan.i_clamp

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.shoulder_pan.i_clamp_max

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.shoulder_pan.i_clamp_min

Before:

    {
      "type": 3,
      "value": "-inf"
    }

After:

    null

## parameter:gains.shoulder_pan.p

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_pan.tracking_time_constant

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.shoulder_pan.u_clamp_max

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.shoulder_pan.u_clamp_min

Before:

    {
      "type": 3,
      "value": "-inf"
    }

After:

    null

## parameter:gains.wrist_flex.antiwindup_strategy

Before:

    {
      "type": 4,
      "value": "legacy"
    }

After:

    null

## parameter:gains.wrist_flex.d

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_flex.error_deadband

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_flex.ff_velocity_scale

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_flex.i

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_flex.i_clamp

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.wrist_flex.i_clamp_max

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.wrist_flex.i_clamp_min

Before:

    {
      "type": 3,
      "value": "-inf"
    }

After:

    null

## parameter:gains.wrist_flex.p

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_flex.tracking_time_constant

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_flex.u_clamp_max

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.wrist_flex.u_clamp_min

Before:

    {
      "type": 3,
      "value": "-inf"
    }

After:

    null

## parameter:gains.wrist_roll.antiwindup_strategy

Before:

    {
      "type": 4,
      "value": "legacy"
    }

After:

    null

## parameter:gains.wrist_roll.d

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_roll.error_deadband

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_roll.ff_velocity_scale

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_roll.i

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_roll.i_clamp

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.wrist_roll.i_clamp_max

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.wrist_roll.i_clamp_min

Before:

    {
      "type": 3,
      "value": "-inf"
    }

After:

    null

## parameter:gains.wrist_roll.p

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_roll.tracking_time_constant

Before:

    {
      "type": 3,
      "value": "0.0"
    }

After:

    null

## parameter:gains.wrist_roll.u_clamp_max

Before:

    {
      "type": 3,
      "value": "inf"
    }

After:

    null

## parameter:gains.wrist_roll.u_clamp_min

Before:

    {
      "type": 3,
      "value": "-inf"
    }

After:

    null

## parameter:interface_name

Before:

    null

After:

    {
      "type": 4,
      "value": "position"
    }

## parameter:interpolate_from_desired_state

Before:

    {
      "type": 1,
      "value": false
    }

After:

    null

## parameter:interpolation_method

Before:

    {
      "type": 4,
      "value": "splines"
    }

After:

    null

## parameter:open_loop_control

Before:

    {
      "type": 1,
      "value": false
    }

After:

    null

## parameter:set_last_command_interface_value_as_state_on_activation

Before:

    {
      "type": 1,
      "value": true
    }

After:

    null

## parameter:speed_scaling.command_interface

Before:

    {
      "type": 4,
      "value": ""
    }

After:

    null

## parameter:speed_scaling.initial_scaling_factor

Before:

    {
      "type": 3,
      "value": "1.0"
    }

After:

    null

## parameter:speed_scaling.state_interface

Before:

    {
      "type": 4,
      "value": ""
    }

After:

    null

## parameter:state_interfaces

Before:

    {
      "type": 9,
      "value": [
        "position"
      ]
    }

After:

    null
