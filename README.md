# Job Autofill

A local-first Chrome extension for assisted job application autofill and application tracking.

**Status:** collaboration and repository foundation. The extension is not implemented yet.

## Start here

1. Read [shared project instructions](AGENTS.md).
2. Read [architecture](docs/ARCHITECTURE.md), [contracts](docs/CONTRACTS.md), and [roadmap](docs/ROADMAP.md).
3. Follow [contribution workflow](CONTRIBUTING.md) and claim a task before coding.

Codex reads the root `AGENTS.md`. Claude Code loads `CLAUDE.md`, which imports the same guide. After instructions change, start a fresh session or explicitly ask the assistant to re-read the files. To verify, ask it to summarize the current product scope and validation commands. Claude users can also inspect `/memory`.

## Planned user experience

Import profile -> open an application -> scan -> preview -> fill selected fields -> review and submit manually -> mark applied.

MVP: profile editor, JSON import/export, semantic matching, one adapter, fill verification, manual mappings, local tracker, and CSV export. AI, Sheets integration, cloud sync, and job discovery are later milestones.

## Layout

```text
apps/extension/      Extension entry points, UI, storage, and DOM adapters
packages/shared/    Schemas, types, matching, and message contracts
tests/fixtures/     Synthetic profiles and controlled forms
tests/e2e/          Future extension integration tests
scripts/            Repository checks
docs/               Design, roadmap, contracts, and decisions
.github/            CI and issue/PR templates
AGENTS.md           Canonical shared instructions
CLAUDE.md           Claude import of AGENTS.md
```

## Local setup

Install Node.js 22 and Git, then clone the repository:

```sh
git clone https://github.com/kledawson/job-autofill.git
cd job-autofill
npm run check
```

The current check requires no dependency installation. The WXT/React implementation and its commands are the first development milestone. Do not expect an extension build from this baseline.

## Collaboration

`main` holds integrated work. Create a fresh task branch from updated `main`, open a PR, and have the other contributor review it. Use separate clones/worktrees for parallel sessions. See [CONTRIBUTING.md](CONTRIBUTING.md).

The owner can invite a friend through repository **Settings -> Collaborators -> Add people**. Recommended branch protection and first task splits are in [collaboration setup](docs/COLLABORATION.md).

Keep real applicant information under ignored `local-data/`, `profiles/`, `resumes/`, or `exports/`. Committed examples must be fictional.
