import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const build = join(root, 'apps/extension/dist/chrome-mv3');
const run = () => spawnSync(process.execPath, ['scripts/check-release.mjs'], { cwd: root, encoding: 'utf8' });
const sentinel = join(build, '.env.release-guard-fixture');
let alreadyExists = true;
try { await access(sentinel); } catch { alreadyExists = false; }
assert.equal(alreadyExists, false, 'Refusing to overwrite an existing release fixture.');
try {
  await writeFile(sentinel, 'SYNTHETIC_ONLY=not-a-secret\n');
  const rejected = run(); assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Private, development or source file/);
} finally { await unlink(sentinel); }

// Dynamically construct a fake pattern; no actual credential is used or printed.
const credentialFixture = join(build, 'release-guard-fixture.js');
try { await access(credentialFixture); throw new Error('Refusing to overwrite an existing credential fixture.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
try {
  await writeFile(credentialFixture, `const synthetic = ${JSON.stringify('AIza' + 'x'.repeat(35))};\n`);
  const rejected = run(); assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /Possible secret/);
} finally { await unlink(credentialFixture); }

const manifestPath = join(build, 'manifest.json'), original = await readFile(manifestPath);
try {
  await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(original.toString()), version: '0.0.0' }));
  const rejected = run(); assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /versions disagree/);
} finally { await writeFile(manifestPath, original); }

const script = join(build, 'background.js'), content = await readFile(script);
try {
  await writeFile(script, Buffer.concat([content, Buffer.from('\n/* synthetic package mismatch */\n')]));
  const rejected = run(); assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /outdated resource/);
} finally { await writeFile(script, content); }
const valid = run(); assert.equal(valid.status, 0, valid.stderr);
console.log('Release guards passed: private file, credential pattern, version mismatch and outdated ZIP rejected; clean package reverified.');
