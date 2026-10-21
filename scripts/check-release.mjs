import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'apps/extension/dist'), build = join(dist, 'chrome-mv3');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const pkg = await json(join(root, 'package.json')), extension = await json(join(root, 'apps/extension/package.json'));
const lock = await json(join(root, 'package-lock.json')), manifest = await json(join(build, 'manifest.json'));
if (manifest.manifest_version !== 3 || [extension.version, lock.version, lock.packages[''].version,
  lock.packages['apps/extension'].version, manifest.version].some(v => v !== pkg.version)) throw new Error('Release versions disagree.');
if (manifest.content_security_policy?.extension_pages?.includes('unsafe-eval')) throw new Error('Development CSP in release.');

async function files(folder, prefix = '') {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed in the release.');
    const path = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(join(folder, entry.name), path + '/'));
    else result.push(path);
  }
  return result.sort();
}
const builtFiles = await files(build);
for (const path of builtFiles) {
  if (/(^|\/)(\.env[^/]*|local-data|profiles|resumes|exports|tests|node_modules)(\/|$)|\.(map|pem|key|log|zip|ts|tsx)$/i.test(path))
    throw new Error(`Private, development or source file in release: ${path}`);
  if (/\.(js|mjs|html|json|css)$/i.test(path)) {
    const text = await readFile(join(build, path), 'utf8');
    if (/AIza[0-9A-Za-z_-]{35}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ya29\.[A-Za-z0-9_-]{25,}/.test(text))
      throw new Error(`Possible secret in release: ${path}`); // Never print the matching value.
  }
}
const references = [manifest.background?.service_worker, manifest.side_panel?.default_path, manifest.options_ui?.page,
  ...Object.values(manifest.icons ?? {}), ...(manifest.content_scripts ?? []).flatMap(s => [...s.js ?? [], ...s.css ?? []])].filter(Boolean);
for (const ref of references) if (!builtFiles.includes(ref)) throw new Error(`Missing manifest resource: ${ref}`);
const zipName = `job-autofill-${pkg.version}-chrome-mv3.zip`, zip = join(dist, zipName);
const hash = content => createHash('sha256').update(content).digest('hex');
// Read ZIP members as streams; no archive paths are extracted to the filesystem.
const archive = await yauzl.openPromise(zip);
try {
  const archived = new Set();
  for await (const entry of archive.eachEntry()) {
    const path = entry.fileName;
    if (path.endsWith('/')) continue;
    if (!builtFiles.includes(path) || archived.has(path)) throw new Error('ZIP and build contain different files.');
    const expected = await readFile(join(build, path));
    if (entry.uncompressedSize !== expected.length) throw new Error(`ZIP contains an outdated resource: ${path}`);
    const digest = createHash('sha256'), stream = await archive.openReadStreamPromise(entry);
    for await (const chunk of stream) digest.update(chunk);
    if (digest.digest('hex') !== hash(expected)) throw new Error(`ZIP contains an outdated resource: ${path}`);
    archived.add(path);
  }
  if (archived.size !== builtFiles.length) throw new Error('ZIP and build contain different files.');
} finally {
  archive.close();
}
let sourceCommit = null, sourceDirty = null;
try {
  const git = args => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  sourceCommit = git(['rev-parse', 'HEAD']); sourceDirty = !!git(['status', '--porcelain']);
} catch { /* A source archive need not include Git metadata. */ }
const sha256 = hash(await readFile(zip));
await writeFile(zip + '.sha256', `${sha256}  ${zipName}\n`);
await writeFile(join(dist, 'release-info.json'), JSON.stringify({ version: pkg.version, verifiedAt: new Date().toISOString(),
  archive: zipName, sha256, fileCount: builtFiles.length, sourceCommit, sourceDirty,
  googleOAuthConfigured: !!manifest.oauth2?.client_id, validation: 'Package consistency and secret-pattern checks only; run the test suite separately.' }, null, 2) + '\n');
console.log(`Verified ${zipName}: ${builtFiles.length} matching files. SHA-256 and release-info.json written beside it.`);
