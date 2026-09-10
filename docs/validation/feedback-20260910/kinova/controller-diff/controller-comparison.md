# Controller configuration comparison

Configuration changed.

Baseline: 2026-09-10T06:56:54.831Z

Changed: 2026-09-10T06:57:21.931Z

Historical, self-attested ROS software exports. No approval, motion command, hardware attestation or freshness decision is produced.

## controller

Before:

    {
      "name": "joint_trajectory_controller",
      "state": "active",
      "type": "joint_trajectory_controller/JointTrajectoryController",
      "claimed_interfaces": [
        "joint_1/position",
        "joint_2/position",
        "joint_3/position",
        "joint_4/position",
        "joint_5/position",
        "joint_6/position",
        "joint_7/position"
      ],
      "is_async": false,
      "update_rate": 1000,
      "required_command_interfaces": [
        "joint_1/position",
        "joint_2/position",
        "joint_3/position",
        "joint_4/position",
        "joint_5/position",
        "joint_6/position",
        "joint_7/position"
      ],
      "required_state_interfaces": [
        "joint_1/position",
        "joint_1/velocity",
        "joint_2/position",
        "joint_2/velocity",
        "joint_3/position",
        "joint_3/velocity",
        "joint_4/position",
        "joint_4/velocity",
        "joint_5/position",
        "joint_5/velocity",
        "joint_6/position",
        "joint_6/velocity",
        "joint_7/position",
        "joint_7/velocity"
      ],
      "is_chainable": false,
      "is_chained": false,
      "exported_state_interfaces": [],
      "reference_interfaces": [],
      "chain_connections": []
    }

After:

    {
      "name": "joint_trajectory_controller",
      "state": "inactive",
      "type": "joint_trajectory_controller/JointTrajectoryController",
      "claimed_interfaces": [],
      "is_async": false,
      "update_rate": 1000,
      "required_command_interfaces": [
        "joint_1/position",
        "joint_2/position",
        "joint_3/position",
        "joint_4/position",
        "joint_5/position",
        "joint_6/position",
        "joint_7/position"
      ],
      "required_state_interfaces": [
        "joint_1/position",
        "joint_1/velocity",
        "joint_2/position",
        "joint_2/velocity",
        "joint_3/position",
        "joint_3/velocity",
        "joint_4/position",
        "joint_4/velocity",
        "joint_5/position",
        "joint_5/velocity",
        "joint_6/position",
        "joint_6/velocity",
        "joint_7/position",
        "joint_7/velocity"
      ],
      "is_chainable": false,
      "is_chained": false,
      "exported_state_interfaces": [],
      "reference_interfaces": [],
      "chain_connections": []
    }
