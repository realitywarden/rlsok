import { type Profile, type Path } from './contracts';
import { validateTopicFields, validateTopicTwist } from './checks/topic';
import { validateCartesianPose, validateCartesianDelta, validateCartesianAbsoluteWpr } from './checks/cartesian';
import { validateProgram, validateTrajectory } from './checks/action';

// The source and message parser do not choose these checks. The validated
// profile's adapter ID dispatches one independent semantic rule module.
export function validateGoal(profile: Profile, path: Path, goal: Record<string, unknown>): string | null {
  switch (path.adapter) {
    case 'topic_fields': return validateTopicFields(path, goal);
    case 'action_fields': return validateTopicFields(path, goal);
    case 'topic_twist': return validateTopicTwist(path, goal);
    case 'tp_program': return validateProgram(path, goal);
    case 'cartesian_pose': return validateCartesianPose(path, goal);
    case 'cartesian_delta': return validateCartesianDelta(path, goal);
    case 'cartesian_absolute_wpr': return validateCartesianAbsoluteWpr(path, goal);
    case 'joint_trajectory': return validateTrajectory(profile, path, goal);
  }
}
