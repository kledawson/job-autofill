import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const required = [
  'AGENTS.md', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md',
  'docs/ARCHITECTURE.md', 'docs/CONTRACTS.md', 'docs/ROADMAP.md',
  'docs/COLLABORATION.md', 'docs/DECISIONS.md',
  'apps/extension/README.md', 'packages/shared/README.md',
  'tests/fixtures/README.md', 'tests/e2e/README.md',
  '.github/pull_request_template.md', '.github/workflows/ci.yml',
];
for (const path of required) {
  if (!existsSync(resolve(root, path))) failures.push(`Missing required file: ${path}`);
}

const claude = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8');
if (!/^@AGENTS\.md\s*$/m.test(claude)) {
  failures.push('CLAUDE.md must import the canonical AGENTS.md on its own line.');
}

const excluded = new Set([
  '.git', 'node_modules', '.claude', '.codex', '.agents', '.worktrees',
  'local-data', 'profiles', 'resumes', 'exports', '.output', '.wxt',
  'dist', 'coverage', 'playwright-report', 'test-results',
]);
let documents = 0;
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || excluded.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      inspect(path);
      continue;
    }
    if (!entry.name.endsWith('.md')) continue;
    documents++;
    const content = readFileSync(path, 'utf8');
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const destination = resolve(dirname(path), decodeURIComponent(target.split('#')[0]));
      if (!existsSync(destination) || !statSync(destination).isFile()) {
        failures.push(`${relative(root, path)}: broken local link ${target}`);
      }
    }
  }
}
inspect(root);
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
if (!pkg.private) failures.push('Root package must remain private.');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Repository checks passed: ${required.length} required files, shared Claude import, ${documents} Markdown documents and their local links.`);
  console.log('Application checks: npm run typecheck, npm test, npm run build, npm run test:e2e.');
}
