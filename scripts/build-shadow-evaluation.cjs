#!/usr/bin/env node
'use strict';
// Explicit build/packaging-only channel. Never runs a test, CLI demonstration,
// ROS environment or target Linux binary. Stable release gates are untouched.
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertCleanGitStatus } = require('./source-identity.cjs');
const root = path.resolve(__dirname, '..');
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: root, encoding: 'utf8', windowsHide: true, ...options });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+-shadow\.\d+$/.test(pkg.version)) throw new Error('shadow_prerelease_version_required');
assertCleanGitStatus(run('git', ['status', '--porcelain', '--untracked-files=all']));
const sourceCommit = run('git', ['rev-parse', 'HEAD']).trim();
const version = pkg.version;
const output = path.join(root, 'artifacts', 'shadow-evaluation', version);
if (fs.existsSync(output)) throw new Error('evaluation_output_already_exists');
const nodeName = 'node-v22.22.0-linux-x64.tar.gz';
const nodeSha256 = 'c33c39ed9c80deddde77c960d00119918b9e352426fd604ba41638d6526a4744';
const nodeUrl = `https://nodejs.org/dist/v22.22.0/${nodeName}`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rlsok-shadow-package-'));
const stage = path.join(temporary, `rlsok-shadow-evaluation-${version}`);
const copy = (source, target) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, filter: name => !name.includes('__pycache__') && !name.endsWith('.pyc') });
};

(async () => {
  try {
    // Build into an empty output tree, so ignored stale files cannot enter a release.
    fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
    run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
    fs.mkdirSync(output, { recursive: true });
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('run_with_npm_run_bundle_shadow_evaluation');
    const packed = JSON.parse(run(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', output]));
    copy(path.join(root, 'dist'), path.join(stage, 'lib/rlsok/dist'));
    copy(path.join(root, 'experimental/composable-shadow'), path.join(stage, 'lib/rlsok/experimental/composable-shadow'));
    copy(path.join(root, 'docs'), path.join(stage, 'docs'));
    copy(path.join(root, 'examples/composable-shadow'), path.join(stage, 'materials'));
    copy(path.join(root, 'examples/adapter-references'), path.join(stage, 'lib/rlsok/examples/adapter-references'));
    copy(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const dependencies = [];
    for (const [location, metadata] of Object.entries(lock.packages)) {
      if (!location.startsWith('node_modules/') || metadata.dev === true) continue;
      const installed = JSON.parse(fs.readFileSync(path.join(root, location, 'package.json'), 'utf8'));
      if (installed.version !== metadata.version) throw new Error(`installed_dependency_version_mismatch:${location}`);
      dependencies.push({ name: installed.name, version: installed.version, integrity: metadata.integrity });
      copy(path.join(root, location), path.join(stage, 'lib/rlsok', location));
    }
    fs.mkdirSync(path.join(stage, 'schemas'));
    const { interfaceSchemas } = require('../dist/packages/composable-shadow/json-schema.js');
    for (const [name, document] of Object.entries(interfaceSchemas())) json(path.join(stage, 'schemas', name), document);
    fs.mkdirSync(path.join(stage, 'bin'));
    fs.writeFileSync(path.join(stage, 'bin/rlsok'), '#!/bin/sh\nset -eu\ncase "${1:-}" in profile|verify-evidence|--version|-V|version) ;; *) echo "Local Shadow evaluation: use profile help, profile commands, or verify-evidence." >&2; exit 2 ;; esac\nSELF=$(readlink -f -- "$0")\nROOT=$(CDPATH= cd -- "$(dirname -- "$SELF")/.." && pwd)\nexec "$ROOT/bin/node" "$ROOT/lib/rlsok/dist/apps/cli/rlsok.js" "$@"\n');
    fs.writeFileSync(path.join(stage, 'VERSION'), version + '\n');
    fs.writeFileSync(path.join(stage, 'SOURCE_COMMIT'), sourceCommit + '\n');
    fs.writeFileSync(path.join(stage, 'README.md'), '# RLSOK local Shadow evaluation\n\nStart with [the first-evaluation guide](docs/local-shadow-first-evaluation.md).\n\nThis prerelease is for local, self-attested zero-dispatch evaluation. Humble, private interfaces, installation and physical FANUC operation have not been validated for this release. See BUILD-MANIFEST.json.\n');
    const build = { schemaVersion: 1, version, sourceCommit,
      sourceUrl: `https://github.com/realitywarden/rlsok/commit/${sourceCommit}`,
      builtAt: new Date().toISOString(), buildHost: `${process.platform}-${process.arch}`,
      node: { version: '22.22.0', url: nodeUrl, archiveSha256: nodeSha256 }, dependencies,
      scope: 'local-self-attested-shadow-evaluation', cloudUploaded: false,
      validation: { typescriptBuild: 'completed', localTests: 'see_committed_release_notes', validationRecord: `docs/releases/v${version}.md`, githubActions: 'not_run', installedBundle: 'not_run', humble: 'not_validated', privateInterfaces: 'unknown', physicalRobot: 'not_validated' } };
    json(path.join(stage, 'BUILD-MANIFEST.json'), build);
    const response = await fetch(nodeUrl, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`node_download_http_${response.status}`);
    const nodeBytes = Buffer.from(await response.arrayBuffer());
    if (hash(nodeBytes) !== nodeSha256) throw new Error('node_archive_checksum_mismatch');
    fs.writeFileSync(path.join(temporary, nodeName), nodeBytes);
    const archiveName = `rlsok-shadow-evaluation-${version}-linux-x64.tar.gz`;
    run(process.env.RLSOK_PACKAGING_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      [path.join(__dirname, 'archive-shadow-evaluation.py'), stage, path.join(temporary, nodeName), nodeSha256, path.join(output, archiveName)], { stdio: 'inherit' });
    run('git', ['archive', '--format=tar.gz', `--prefix=rlsok-source-${version}/`, `--output=${path.join(output, `rlsok-source-${version}.tar.gz`)}`, sourceCommit]);
    copy(path.join(root, 'packaging/install-shadow.sh'), path.join(output, 'install-shadow.sh'));
    copy(path.join(root, 'docs/local-shadow-first-evaluation.md'), path.join(output, 'START-HERE.md'));
    copy(path.join(root, 'docs/fanuc-shadow-self-service.md'), path.join(output, 'INSTALLATION.md'));
    copy(path.join(root, 'docs/interface-onboarding.md'), path.join(output, 'INTERFACE-ONBOARDING.md'));
    copy(path.join(root, 'docs/source-shadow-workspaces.md'), path.join(output, 'SOURCE-WORKSPACES.md'));
    copy(path.join(root, 'docs/email-feedback-evaluation-20260910.md'), path.join(output, 'FEEDBACK-EVALUATION.md'));
    copy(path.join(root, 'docs/email-feedback-afternoon-20260910.md'), path.join(output, 'AFTERNOON-FEEDBACK.md'));
    copy(path.join(root, 'docs/pliant-propulsors-review.md'), path.join(output, 'PROPULSOR-REVIEW.md'));
    run(process.execPath, [path.join(__dirname, 'generate-sbom.cjs')]);
    run(process.execPath, [path.join(__dirname, 'license-inventory.cjs')]);
    for (const name of ['rlsok.cdx.json', 'licenses.json']) copy(path.join(root, 'artifacts', name), path.join(output, name));
    const packName = packed[0].filename;
    json(path.join(output, `${packName}.manifest.json`), { version, sourceCommit, package: packName,
      sha256: hash(fs.readFileSync(path.join(output, packName))), files: packed[0].files.map(f => f.path).sort(), validation: build.validation });
    const assets = fs.readdirSync(output).sort().map(name => {
      const bytes = fs.readFileSync(path.join(output, name));
      return { name, sizeBytes: bytes.length, sha256: hash(bytes), url: `https://github.com/realitywarden/rlsok/releases/download/v${version}/${name}` };
    });
    json(path.join(output, 'evaluation-release.json'), { ...build, releaseTag: `v${version}`, assets });
    for (const name of fs.readdirSync(output)) {
      const digest = hash(fs.readFileSync(path.join(output, name)));
      fs.writeFileSync(path.join(output, `${name}.sha256`), `${digest}  ${name}\n`);
    }
    fs.writeFileSync(path.join(output, 'SHA256SUMS'), fs.readdirSync(output).filter(name => !name.endsWith('.sha256')).sort().map(name => `${hash(fs.readFileSync(path.join(output, name)))}  ${name}\n`).join(''));
    assertCleanGitStatus(run('git', ['status', '--porcelain', '--untracked-files=all']));
    if (run('git', ['rev-parse', 'HEAD']).trim() !== sourceCommit) throw new Error('source_changed_during_packaging');
    process.stdout.write(JSON.stringify({ output, sourceCommit, archive: archiveName, validation: build.validation }) + '\n');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
