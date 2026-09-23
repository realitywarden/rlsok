import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeLocalDataTemplates, evaluateLocalDataWorkspace, inspectLocalData, localDataTemplateSchema,
  prepareLocalDataWorkspace, readLocalFileSource } from '../../packages/composable-shadow/local-data';
import { runProfileCommand } from '../../apps/cli/profile';
import { buildLocalDataWorkspaceArchive } from '../../apps/cli/setup-workspace';

const fragment = { schemaVersion: 1, kind: 'RlsokLocalDataTemplate',
  metadata: { id: 'controller-class', version: '1.0.0', name: 'Controller class rule' },
  check: { plugin: 'scalar-fields/v1', rules: [{ pointer: '/arm_controller/type', type: 'string',
    meaning: 'selected controller implementation class', unit: 'class name', allowed: ['JointTrajectoryController'] }] } };

test('one rule fragment checks local YAML and JSON without ROS or file-path coupling', () => {
  assert.equal(localDataTemplateSchema.safeParse(fragment).success, true);
  const source = readLocalFileSource('tests/fixtures/local-assistant/controllers.yaml');
  const inspection = inspectLocalData('yaml-records/v1', source.bytes);
  assert.ok(inspection.fields.some(field => field.pointer === '/arm_controller/type' && field.type === 'string'));
  assert.ok(inspection.limitations.some(note => note.includes('units')));
  const yamlWorkspace = prepareLocalDataWorkspace({ templates: [fragment], parser: 'yaml-records/v1',
    fileName: source.fileName, bytes: source.bytes, deviceId: 'arm-a', semanticsConfirmed: true });
  assert.equal(yamlWorkspace.source.preparedSha256, source.sha256);
  const yamlReport = evaluateLocalDataWorkspace(yamlWorkspace, source.bytes);
  assert.equal(yamlReport.decision, 'LOCAL_DATA_MATCH');
  assert.equal(yamlReport.recordsChecked, 1);
  assert.equal(yamlReport.hardwareSignalSent, false);
  assert.equal(yamlReport.controllerGoalsAttempted, 0);
  const archive = buildLocalDataWorkspaceArchive(yamlWorkspace, source.bytes.toString('base64'));
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.ok(archive.includes(Buffer.from('workspace.json')));
  assert.ok(archive.includes(Buffer.from('files/prepared-source-data')));
  assert.throws(() => buildLocalDataWorkspaceArchive(yamlWorkspace, Buffer.from('changed').toString('base64')), /changed_after_preparation/);

  const json = Buffer.from(JSON.stringify({ arm_controller: { type: 'JointTrajectoryController', joints: ['axis1'] } }));
  const jsonWorkspace = prepareLocalDataWorkspace({ templates: [fragment], parser: 'json-records/v1',
    fileName: 'active-controller.json', bytes: json, deviceId: 'arm-b', semanticsConfirmed: true });
  assert.equal(evaluateLocalDataWorkspace(jsonWorkspace, json).decision, 'LOCAL_DATA_MATCH');
  const changed = Buffer.from(JSON.stringify({ arm_controller: { type: 'OtherController' } }));
  const report = evaluateLocalDataWorkspace(jsonWorkspace, changed);
  assert.equal(report.decision, 'LOCAL_DATA_BLOCK');
  assert.equal(report.source.matchesPreparedBytes, false);
  assert.deepEqual(report.violations, [{ record: 1, reason: 'local_data_field_not_allowlisted:/arm_controller/type' }]);
});

test('local data composition and source parsing fail closed on absent semantics and unsafe structure', () => {
  const source = readLocalFileSource('tests/fixtures/local-assistant/controllers.yaml');
  assert.throws(() => prepareLocalDataWorkspace({ templates: [fragment], parser: 'yaml-records/v1',
    fileName: source.fileName, bytes: source.bytes, deviceId: 'arm-a', semanticsConfirmed: false }));
  assert.throws(() => composeLocalDataTemplates([fragment, fragment]), /overlap/);
  assert.throws(() => prepareLocalDataWorkspace({ templates: [{ ...fragment, check: { ...fragment.check,
    rules: [{ pointer: '/missing', type: 'string', meaning: 'unknown', unit: 'label' }] } }],
    parser: 'yaml-records/v1', fileName: source.fileName, bytes: source.bytes, deviceId: 'arm-a', semanticsConfirmed: true }), /absent/);
  assert.throws(() => prepareLocalDataWorkspace({ templates: [fragment], parser: 'yaml-records/v1',
    fileName: 'unsafe/record.yaml', bytes: source.bytes, deviceId: 'arm-a', semanticsConfirmed: true }));
  assert.throws(() => prepareLocalDataWorkspace({ templates: [fragment], parser: 'yaml-records/v1',
    fileName: source.fileName, bytes: Buffer.from('a: &a {x: 1}\nb: *a\n'), deviceId: 'arm-a', semanticsConfirmed: true }));
});

test('CLI prepares a real local-file workspace and checks its selected source without ROS', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rlsok-local-data-'));
  try {
    const templatePath = join(directory, 'template.json');
    writeFileSync(templatePath, JSON.stringify(fragment));
    const workspaceDirectory = join(directory, 'workspace');
    assert.equal(await runProfileCommand(['prepare-local-data', '--template', templatePath,
      '--parser', 'yaml-records/v1', '--source', 'tests/fixtures/local-assistant/controllers.yaml',
      '--device-id', 'arm-a', '--confirm-semantics', 'yes', '--output', workspaceDirectory]), 0);
    const workspace = JSON.parse(readFileSync(join(workspaceDirectory, 'workspace.json'), 'utf8'));
    assert.equal(workspace.source.plugin, 'local-file/v1');
    assert.equal(workspace.parser.plugin, 'yaml-records/v1');
    assert.equal(await runProfileCommand(['check-local-data', '--workspace', join(workspaceDirectory, 'workspace.json'),
      '--source', join(workspaceDirectory, 'files', 'prepared-source-data'), '--output', join(directory, 'report.json')]), 0);
    const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
    assert.equal(report.decision, 'LOCAL_DATA_MATCH');
    assert.equal(report.hardwareSignalSent, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
