import { load, dump } from 'js-yaml';
import { sourceRecipes } from './source-recipes';

/** Prepare a reviewed file copy only. No ROS connection or controller mutation. */
export function prepareSo101ControllerSwap(yaml: string): string {
  if (Buffer.byteLength(yaml) > 2 * 1024 * 1024) throw new Error('controller_yaml_too_large');
  const original = load(yaml) as Record<string, any>;
  const manager = original?.controller_manager?.ros__parameters;
  const arm = original?.arm_controller?.ros__parameters;
  const spec = sourceRecipes['so101-arm'].controllerState!;
  if (manager?.arm_controller?.type !== spec.type ||
      JSON.stringify(arm?.joints) !== JSON.stringify(spec.parameters.joints) ||
      JSON.stringify(arm?.command_interfaces) !== JSON.stringify(['position']) ||
      !manager?.gripper_controller?.type || !original?.gripper_controller?.ros__parameters) {
    throw new Error('requires_reviewed_so101_arm_and_gripper_configuration');
  }
  // Rebuild the changed blocks so YAML aliases cannot mutate the gripper.
  const changed = structuredClone(original);
  changed.controller_manager = { ...changed.controller_manager, ros__parameters: { ...manager,
    arm_controller: { ...manager.arm_controller, type: 'position_controllers/JointGroupPositionController' } } };
  changed.arm_controller = { ros__parameters: { joints: [...spec.parameters.joints],
    ...(typeof arm.use_sim_time === 'boolean' ? { use_sim_time: arm.use_sim_time } : {}) } };
  if (JSON.stringify(changed.gripper_controller) !== JSON.stringify(original.gripper_controller)) throw new Error('gripper_configuration_changed');
  return '# Review this copy in an isolated simulation. RLSOK has not loaded or switched any controller.\n' + dump(changed, { noRefs: true, lineWidth: -1 });
}
