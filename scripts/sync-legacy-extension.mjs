import { access, cp, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const current = resolve(root, 'apps/extension/dist/chrome-mv3');
const legacy = resolve(root, 'apps/extension/.output/chrome-mv3');

// Existing installations may still point at WXT's original .output folder.
// Keep that installation current without uninstalling or changing its extension ID/storage.
try {
  await access(resolve(legacy, 'manifest.json'));
} catch (error) {
  if (error.code === 'ENOENT') process.exit(0);
  throw error;
}

const built = JSON.parse(await readFile(resolve(current, 'manifest.json'), 'utf8'));
const installed = JSON.parse(await readFile(resolve(legacy, 'manifest.json'), 'utf8'));
if (!built.key || built.key !== installed.key) {
  throw new Error('The legacy output belongs to a different extension. It was not updated.');
}

// Copy overwrites generated assets only. Profiles and answers live in Chrome's IndexedDB.
await cp(current, legacy, { recursive: true, force: true });
console.log('Updated existing apps/extension/.output/chrome-mv3 installation from dist/chrome-mv3.');
