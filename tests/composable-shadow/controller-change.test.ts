import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { load, dump } from 'js-yaml';
import { prepareSo101ControllerSwap } from '../../packages/composable-shadow/so101-swap';
import { compareControllerExports, controllerComparisonMarkdown } from '../../packages/composable-shadow/controller-comparison';
import { sourceRecipes } from '../../packages/composable-shadow/source-recipes';

const spec = sourceRecipes['so101-arm'].controllerState!;
const original = { controller_manager: { ros__parameters: { update_rate: 100,
  arm_controller: { type: spec.type }, gripper_controller: { type: 'position_controllers/GripperActionController' } } },
  arm_controller: { ros__parameters: { ...spec.parameters, state_interfaces: ['position', 'velocity'] } },
  gripper_controller: { ros__parameters: { joint: 'gripper', goal_tolerance: 0.01 } } };
test('SO-101 copy changes only the arm type and its plugin parameters, preserving ordered joints and gripper', () => {
  const changed: any = load(prepareSo101ControllerSwap(dump(original)));
  assert.equal(changed.controller_manager.ros__parameters.arm_controller.type, 'position_controllers/JointGroupPositionController');
  assert.deepEqual(changed.arm_controller.ros__parameters, { joints: spec.parameters.joints });
  assert.deepEqual(changed.gripper_controller, original.gripper_controller);
  assert.deepEqual(changed.controller_manager.ros__parameters.gripper_controller, original.controller_manager.ros__parameters.gripper_controller);
  assert.equal(changed.controller_manager.ros__parameters.update_rate, 100);
  for (const defect of ['joint-order', 'type', 'gripper']) {
    const value: any = structuredClone(original);
    if (defect === 'joint-order') value.arm_controller.ros__parameters.joints.reverse();
    if (defect === 'type') value.controller_manager.ros__parameters.arm_controller.type = 'other/Plugin';
    if (defect === 'gripper') delete value.gripper_controller;
    assert.throws(() => prepareSo101ControllerSwap(dump(value)), /requires_reviewed/);
  }
});

const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical)}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`)}}` : JSON.stringify(v);
function exported() {
  const configuration = { schemaVersion: 1, source: { controllerManager: '/controller_manager', controllerName: 'arm_controller',
    controllerNode: '/arm_controller', environment: { rosDistro: 'jazzy', rmwImplementation: 'rmw_fastrtps_cpp', domainId: 220 } },
    controller: { name: 'arm_controller', state: 'active', type: spec.type, claimed_interfaces: spec.claimedInterfaces },
    actionServers: [{ endpoint: spec.actionEndpoint!, type: 'control_msgs/action/FollowJointTrajectory' }],
    parameters: { joints: { type: 9, value: spec.parameters.joints }, command_interfaces: { type: 9, value: ['position'] } } };
  return signed({ schemaVersion: 1, kind: 'RlsokRosControllerState', observedAt: '2026-09-10T00:00:00.000Z', configuration });
}
function signed(v: any) { return { ...v, configurationSha256: createHash('sha256').update(canonical(v.configuration)).digest('hex') }; }
test('historical controller comparison identifies same-name type/action changes and validates provenance', async () => {
  const baseline = exported(), changed = structuredClone(baseline);
  changed.observedAt = '2026-09-10T00:01:00.000Z';
  changed.configuration.controller.type = 'position_controllers/JointGroupPositionController';
  changed.configuration.actionServers = [];
  delete changed.configuration.parameters.command_interfaces;
  const report = await compareControllerExports(baseline, signed(changed));
  assert.equal(report.configurationMatches, false);
  assert.deepEqual(report.differences.map(d => d.group), ['controller', 'action-endpoints', 'parameter:command_interfaces']);
  assert.match(controllerComparisonMarkdown(report), /JointGroupPositionController/);
  assert.equal((await compareControllerExports(baseline, baseline)).configurationMatches, true);
  await assert.rejects(compareControllerExports(baseline, changed), /digest/);
  changed.configuration.source.controllerNode = '/other';
  await assert.rejects(compareControllerExports(baseline, signed(changed)), /same_source/);
  changed.configuration.source.controllerNode = '/arm_controller'; changed.observedAt = '2026-09-09T00:00:00.000Z';
  await assert.rejects(compareControllerExports(baseline, signed(changed)), /precedes/);
});
