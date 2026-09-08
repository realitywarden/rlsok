import { atPointer, type Profile, type Path } from './contracts';

const finiteVector = (value: unknown, size: number): value is number[] =>
  Array.isArray(value) && value.length === size && value.every(n => typeof n === 'number' && Number.isFinite(n));

function poseVector(goal: Record<string, unknown>, mapping: string | string[], keys: string[]): unknown {
  if (Array.isArray(mapping)) return mapping.map(pointer => atPointer(goal, pointer));
  const value = atPointer(goal, mapping);
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Object.keys(value).length === keys.length &&
      keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) {
    return keys.map(key => (value as Record<string, unknown>)[key]);
  }
  return undefined;
}

export function validateGoal(p: Profile, path: Path, goal: Record<string, unknown>): string | null {
  if (path.adapter === 'topic_twist') {
    const linear = poseVector(goal, path.fields.linear, ['x', 'y', 'z']);
    const angular = poseVector(goal, path.fields.angular, ['x', 'y', 'z']);
    if (!finiteVector(linear, 3) || !finiteVector(angular, 3)) return 'twist_vectors_invalid';
    if (path.messageType === 'geometry_msgs/msg/TwistStamped') {
      if (atPointer(goal, '/header/frame_id') !== path.commandFrame) return 'twist_frame_mismatch';
      const stamp = atPointer(goal, '/header/stamp') as { sec?: unknown; nanosec?: unknown } | undefined;
      if (!stamp || !Number.isInteger(stamp.sec) || Number(stamp.sec) < 0 || Number(stamp.sec) > 2147483647 ||
          !Number.isInteger(stamp.nanosec) || Number(stamp.nanosec) < 0 || Number(stamp.nanosec) >= 1e9) return 'twist_stamp_invalid';
    }
    return null;
  }
  if (path.adapter === 'tp_program') {
    const program = atPointer(goal, path.fields.program);
    return typeof program === 'string' && path.fields.allowedPrograms.includes(program) ? null : 'program_not_allowlisted';
  }
  if (path.adapter === 'cartesian_pose') {
    const position = poseVector(goal, path.fields.position, ['x', 'y', 'z']);
    const orientation = poseVector(goal, path.fields.orientation, ['x', 'y', 'z', 'w']);
    if (!finiteVector(position, 3) || !finiteVector(orientation, 4)) return 'cartesian_pose_invalid';
    if (Math.abs(orientation.reduce((sum, v) => sum + v * v, 0) - 1) > 1e-6) return 'cartesian_quaternion_invalid';
    return atPointer(goal, path.fields.frame) === path.fields.expectedFrame ? null : 'cartesian_frame_mismatch';
  }
  if (path.adapter === 'cartesian_delta') {
    const translation = path.fields.translation.map(pointer => atPointer(goal, pointer));
    const rotation = path.fields.rotation.map(pointer => atPointer(goal, pointer));
    const velocity = atPointer(goal, path.fields.velocity);
    if (!finiteVector(translation, 3) || !finiteVector(rotation, 3)) return 'cartesian_delta_invalid';
    if (translation.some(value => Math.abs(value) > path.fields.maxTranslationMm)) return 'cartesian_delta_translation_out_of_bounds';
    if (rotation.some(value => Math.abs(value) > path.fields.maxRotationDeg)) return 'cartesian_delta_rotation_out_of_bounds';
    if (typeof velocity !== 'number' || !Number.isFinite(velocity) || velocity <= 0 || velocity > path.fields.maxVelocityMmS) return 'cartesian_delta_velocity_invalid';
    return atPointer(goal, path.fields.frame) === path.fields.expectedFrame ? null : 'cartesian_delta_frame_mismatch';
  }
  const names = atPointer(goal, path.fields.jointNames);
  if (!Array.isArray(names) || names.length !== p.jointOrder.length || names.some((name, index) => name !== p.jointOrder[index])) return 'trajectory_joint_order_mismatch';
  const points = atPointer(goal, path.fields.points);
  if (!Array.isArray(points) || points.length < 1 || points.length > 10000) return 'trajectory_points_invalid';
  let previous = -1;
  for (const point of points) {
    if (!point || typeof point !== 'object' || !finiteVector(point.positions, p.jointOrder.length)) return 'trajectory_positions_invalid';
    for (const field of ['velocities', 'accelerations', 'effort']) {
      if (point[field] !== undefined && (!Array.isArray(point[field]) || (point[field].length !== 0 && !finiteVector(point[field], p.jointOrder.length)))) return 'trajectory_optional_vector_invalid';
    }
    const duration = point.time_from_start;
    if (!duration || !Number.isSafeInteger(duration.sec) || duration.sec < 0 || !Number.isInteger(duration.nanosec) || duration.nanosec < 0 || duration.nanosec >= 1e9) return 'trajectory_time_invalid';
    const current = duration.sec * 1e9 + duration.nanosec;
    if (!Number.isSafeInteger(current) || current <= previous) return 'trajectory_time_not_increasing';
    previous = current;
  }
  return null;
}
