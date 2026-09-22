import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { piperSetupSchema, preparePiperSetup } from '../../packages/composable-shadow/piper-setup';
import { approveSavedSetup, captureSavedSetup, resolveSavedSetup, reviewSavedSetup } from '../../packages/composable-shadow/saved-setup';

// Synthetic local files only: no private customer identities or device access.
function roles() {
  return { schemaVersion: 1, arm_mode: 'bimanual', arm_side: 'both', action_schema: 'joint',
    cameras: {
      overhead: { model: 'D435i', serial: 'EXAMPLE-OVERHEAD', current_device: '/dev/video4', interface: '03', videoIndex: '0' },
      left_wrist: { model: 'D405', usb_path: 'EXAMPLE-REVIEWED-USB-PORT', current_device: '/dev/video22', interface: '00', videoIndex: '4' },
      right_wrist: { model: 'D405', serial: 'EXAMPLE-RIGHT', current_device: '/dev/video10', interface: '00', videoIndex: '0' },
    }, arms: {
      left: { model: 'PIPER', robot_serial: 'EXAMPLE-LEFT-ARM', can_adapter_serial: 'EXAMPLE-LEFT-CAN', current_interface: 'can0' },
      right: { model: 'PIPER', robot_serial: 'EXAMPLE-RIGHT-ARM', can_adapter_serial: 'EXAMPLE-RIGHT-CAN', current_interface: 'can1' },
    } };
}
function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'rlsok-piper-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), input = join(root, 'roles.json'), output = join(root, 'prepared');
  for (const file of ['bimanual_vla/collection/camera.py', 'bimanual_vla/collection/robot.py', 'bimanual_vla/data/action_conventions.py']) {
    const path = join(source, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '# synthetic source\n');
  }
  writeFileSync(input, JSON.stringify(roles()));
  const prepared = preparePiperSetup(input, source, 'a'.repeat(40), 'example-piper', output);
  const manifest = JSON.parse(readFileSync(prepared.manifest, 'utf8'));
  const inventory = JSON.parse(readFileSync(prepared.inventory, 'utf8'));
  return { root, source, input, output, prepared, manifest, inventory };
}

test('Piper accepts explicit mixed identities without fabricating a missing unit serial', t => {
  const f = fixture(t);
  const camera = f.manifest.bindings.find((b: { role: string }) => b.role === 'left_wrist');
  assert.deepEqual(camera.identity, { basis: 'usb-path', id: 'EXAMPLE-REVIEWED-USB-PORT', interface: '00', videoIndex: '4' });
  const device = f.inventory.devices.find((d: { locator: string }) => d.locator === '/dev/video22');
  assert.equal(device.serial, undefined);
  assert.equal(device.usbPath, 'EXAMPLE-REVIEWED-USB-PORT');
  assert.equal(f.inventory.method, 'operator-export');
  assert.match(f.inventory.warnings.join('\n'), /not a unique camera/);
  assert.equal(f.prepared.hardwareDispatch, false);
});

test('existing serial-only Piper input remains accepted', () => {
  const input = JSON.parse(JSON.stringify(roles()));
  delete input.cameras.left_wrist.usb_path;
  input.cameras.left_wrist.serial = 'EXAMPLE-LEFT';
  assert.equal(piperSetupSchema.parse(input).cameras.left_wrist?.serial, 'EXAMPLE-LEFT');
});

for (const defect of ['both identities', 'no identity', 'missing interface', 'missing videoIndex', 'duplicate port', 'duplicate serial', 'duplicate endpoint'] as const) {
  test(`Piper rejects ${defect}`, () => {
    const input = JSON.parse(JSON.stringify(roles()));
    const left = input.cameras.left_wrist, right = input.cameras.right_wrist;
    if (defect === 'both identities') left.serial = 'EXAMPLE-LEFT';
    if (defect === 'no identity') delete left.usb_path;
    if (defect === 'missing interface') delete left.interface;
    if (defect === 'missing videoIndex') delete left.videoIndex;
    if (defect === 'duplicate port') { delete right.serial; right.usb_path = left.usb_path; }
    if (defect === 'duplicate serial') right.serial = input.cameras.overhead.serial;
    if (defect === 'duplicate endpoint') right.current_device = left.current_device;
    assert.throws(() => piperSetupSchema.parse(input));
  });
}

test('Piper single-arm selection still requires exactly its own reviewed roles', () => {
  const input = JSON.parse(JSON.stringify(roles()));
  input.arm_mode = 'single'; input.arm_side = 'left';
  assert.throws(() => piperSetupSchema.parse(input));
  delete input.cameras.right_wrist; delete input.arms.right;
  assert.equal(piperSetupSchema.parse(input).arm_side, 'left');
});

test('mixed-identity preparation supports unchanged review and explicit renumber resolution', t => {
  const f = fixture(t);
  const first = captureSavedSetup(f.manifest, f.prepared.manifest, f.inventory);
  const baseline = approveSavedSetup(first, 'synthetic-test');
  assert.equal(reviewSavedSetup(baseline, first).decision, 'UNCHANGED');
  const later = structuredClone(f.inventory);
  const left = later.devices.find((d: { usbPath?: string }) => d.usbPath);
  left.locator = '/dev/video30'; left.aliases = ['30'];
  const resolved = resolveSavedSetup(f.manifest, f.prepared.manifest, later, join(f.root, 'resolved'));
  const manifestPath = join(resolved.directory, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const current = captureSavedSetup(manifest, manifestPath, later);
  assert.equal(reviewSavedSetup(baseline, current).decision, 'UNCHANGED');
  const configurationFile = manifest.files.find((file: { id: string }) => file.id === 'configuration');
  const configuration = JSON.parse(readFileSync(join(resolved.directory, configurationFile.path), 'utf8'));
  assert.equal(configuration.cameras.left_wrist.current_device, '/dev/video30');
  assert.equal(configuration.cameras.left_wrist.usb_path, 'EXAMPLE-REVIEWED-USB-PORT');
});

test('missing or ambiguous selected USB endpoint cannot resolve to the remaining other-role camera', t => {
  const f = fixture(t);
  const missing = structuredClone(f.inventory);
  missing.devices = missing.devices.filter((d: { usbPath?: string }) => !d.usbPath);
  assert.throws(() => resolveSavedSetup(f.manifest, f.prepared.manifest, missing, join(f.root, 'missing')));
  assert.equal(existsSync(join(f.root, 'missing')), false);
  const ambiguous = structuredClone(f.inventory);
  const left = ambiguous.devices.find((d: { usbPath?: string }) => d.usbPath);
  ambiguous.devices.push({ ...left, locator: '/dev/video32', aliases: ['32'] });
  assert.throws(() => resolveSavedSetup(f.manifest, f.prepared.manifest, ambiguous, join(f.root, 'ambiguous')));
  assert.equal(existsSync(join(f.root, 'ambiguous')), false);
});

test('changing USB port or identity basis requires explicit review, never silent fallback', t => {
  const f = fixture(t);
  const original = captureSavedSetup(f.manifest, f.prepared.manifest, f.inventory);
  const baseline = approveSavedSetup(original, 'synthetic-test');
  for (const basis of ['usb-path', 'serial']) {
    const input = JSON.parse(JSON.stringify(roles()));
    if (basis === 'serial') { delete input.cameras.left_wrist.usb_path; input.cameras.left_wrist.serial = 'EXAMPLE-LEFT-UNIT'; }
    else input.cameras.left_wrist.usb_path = 'EXAMPLE-OTHER-REVIEWED-PORT';
    writeFileSync(f.input, JSON.stringify(input));
    const prepared = preparePiperSetup(f.input, f.source, 'a'.repeat(40), 'example-piper', join(f.root, basis));
    const manifest = JSON.parse(readFileSync(prepared.manifest, 'utf8'));
    const inventory = JSON.parse(readFileSync(prepared.inventory, 'utf8'));
    const changed = captureSavedSetup(manifest, prepared.manifest, inventory);
    assert.equal(reviewSavedSetup(baseline, changed).decision, 'REVIEW_REQUIRED');
  }
});
