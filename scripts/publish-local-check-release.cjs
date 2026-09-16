#!/usr/bin/env node
'use strict';
// Manual delivery only. Upload and verify a draft before immutable publication.
// Never starts CI, changes repository protection, or replaces existing assets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const run = (file, args, input) => execFileSync(file, args, { cwd: root, encoding: 'utf8', input, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const gh = process.env.RLSOK_GH || 'gh';
const api = (endpoint, body) => JSON.parse(run(gh, ['api', endpoint, ...(body ? ['--method', 'POST', '--input', '-'] : [])], body ? JSON.stringify(body) : undefined));
const repo = 'realitywarden/rlsok';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('numbered_local_check_release_required');
const dir = path.join(root, 'artifacts', 'shadow-evaluation', version);
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'evaluation-release.json'), 'utf8'));
const head = run('git', ['rev-parse', 'HEAD']).trim();
if (manifest.version !== version || manifest.sourceCommit !== head || run('git', ['status', '--porcelain']).trim()) throw new Error('clean_packaged_source_required');
const remote = run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0];
if (remote !== head) throw new Error('push_packaged_source_to_main_first');
const names = fs.readdirSync(dir).sort();
if (names.some(name => !fs.statSync(path.join(dir, name)).isFile())) throw new Error('unexpected_asset_directory');
const assets = names.map(name => {
  const bytes = fs.readFileSync(path.join(dir, name));
  return { name, size: bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex') };
});
for (const line of fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!match || assets.find(a => a.name === match[2])?.digest !== 'sha256:' + match[1]) throw new Error('local_checksum_mismatch');
}
const releases = JSON.parse(run(gh, ['api', `repos/${repo}/releases?per_page=100`, '--jq', '[.[] | {id, tag_name, draft}]']));
let release = releases.find(r => r.tag_name === 'v' + version);
if (release && !release.draft) throw new Error('published_release_must_not_be_modified_or_reused');
if (!release) {
  const body = fs.readFileSync(path.join(root, 'docs', 'releases', `v${version}.md`), 'utf8')
    .replaceAll('(../', `(https://github.com/${repo}/blob/v${version}/docs/`);
  release = api(`repos/${repo}/releases`, { tag_name: 'v' + version, target_commitish: head,
    name: 'RLSOK Local Check ' + version, body, draft: true, prerelease: false, make_latest: 'false' });
}
const before = api(`repos/${repo}/releases/${release.id}`);
if (!before.draft || before.target_commitish !== head) throw new Error('draft_source_mismatch');
const missing = [];
for (const asset of assets) {
  const existing = before.assets.find(a => a.name === asset.name);
  if (existing && (existing.digest !== asset.digest || existing.size !== asset.size)) throw new Error('draft_asset_conflict:' + asset.name);
  if (!existing) missing.push(path.join(dir, asset.name));
}
if (missing.length) run(gh, ['release', 'upload', 'v' + version, '--repo', repo, ...missing]);
const ready = api(`repos/${repo}/releases/${release.id}`);
if (!ready.draft || ready.assets.length !== assets.length || assets.some(a => !ready.assets.some(b => b.name === a.name && b.size === a.size && b.digest === a.digest))) throw new Error('draft_asset_verification_failed');
if (!process.argv.includes('--publish')) {
  console.log(JSON.stringify({ id: ready.id, version, verifiedAssets: assets.length, draft: true }));
} else {
  const published = JSON.parse(run(gh, ['api', `repos/${repo}/releases/${ready.id}`, '--method', 'PATCH', '--input', '-'], JSON.stringify({ draft: false, make_latest: 'false' })));
  if (published.draft) throw new Error('release_not_published');
  console.log(JSON.stringify({ id: published.id, version, verifiedAssets: assets.length, url: published.html_url, sourceCommit: head, immutable: published.immutable }));
}
