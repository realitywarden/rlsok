import { atPointer, topicFieldRuleSchema, type Path } from '../contracts';
import { z } from 'zod';
import { finiteVector, poseVector } from './shared';

export function validateScalarFieldRules(rules: Array<z.infer<typeof topicFieldRuleSchema>>, goal: Record<string, unknown>, prefix: string): string | null {
  for (const rule of rules) {
    const value = atPointer(goal, rule.pointer);
    if (typeof value !== (rule.type === 'integer' ? 'number' : rule.type) ||
      (rule.type === 'integer' && !Number.isSafeInteger(value)) ||
      (rule.type === 'number' && !Number.isFinite(value))) return `${prefix}_type_invalid:${rule.pointer}`;
    if (typeof value === 'number' && (rule.minimum !== undefined && value < rule.minimum || rule.maximum !== undefined && value > rule.maximum))
      return `${prefix}_out_of_bounds:${rule.pointer}`;
    if (rule.allowed && !rule.allowed.includes(value as string | number | boolean)) return `${prefix}_not_allowlisted:${rule.pointer}`;
  }
  return null;
}

export function validateTopicFields(path: Extract<Path, { adapter: 'topic_fields' | 'action_fields' }>, goal: Record<string, unknown>): string | null {
  return validateScalarFieldRules(path.fields.rules, goal, path.adapter === 'action_fields' ? 'action_field' : 'topic_field');
}

export function validateTopicTwist(path: Extract<Path, { adapter: 'topic_twist' }>, goal: Record<string, unknown>): string | null {
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
