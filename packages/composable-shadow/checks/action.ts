import { atPointer, type Path, type Profile } from '../contracts';
import { finiteVector } from './shared';

export function validateProgram(path: Extract<Path, { adapter: 'tp_program' }>, goal: Record<string, unknown>): string | null {
  const program = atPointer(goal, path.fields.program);
  return typeof program === 'string' && path.fields.allowedPrograms.includes(program) ? null : 'program_not_allowlisted';
}

export function validateTrajectory(profile: Profile, path: Extract<Path, { adapter: 'joint_trajectory' }>, goal: Record<string, unknown>): string | null {
  const names = atPointer(goal, path.fields.jointNames);
  if (!Array.isArray(names) || names.length !== profile.jointOrder.length || names.some((name, index) => name !== profile.jointOrder[index])) return 'trajectory_joint_order_mismatch';
  const points = atPointer(goal, path.fields.points);
  if (!Array.isArray(points) || points.length < 1 || points.length > 10000) return 'trajectory_points_invalid';
  let previous = -1;
  for (const point of points) {
    if (!point || typeof point !== 'object' || !finiteVector(point.positions, profile.jointOrder.length)) return 'trajectory_positions_invalid';
    for (const field of ['velocities', 'accelerations', 'effort']) {
      if (point[field] !== undefined && (!Array.isArray(point[field]) || (point[field].length !== 0 && !finiteVector(point[field], profile.jointOrder.length)))) return 'trajectory_optional_vector_invalid';
    }
    const duration = point.time_from_start;
    if (!duration || !Number.isSafeInteger(duration.sec) || duration.sec < 0 || !Number.isInteger(duration.nanosec) || duration.nanosec < 0 || duration.nanosec >= 1e9) return 'trajectory_time_invalid';
    const current = duration.sec * 1e9 + duration.nanosec;
    if (!Number.isSafeInteger(current) || current <= previous) return 'trajectory_time_not_increasing';
    previous = current;
  }
  return null;
}
