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
