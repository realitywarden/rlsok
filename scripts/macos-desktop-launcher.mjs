import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, open, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This launcher owns only a per-user database and loopback services. It never
// connects to a robot, imports cloud credentials, or changes release approvals.
const resources = dirname(fileURLToPath(import.meta.url));
const state = join(homedir(), 'Library', 'Application Support', 'RLSOK');
const server = join(resources, 'server');
const pgBin = join(resources, 'postgresql', 'bin');
const database = join(state, 'database');
const configPath = join(state, 'desktop.json');
const servicesPath = join(state, 'services.json');
const lockPath = join(state, 'launcher.lock');
const apiEntry = join(server, 'apps/api/dist/src/index.js');
const webEntry = join(resources, 'web-launcher.mjs');
const secret = () => randomBytes(32).toString('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const exists = async path => lstat(path).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) throw new Error('The local data folder is not owned by this macOS user.');
  await chmod(path, 0o700);
}
async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}
async function readPrivateJson(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('Local configuration permissions must be private to this macOS user.');
  return JSON.parse(await readFile(path, 'utf8'));
}
function cleanEnvironment() {
  const env = { PATH: `${pgBin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: homedir(), TMPDIR: process.env.TMPDIR || '/tmp', LANG: 'en_US.UTF-8' };
  // Never inherit NODE_OPTIONS, cloud keys, proxies or another database URL.
  return env;
}
function run(file, args, options = {}) {
  const result = spawnSync(file, args, { env: cleanEnvironment(), encoding: 'utf8', timeout: 120_000, ...options });
  if (result.error || result.status !== 0) {
    // Child output can contain credentials. Preserve it only in the private log.
    const error = new Error(`Could not complete ${file.split('/').pop()}. See the local startup log.`);
    error.detail = result.error?.message || result.stderr || result.stdout;
    throw error;
  }
  return result.stdout;
}
async function portAvailable(port) {
  return new Promise(resolve => {
    const listener = createServer();
    listener.once('error', () => resolve(false));
    listener.listen({ host: '127.0.0.1', port, exclusive: true }, () => listener.close(() => resolve(true)));
  });
}
async function loadConfig() {
  if (await exists(configPath)) {
    const config = await readPrivateJson(configPath);
    if (config.schema !== 1 || config.ownerUid !== process.getuid() || config.organization !== 'My local workspace' || config.email !== 'local@localhost' ||
        !Number.isInteger(config.databasePort) || config.databasePort < 1024 || config.databasePort > 65535 ||
        ![config.adminPassword, config.databasePassword, config.localAccessToken].every(value => /^[a-f0-9]{64}$/.test(value))) throw new Error('The saved local configuration is invalid. Your data has been kept.');
    return config;
  }
  if (await exists(database)) throw new Error('A local database exists without its configuration. Your data has been kept.');
  let databasePort;
  for (const candidate of [15432, 25432, 35432, 45432]) if (await portAvailable(candidate)) { databasePort = candidate; break; }
  if (!databasePort) throw new Error('The local database ports are in use. Close the other local RLSOK instance and retry.');
  const config = { schema: 1, ownerUid: process.getuid(), organization: 'My local workspace', email: 'local@localhost', databasePort,
    adminPassword: secret(), databasePassword: secret(), localAccessToken: secret() };
  await atomicJson(configPath, config);
  return config;
}
function serviceEnvironment(config, manifest) {
  return { ...cleanEnvironment(), NODE_ENV: 'production', RLSOK_ENVIRONMENT: 'development', HOST: '127.0.0.1', HOSTNAME: '127.0.0.1',
    DATABASE_URL: `postgresql://rlsok:${config.databasePassword}@127.0.0.1:${config.databasePort}/rlsok`,
    PUBLIC_WEB_ORIGIN: 'http://localhost:3000', RLSOK_WEB_ORIGIN: 'http://localhost:3000', RLSOK_API_BASE_URL: 'http://127.0.0.1:8080', RLSOK_COOKIE_SECURE: 'false',
    RLSOK_CLOUD_SOURCE_COMMIT: manifest.cloudSourceCommit, RLSOK_LOCAL_INSTALL_ROOT: resources,
    RLSOK_LOCAL_SINGLE_USER: 'true', RLSOK_LOCAL_ACCESS_TOKEN: config.localAccessToken,
    RLSOK_LOCAL_ORGANIZATION: config.organization, RLSOK_LOCAL_EMAIL: config.email };
}
function pgStatus() {
  return spawnSync(join(pgBin, 'pg_ctl'), ['status', '-D', database], { env: cleanEnvironment(), encoding: 'utf8' }).status;
}
async function startDatabase(config) {
  if (!await exists(join(database, 'PG_VERSION'))) {
    if (await exists(database)) throw new Error('An incomplete database needs recovery. Your files have been kept.');
    const stage = join(state, `database-init-${randomUUID()}`);
    const passwordFile = join(state, `init-password-${randomUUID()}`);
    await writeFile(passwordFile, config.adminPassword, { mode: 0o600, flag: 'wx' });
    try {
      run(join(pgBin, 'initdb'), ['-D', stage, '-U', 'rlsok_admin', '--encoding=UTF8', '--locale=C', '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', `--pwfile=${passwordFile}`]);
      await rename(stage, database);
    } finally { await rm(passwordFile, { force: true }); }
  }
  const version = (await readFile(join(database, 'PG_VERSION'), 'utf8')).trim();
  if (version !== '16') throw new Error('This app requires the existing PostgreSQL 16 data format. Your data has been kept.');
  const status = pgStatus();
  if (status === 0) return;
  if (status !== 3) throw new Error('The local database status could not be checked.');
  if (!await portAvailable(config.databasePort)) throw new Error('Another application is using the saved local database port.');
  // No Unix socket outside the private directory and no listening on the LAN.
  run(join(pgBin, 'pg_ctl'), ['start', '-w', '-t', '60', '-D', database, '-l', join(state, 'postgresql.log'), '-o', `-h 127.0.0.1 -p ${config.databasePort} -k ''`]);
}
async function prepareWorkspace(config, manifest) {
  const require = createRequire(join(server, 'package.json'));
  const { Client } = require('pg');
  const admin = new Client({ host: '127.0.0.1', port: config.databasePort, user: 'rlsok_admin', password: config.adminPassword, database: 'postgres', connectionTimeoutMillis: 10_000 });
  await admin.connect();
  try {
    const role = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'rlsok'");
    if (!role.rowCount) await admin.query(`CREATE ROLE rlsok LOGIN PASSWORD '${config.databasePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    const db = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'rlsok'");
    if (!db.rowCount) await admin.query('CREATE DATABASE rlsok OWNER rlsok');
  } finally { await admin.end(); }
  const env = serviceEnvironment(config, manifest);
  run(process.execPath, [join(server, 'apps/api/dist/scripts/migrate.js')], { cwd: join(server, 'apps/api'), env });
  const client = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
  await client.connect();
  let existing;
  try {
    existing = await client.query(`SELECT p.role, p.revoked_at, u.disabled_at FROM user_accounts u JOIN organizations o ON o.id=u.organization_id JOIN principals p ON p.id=u.principal_id WHERE o.name=$1 AND u.email=$2`, [config.organization, config.email]);
  } finally { await client.end(); }
  if (!existing.rowCount) {
    run(process.execPath, [join(server, 'apps/api/dist/scripts/create-user.js')], { cwd: join(server, 'apps/api'), env: { ...env, ORG_NAME: config.organization,
      USER_EMAIL: config.email, USER_DISPLAY_NAME: 'This computer', USER_ROLE: 'administrator', USER_PASSWORD: secret() } });
  } else if (existing.rowCount !== 1 || existing.rows[0].role !== 'administrator' || existing.rows[0].revoked_at || existing.rows[0].disabled_at) {
    throw new Error('The local workspace account was changed or disabled. It has not been reset.');
  }
}
function isOwned(record) {
  if (!record || !Number.isInteger(record.pid) || record.pid <= 1 || !/^[a-f0-9-]{36}$/.test(record.nonce) ||
      ![apiEntry, webEntry].includes(record.entry) || record.executable !== process.execPath) return false;
  const result = spawnSync('/bin/ps', ['-ww', '-p', String(record.pid), '-o', 'uid=', '-o', 'command='], { encoding: 'utf8' });
  const text = result.stdout?.trim() || '';
  return result.status === 0 && text.startsWith(`${process.getuid()} `) && text.includes(`${record.executable} ${record.entry} --rlsok-local-instance=${record.nonce}`);
}
async function records() { return await exists(servicesPath) ? await readPrivateJson(servicesPath) : {}; }
async function stopServices() {
  const current = await records();
  for (const name of ['web', 'api']) {
    const record = current[name];
    if (!isOwned(record)) continue;
    process.kill(record.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 60 && isOwned(record); attempt++) await sleep(250);
    if (isOwned(record)) throw new Error('A local service is still stopping. Its data has been kept.');
  }
  await rm(servicesPath, { force: true });
}
async function healthy(config, manifest) {
  try {
    const response = await fetch('http://127.0.0.1:8080/v1/auth/local-desktop', { method: 'POST', headers: { 'x-rlsok-local-token': config.localAccessToken }, signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const page = await fetch('http://localhost:3000/local-start', { signal: AbortSignal.timeout(2000), redirect: 'manual' });
    return page.ok;
  } catch { return false; }
}
async function startServices(config, manifest) {
  const previous = await records();
  if (isOwned(previous.api) && isOwned(previous.web) && await healthy(config, manifest)) return;
  await stopServices();
  for (const port of [3000, 8080]) if (!await portAvailable(port)) throw new Error(`Another application is using local port ${port}. Close it and reopen RLSOK.`);
  const running = {};
  try {
    for (const [name, entry, port, cwd] of [['api', apiEntry, 8080, join(server, 'apps/api')], ['web', webEntry, 3000, join(server, 'web')]]) {
      const log = await open(join(state, `${name}.log`), 'a', 0o600);
      const nonce = randomUUID();
      try {
        const child = spawn(process.execPath, [entry, `--rlsok-local-instance=${nonce}`], { cwd, env: { ...serviceEnvironment(config, manifest), PORT: String(port) }, detached: true, stdio: ['ignore', log.fd, log.fd] });
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        running[name] = { pid: child.pid, nonce, entry, executable: process.execPath };
        await atomicJson(servicesPath, running);
        child.unref();
      } finally { await log.close(); }
    }
    for (let attempt = 0; attempt < 90; attempt++) {
      if (!isOwned(running.api) || !isOwned(running.web)) break;
      if (await healthy(config, manifest)) return;
      await sleep(500);
    }
    throw new Error('RLSOK did not finish starting. Open the local startup log for details.');
  } catch (error) { await stopServices(); throw error; }
}
async function takeLock() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await atomicJson(join(lockPath, 'owner.json'), { pid: process.pid });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await readPrivateJson(join(lockPath, 'owner.json')).catch(() => null);
      if (owner?.pid && Number.isInteger(owner.pid)) {
        try { process.kill(owner.pid, 0); } catch (e) {
          if (e.code === 'ESRCH') { await rm(join(lockPath, 'owner.json'), { force: true }); await rmdir(lockPath); continue; }
        }
      }
      await sleep(500);
    }
  }
  throw new Error('RLSOK is already starting. Please wait a moment and reopen it.');
}
async function main() {
  if (process.platform !== 'darwin' || process.getuid() === 0) throw new Error('Open RLSOK from your normal macOS user account.');
  await privateDirectory(state);
  await takeLock();
  try {
    const action = process.argv[2] || 'open';
    if (!['open', 'start', 'stop', 'status'].includes(action)) throw new Error('Expected open, start, stop or status.');
    if (action === 'stop') {
      await stopServices();
      if (await exists(database) && pgStatus() === 0) run(join(pgBin, 'pg_ctl'), ['stop', '-w', '-t', '60', '-m', 'fast', '-D', database]);
      return;
    }
    const manifest = JSON.parse(await readFile(join(resources, 'BUILD-MANIFEST.json'), 'utf8'));
    if (manifest.arch !== process.arch) throw new Error('Download the RLSOK app for this Mac processor.');
    if (action === 'status') {
      const running = await records();
      process.stdout.write(JSON.stringify({ api: isOwned(running.api), web: isOwned(running.web), database: await exists(database) && pgStatus() === 0 }) + '\n');
      return;
    }
    const config = await loadConfig();
    await startDatabase(config);
    await prepareWorkspace(config, manifest);
    await startServices(config, manifest);
    if (action === 'open') run('/usr/bin/open', ['http://localhost:3000/local-start']);
    process.stdout.write('RLSOK is ready at http://localhost:3000/local-start\n');
  } finally { await rm(join(lockPath, 'owner.json'), { force: true }); await rmdir(lockPath); }
}

main().catch(async error => {
  // These logs remain private to the current OS user and are never uploaded.
  const log = join(state, 'startup.log');
  await writeFile(log, `${new Date().toISOString()} ${error.stack}\n${error.detail || ''}\n`, { flag: 'a', mode: 0o600 }).catch(() => {});
  process.stderr.write(`${error.message}\nLocal startup log: ${log}\n`);
  process.exitCode = 1;
});
