import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { savedBytes, savedDocument, setupInventorySchema, setupManifestSchema, type SetupManifest } from './saved-setup';

const label = z.string().trim().min(1).max(300);
const camera = z.object({
  model: label, serial: label, current_device: z.string().regex(/^\/dev\/video[0-9]+$/),
  interface: label.optional(), videoIndex: label.optional(),
}).strict();
const arm = z.object({ model: z.literal('PIPER'), robot_serial: label,
  can_adapter_serial: label, current_interface: label, interface: label.optional() }).strict();

/** An explicit, saved projection of operator-confirmed roles. It is not a
 * native GUI configuration or a claim about freshly discovered hardware. */
export const piperSetupSchema = z.object({
  schemaVersion: z.literal(1),
  arm_mode: z.enum(['single', 'bimanual']), arm_side: z.enum(['left', 'right', 'both']),
  action_schema: z.enum(['joint', 'delivery']),
  cameras: z.object({ overhead: camera, left_wrist: camera.optional(), right_wrist: camera.optional() }).strict(),
  arms: z.object({ left: arm.optional(), right: arm.optional() }).strict(),
}).strict().superRefine((value, ctx) => {
  const sides = value.arm_mode === 'bimanual' ? ['left', 'right'] as const : [value.arm_side];
  if ((value.arm_mode === 'bimanual') !== (value.arm_side === 'both')) {
    ctx.addIssue({ code: 'custom', message: 'bimanual requires both; single requires left or right' });
  }
  for (const side of ['left', 'right'] as const) {
    const active = sides.includes(side);
    if (Boolean(value.arms[side]) !== active || Boolean(value.cameras[`${side}_wrist`]) !== active) {
      ctx.addIssue({ code: 'custom', message: `${side}: include exactly the active arm and wrist camera` });
    }
  }
  const unique = (values: string[], what: string) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: `duplicate ${what}` });
  };
  const cameras = Object.values(value.cameras), arms = Object.values(value.arms);
  unique(cameras.map(c => c.serial), 'camera serial');
  unique(cameras.map(c => c.current_device), 'camera endpoint');
  unique(arms.map(a => a.robot_serial), 'robot serial');
  unique(arms.map(a => a.can_adapter_serial), 'CAN adapter serial');
  unique(arms.map(a => a.current_interface), 'CAN endpoint');
});

export function preparePiperSetup(input: string, source: string, sourceCommit: string, id: string, output: string) {
  const config = piperSetupSchema.parse(savedDocument(input, 'yaml'));
  if (existsSync(output)) throw new Error('output_already_exists');
  const bindings: SetupManifest['bindings'] = [];
  const devices: z.infer<typeof setupInventorySchema>['devices'] = [];
  for (const [role, c] of Object.entries(config.cameras)) {
    const identity = { basis: 'serial' as const, id: c.serial, interface: c.interface, videoIndex: c.videoIndex };
    bindings.push({ role, kind: 'camera', identity, uses: [{ file: 'configuration', pointer: `/cameras/${role}/current_device` }] });
    devices.push({ kind: 'camera', serial: c.serial, locator: c.current_device,
      aliases: [c.current_device.slice('/dev/video'.length)], interface: c.interface, videoIndex: c.videoIndex });
  }
  for (const [role, a] of Object.entries(config.arms)) {
    bindings.push({ role: `${role}_arm`, kind: 'can', identity: { basis: 'serial', id: a.can_adapter_serial, interface: a.interface },
      uses: [{ file: 'configuration', pointer: `/arms/${role}/current_interface` }] });
    devices.push({ kind: 'can', serial: a.can_adapter_serial, locator: a.current_interface, aliases: [], interface: a.interface });
  }
  const sourcePaths = ['bimanual_vla/collection/camera.py', 'bimanual_vla/collection/robot.py',
    'bimanual_vla/data/action_conventions.py'];
  const copies = sourcePaths.map(path => ({ path, bytes: savedBytes(resolve(source, path)) }));
  const manifest = setupManifestSchema.parse({ schemaVersion: 1, id,
    source: { repository: 'SUNNYsyy2005/bimanual-vla', commit: sourceCommit },
    scope: 'saved-configuration-only', bindings,
    files: [{ id: 'configuration', path: 'configuration.json', format: 'json' },
      ...copies.map((c, i) => ({ id: c.path, path: `source-${i}.txt`, format: 'text' }))] });
  const inventory = setupInventorySchema.parse({ schemaVersion: 1, observedAt: new Date().toISOString(),
    method: 'operator-export', devices,
    warnings: ['Imported operator-confirmed mapping; timestamp is import time, not a hardware observation.',
      'Only selected endpoints are represented. RealSense serial alone may match multiple V4L2 endpoints in a full inventory.',
      'CAN adapter identity does not independently verify the attached Piper robot serial.'] });
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const write = (file: string, value: unknown) => writeFileSync(join(output, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  write('configuration.json', config); write('manifest.json', manifest); write('operator-inventory.json', inventory);
  copies.forEach((c, i) => writeFileSync(join(output, `source-${i}.txt`), c.bytes, { flag: 'wx', mode: 0o600 }));
  writeFileSync(join(output, 'README.md'), '# Piper saved role mapping\n\n'
    + 'This is a normalized offline review input, not a file consumed by start_gui.sh. '
    + 'Review configuration.json and operator-inventory.json before capture/approval. '
    + 'Keep this original baseline; use a NEW observation and a genuinely new inventory for later comparisons.\n\n'
    + 'A missing or ambiguous serial is unresolved. A changed role, robot serial, mode or selected camera requires review. '
    + 'Renumbering alone can be resolved into new copies without changing the approved identities. '
    + 'The delivery schema denotes end-effector pose and remains an experimental Piper mode. '
    + 'No CAN, camera, SDK, policy or GUI is opened. No operator approval is created automatically.\n', { flag: 'wx', mode: 0o600 });
  return { directory: resolve(output), manifest: join(resolve(output), 'manifest.json'), inventory: join(resolve(output), 'operator-inventory.json'), hardwareDispatch: false };
}
