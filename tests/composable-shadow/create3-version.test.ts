import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compareCreate3Versions, parseCreate3Version } from '../../packages/composable-shadow/create3-version';
import { runProfileCommand } from '../../apps/cli/profile';

// Synthetic values only. Never copy a customer's identifiers/build fingerprint.
const sample = `Product Version: create3+SYNTHETIC.1
OS Version: linux+synthetic.1
Robot ID: SYNTHETIC-ROBOT-A
Navigation Serial Number: SYNTHETIC-NAV-A
Bootloader Version: synthetic-boot.1
Nav board revision: synthetic-board.1
Mobility Version: unknown
Safety Version: unknown
Local Manager Version: Program not installed
Boot Count: 1
Previous OS Version: linux+synthetic.0
`;
const b = (s: string) => Buffer.from(s);
const compare = (current = sample, selected?: string, baseline = sample) => compareCreate3Versions(b(baseline), b(current), selected);

test('default comparison covers only explicit identity and product/OS fields', () => {
  const report = compare();
  assert.equal(report.decision, 'UNCHANGED');
  assert.deepEqual(report.selectedFields, ['navigationSerialNumber', 'osVersion', 'productVersion', 'robotId']);
  assert.equal(report.robotContacted, false);
  assert.equal(report.hardwareDispatch, false);
  assert.equal(report.authenticatedDevice, false);
  assert.equal(report.current.fields.mobilityVersion.state, 'unavailable');
  assert.equal(report.current.fields.powerVersion.state, 'missing');
  assert.equal(report.current.fields.localManagerVersion.value, null);
});

test('changed selected identifiers and firmware are reported individually', () => {
  const report = compare(sample.replace('SYNTHETIC-ROBOT-A', 'SYNTHETIC-ROBOT-B').replace('create3+SYNTHETIC.1', 'create3+SYNTHETIC.2'));
  assert.equal(report.decision, 'CHANGED');
  assert.deepEqual(report.changes.map(c => c.field), ['productVersion', 'robotId']);
});

test('context-only boot count and previous OS changes do not redefine stable identity', () => {
  const report = compare(sample.replace('Boot Count: 1', 'Boot Count: 2').replace('linux+synthetic.0', 'linux+synthetic.earlier'));
  assert.equal(report.decision, 'UNCHANGED');
  assert.notEqual(report.baseline.inputSha256, report.current.inputSha256);
  assert.equal(report.current.context.bootCount, '2');
  assert.throws(() => compare(sample, 'bootCount'), /known_fields/);
});

test('missing or unavailable selected fields cannot match even when identical', () => {
  for (const token of ['unknown', 'UNKNOWN', 'Program not installed', 'n/a', '', 'unavailable', 'unknown (not queried)']) {
    const input = sample.replace('Safety Version: unknown', `Safety Version: ${token}`);
    const report = compare(input, 'robotId,safetyVersion', input);
    assert.equal(report.decision, 'NEEDS_MATERIAL');
    assert.equal(report.missing.length, 2);
  }
  assert.equal(compare(sample.replace('Robot ID: SYNTHETIC-ROBOT-A\n', '')).decision, 'NEEDS_MATERIAL');
  assert.equal(compare(sample.replace('Robot ID: SYNTHETIC-ROBOT-A', 'Robot ID: unknown')).decision, 'NEEDS_MATERIAL');
});

test('additional selected firmware values are compared, not silently ignored', () => {
  assert.equal(compare(sample.replace('synthetic-boot.1', 'synthetic-boot.2')).decision, 'UNCHANGED');
  const report = compare(sample.replace('synthetic-boot.1', 'synthetic-boot.2'), 'robotId,bootloaderVersion');
  assert.equal(report.decision, 'CHANGED');
  assert.equal(report.changes[0].field, 'bootloaderVersion');
});

test('duplicate known fields and concatenated captures fail closed, even if equal', () => {
  for (const extra of ['Robot ID: SYNTHETIC-ROBOT-A\n', '  ROBOT   ID : other\n', 'Boot Count: 1\n', sample]) {
    const report = compare(sample + extra);
    assert.equal(report.decision, 'NEEDS_MATERIAL');
    assert.equal(report.current.issues[0].code, 'duplicate_field');
  }
});

test('requires the reported Create 3 product marker for every selection', () => {
  for (const input of ['', 'Robot ID: SYNTHETIC-ROBOT-A', sample.replace('create3+', 'other+')])
    assert.equal(compare(input, 'robotId').decision, 'NEEDS_MATERIAL');
});

test('accepts BOM/CRLF and label spacing, but does not echo unrecognized shell or secret lines', () => {
  const raw = '\uFEFFoperator@host:~$ version\r\n' + sample.replaceAll('\n', '\r\n').replace('Robot ID:', 'ROBOT   ID :') + 'password: PRIVATE-MARKER\r\n';
  const report = compare(raw);
  assert.equal(report.decision, 'UNCHANGED');
  assert.equal(report.current.unparsedLineNumbers.length, 2);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE-MARKER|operator@host/);
});

test('invalid selections, malformed encodings and oversized/control input are refused', () => {
  for (const fields of ['', 'robotId,', 'robotId,robotId', '__proto__', 'madeUp'])
    assert.throws(() => compare(sample, fields), /known_fields/);
  assert.throws(() => parseCreate3Version(Buffer.from([0xff])), /encoded data/);
  assert.throws(() => parseCreate3Version(Buffer.alloc(128 * 1024 + 1)), /128KiB/);
  assert.throws(() => parseCreate3Version(b(sample + '\x1b[31m')), /control_characters/);
  assert.equal(compare(sample.replace('SYNTHETIC-ROBOT-A', 'x'.repeat(2001))).decision, 'NEEDS_MATERIAL');
});

test('CLI writes private local reports, never overwrites, and returns nonzero for gaps/drift', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rlsok-create3-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baseline = join(root, 'reference.txt'), current = join(root, 'current.txt');
  writeFileSync(baseline, sample); writeFileSync(current, sample);
  const args = ['compare-create3-versions', '--baseline', baseline, '--current', current];
  const output = join(root, 'same');
  assert.equal(await runProfileCommand([...args, '--output', output]), 0);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.equal(report.decision, 'UNCHANGED');
  assert.match(readFileSync(join(output, 'report.md'), 'utf8'), /not an RLSOK approval/);
  await assert.rejects(runProfileCommand([...args, '--output', output]), /output_already_exists/);
  writeFileSync(current, sample.replace('SYNTHETIC-ROBOT-A', 'SYNTHETIC-ROBOT-B'));
  assert.equal(await runProfileCommand([...args, '--output', join(root, 'changed')]), 1);
  assert.equal(await runProfileCommand([...args, '--fields', 'safetyVersion', '--output', join(root, 'unknown')]), 1);
  await assert.rejects(runProfileCommand([...args, '--host', 'example.invalid', '--output', join(root, 'network')]), /invalid profile option/);
});
