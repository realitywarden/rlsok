import { atPointer, type Path } from '../contracts';
import { finiteVector, poseVector } from './shared';

export function validateCartesianPose(path: Extract<Path, { adapter: 'cartesian_pose' }>, goal: Record<string, unknown>): string | null {
  const position = poseVector(goal, path.fields.position, ['x', 'y', 'z']);
  const orientation = poseVector(goal, path.fields.orientation, ['x', 'y', 'z', 'w']);
  if (!finiteVector(position, 3) || !finiteVector(orientation, 4)) return 'cartesian_pose_invalid';
  if (Math.abs(orientation.reduce((sum, v) => sum + v * v, 0) - 1) > 1e-6) return 'cartesian_quaternion_invalid';
  return atPointer(goal, path.fields.frame) === path.fields.expectedFrame ? null : 'cartesian_frame_mismatch';
}

export function validateCartesianDelta(path: Extract<Path, { adapter: 'cartesian_delta' }>, goal: Record<string, unknown>): string | null {
  const translation = path.fields.translation.map(pointer => atPointer(goal, pointer));
  const rotation = path.fields.rotation.map(pointer => atPointer(goal, pointer));
  const velocity = atPointer(goal, path.fields.velocity);
  if (!finiteVector(translation, 3) || !finiteVector(rotation, 3)) return 'cartesian_delta_invalid';
  if (translation.some(value => Math.abs(value) > path.fields.maxTranslationMm)) return 'cartesian_delta_translation_out_of_bounds';
  if (rotation.some(value => Math.abs(value) > path.fields.maxRotationDeg)) return 'cartesian_delta_rotation_out_of_bounds';
  if (typeof velocity !== 'number' || !Number.isFinite(velocity) || velocity <= 0 || velocity > path.fields.maxVelocityMmS) return 'cartesian_delta_velocity_invalid';
  return atPointer(goal, path.fields.frame) === path.fields.expectedFrame ? null : 'cartesian_delta_frame_mismatch';
}

export function validateCartesianAbsoluteWpr(path: Extract<Path, { adapter: 'cartesian_absolute_wpr' }>, goal: Record<string, unknown>): string | null {
  // Native absolute XYZ (mm) and FANUC W/P/R (degrees). Never reinterpret as
  // relative displacement, normalize angles, convert to a quaternion or send.
  const position = path.fields.position.map(pointer => atPointer(goal, pointer));
  const rotation = path.fields.rotation.map(pointer => atPointer(goal, pointer));
  const velocity = atPointer(goal, path.fields.velocity);
  if (!finiteVector(position, 3) || !finiteVector(rotation, 3)) return 'cartesian_absolute_wpr_pose_invalid';
  if (typeof velocity !== 'number' || !Number.isInteger(velocity) || velocity < 0 || velocity > 65535) return 'cartesian_absolute_wpr_velocity_invalid';
  const effectiveVelocity = velocity === 0 ? path.fields.defaultVelocityMmS : velocity;
  if (effectiveVelocity > path.fields.maxVelocityMmS) return 'cartesian_absolute_wpr_velocity_out_of_bounds';
  return atPointer(goal, path.fields.frame) === path.fields.expectedFrame ? null : 'cartesian_absolute_wpr_frame_mismatch';
}
