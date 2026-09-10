// These are mappings of public source, not customer deployments or endorsements.
export interface SourceRecipe {
  repository: string;
  referenceCommit: string;
  model: string;
  endpoint: string;
  interfaceType: string;
  subscriber?: string;
  joints?: string[];
  controllerState?: { name: string; type: string; claimedInterfaces: string[]; parameters: Record<string, string[]>; actionEndpoint?: string };
  files: string[];
  boundary: string;
}

export const sourceRecipes: Record<string, SourceRecipe> = {
  'xarm1s-moveit-arm': {
    repository: 'allProgramming/ros2_xarm_1s_demos', referenceCommit: '3836e35a61064af2810c7d6174b5d5e841b1bf7b',
    model: 'Public xArm 1S MoveIt five-axis arm configuration',
    endpoint: '/xarm_1s_arm_controller/follow_joint_trajectory', interfaceType: 'control_msgs/action/FollowJointTrajectory',
    joints: ['arm6', 'arm5', 'arm4', 'arm3', 'arm2'],
    controllerState: { name: 'xarm_1s_arm_controller', type: 'joint_trajectory_controller/JointTrajectoryController',
      actionEndpoint: '/xarm_1s_arm_controller/follow_joint_trajectory',
      claimedInterfaces: ['arm6', 'arm5', 'arm4', 'arm3', 'arm2'].map(j => `${j}/position`),
      parameters: { joints: ['arm6', 'arm5', 'arm4', 'arm3', 'arm2'], command_interfaces: ['position'] } },
    files: ['ros2_ws/src/xarm_1s_moveit_config/config/ros2_controllers.yaml',
      'ros2_ws/src/xarm_1s_moveit_config/config/moveit_controllers.yaml',
      'ros2_ws/src/xarm_1s_moveit_config/config/xarm_1s.ros2_control.xacro',
      'ros2_ws/src/xarm_1s_description/urdf/xarm_1s.urdf.xacro',
      'ros2_ws/src/ros2_control_xarm_1s/src/xarm_1s.cpp'],
    boundary: 'Public MoveIt arm action only; hand_controller/arm1 is separate. The same repository also has a distinct six-joint bare ros2_control configuration, which this recipe does not map. Current hardware/environment availability is unknown.'
  },
  'parol6-arm': {
    repository: 'grahas/parol6_ros2_control', referenceCommit: 'c111b97d5afd00b9b04d593bb11ab52ba67dc6cd',
    model: 'Public PAROL6 trajectory input', endpoint: '/parol6_arm_controller/follow_joint_trajectory', interfaceType: 'control_msgs/action/FollowJointTrajectory',
    joints: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'],
    controllerState: { name: 'parol6_arm_controller', type: 'joint_trajectory_controller/JointTrajectoryController',
      actionEndpoint: '/parol6_arm_controller/follow_joint_trajectory',
      claimedInterfaces: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map(j => `${j}/position`),
      parameters: { joints: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'], command_interfaces: ['position'] } },
    files: ['parol6_bringup/config/parol6_controllers.yaml', 'parol6_bringup/launch/parol6_control.launch.py',
      'parol6_bringup/urdf/parol6.ros2_control.xacro', 'parol6_bringup/urdf/parol6_with_tools.xacro',
      'parol6_hardware_interface/src/parol6_system_interface.cpp', 'parol6_hardware_interface/src/bridge_client.cpp',
      'parol6_bridge/parol6_bridge/bridge_node.py', 'parol6_bridge/parol6_bridge/protocol.py'],
    boundary: 'ROS trajectory action to parol6_arm_controller. The hardware write -> local TCP bridge -> robot server path is documented, not intercepted or authenticated. Do not launch the physical bridge for discovery.'
  },
  'kinova-gen3-7dof': {
    repository: 'Kinovarobotics/ros2_kortex', referenceCommit: '462dab9aa4732d733be55e1846530dd920c7c7d3',
    model: 'Public Kortex Jazzy Gen3 seven-axis trajectory input, no prefix',
    endpoint: '/joint_trajectory_controller/follow_joint_trajectory', interfaceType: 'control_msgs/action/FollowJointTrajectory',
    joints: ['joint_1', 'joint_2', 'joint_3', 'joint_4', 'joint_5', 'joint_6', 'joint_7'],
    controllerState: { name: 'joint_trajectory_controller', type: 'joint_trajectory_controller/JointTrajectoryController',
      actionEndpoint: '/joint_trajectory_controller/follow_joint_trajectory',
      claimedInterfaces: Array.from({length: 7}, (_, i) => `joint_${i + 1}/position`),
      parameters: { joints: ['joint_1', 'joint_2', 'joint_3', 'joint_4', 'joint_5', 'joint_6', 'joint_7'], command_interfaces: ['position'] } },
    files: ['kortex_description/arms/gen3/7dof/config/ros2_controllers.yaml',
      'kortex_description/arms/gen3/7dof/urdf/kortex.ros2_control.xacro',
      'kortex_bringup/launch/kortex_control.launch.py', 'kortex_bringup/launch/kortex_sim_control.launch.py',
      'kortex_driver/src/hardware_interface.cpp'],
    boundary: 'Prototype for the unprefixed seven-joint trajectory action before ros2_control software state. Shadow is a parallel evaluator, not a gate in Kortex write(). Direct JointTrajectory topics, velocity/Twist controllers, gripper and direct Kortex API calls are separate paths. No physical Gen3 compatibility claim.'
  },
  'hexapod-gait': {
    repository: 'ariegweomamerie/hexapod_ros2', referenceCommit: '656eebab5587977a1f41d44657cb853433927053',
    model: 'Public hexapod Gazebo gait input', endpoint: '/cmd_vel', interfaceType: 'geometry_msgs/msg/Twist', subscriber: 'hexapod_gait',
    files: ['src/hexapod_gait/hexapod_gait/gait_node.py', 'src/hexapod_gait/hexapod_gait/kinematics.py',
      'src/hexapod_gait/launch/gait.launch.py', 'src/Hexapod_Robot_description/config/controllers.yaml',
      'src/Hexapod_Robot_description/launch/gazebo.launch.py'],
    boundary: 'Twist input to the gait node. Downstream IK, JointTrajectory output and physical safety are outside this check.'
  },
  'so101-arm': {
    repository: 'adoodevv/so101_ros2', referenceCommit: '0305e03ab54e64aae9263fcbf339622e654012f3',
    model: 'Public SO-101 ROS 2 simulation arm', endpoint: '/arm_controller/follow_joint_trajectory', interfaceType: 'control_msgs/action/FollowJointTrajectory',
    joints: ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'],
    controllerState: { name: 'arm_controller', type: 'joint_trajectory_controller/JointTrajectoryController',
      actionEndpoint: '/arm_controller/follow_joint_trajectory',
      claimedInterfaces: ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'].map(joint => `${joint}/position`),
      parameters: { joints: ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'], command_interfaces: ['position'] } },
    files: ['so101_moveit_config/config/so101/ros2_controllers.yaml', 'so101_moveit_config/config/so101/moveit_controllers.yaml',
      'so101_moveit_config/config/so101/joint_limits.yaml', 'so101_moveit_config/config/so101/initial_positions.yaml',
      'so101_moveit_config/launch/load_ros2_controllers.launch.py', 'so101_bringup/launch/so101_gazebo_moveit.launch.py',
      'so101_gazebo/launch/so101.gazebo.launch.py'],
    boundary: 'Five-joint ROS 2 FollowJointTrajectory arm input. Gripper, direct JointTrajectory topics and LeRobot serial teleoperation are separate paths.'
  },
  'trik-drive': {
    repository: 'krranky/trik_ros2_control', referenceCommit: 'd6ac6cad28a6596317b6b7e6f45372145ec8c601',
    model: 'Public TRIK differential-drive input', endpoint: '/cmd_vel', interfaceType: 'geometry_msgs/msg/TwistStamped', subscriber: 'diff_drive_controller',
    controllerState: { name: 'diff_drive_controller', type: 'diff_drive_controller/DiffDriveController',
      claimedInterfaces: ['base_left_wheel_joint/velocity', 'base_right_wheel_joint/velocity'],
      parameters: { left_wheel_names: ['base_left_wheel_joint'], right_wheel_names: ['base_right_wheel_joint'] } },
    files: ['src/trik_bringup/config/trik_controllers.yaml', 'src/trik_bringup/launch/trik.launch.py',
      'src/trik_description/urdf/trik.ros2_control.xacro', 'src/trik_hardware/src/trik_system.cpp', 'trik_brick/trik_socket_server.py'],
    boundary: 'Remapped TwistStamped input to diff_drive_controller. Local source files do not attest the active TCP peer, flashed brick code or wheel calibration.'
  },
  'lely-velocity': {
    repository: 'tomo1000cmd/Lelyrobot', referenceCommit: '3e286c14f21db5f14d49e9ceb1b54e7e80fafb85',
    model: 'Public LelyRobot Python bridge input', endpoint: '/cmd_vel', interfaceType: 'geometry_msgs/msg/Twist', subscriber: 'arduino_bridge',
    files: ['src/lelyrobot/package.xml', 'src/lelyrobot/setup.py', 'src/lelyrobot/launch/bringup.launch.py',
      'src/lelyrobot/lelyrobot/arduino_bridge.py', 'src/lelyrobot/lelyrobot/cmd_vel_mux.py', 'src/lelyrobot/lelyrobot/avoidance_node.py'],
    boundary: 'Twist input to the default ament_python Arduino bridge. The alternative C++ bridge has different scaling and requires a separate reviewed mapping. Serial writes and active firmware are not attested.'
  },
  'rover-gazebo': {
    repository: 'skunal3318/ROS2-Autonomous-Rover', referenceCommit: '1384dbbcb9daaeabfcede0904c202521c51e27ca',
    model: 'Public autonomous rover Gazebo bridge input', endpoint: '/cmd_vel', interfaceType: 'geometry_msgs/msg/Twist',
    files: ['src/rover_bringup/launch/rover.launch.xml', 'src/rover_bringup/config/gazebo_bridge.yaml',
      'src/rover_control/rover_control/obstacle_avoidance.py', 'src/rover_control/rover_control/cmd_vel_switch.py'],
    boundary: 'ROS Twist input to the Gazebo bridge for /model/autonomous_rover/cmd_vel. Select the actual bridge node from discovery; the launch does not fix its node name. FSM behavior and Gazebo-side delivery are not proven.'
  }
};
