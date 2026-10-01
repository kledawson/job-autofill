# Job Autofill

A local-first Chrome extension for assisted job application autofill and application tracking.

**Status:** working local prototype in [`apps/extension`](apps/extension/README.md). It has dedicated Greenhouse, Lever, and Ashby adapters plus general field matching for other job sites, with optional Gemini drafting and Google Sheets tracking. It never submits an application for you.

## Start here

1. Read [shared project instructions](AGENTS.md).
2. Read [architecture](docs/ARCHITECTURE.md), [contracts](docs/CONTRACTS.md), and [roadmap](docs/ROADMAP.md).
3. Follow [contribution workflow](CONTRIBUTING.md) and claim a task before coding.

Codex reads the root `AGENTS.md`. Claude Code loads `CLAUDE.md`, which imports the same guide. After instructions change, start a fresh session or explicitly ask the assistant to re-read the files. To verify, ask it to summarize the current product scope and validation commands. Claude users can also inspect `/memory`.

## Current user experience

Complete onboarding -> open a supported application through the side panel -> review filled and highlighted fields -> edit or complete answers -> submit yourself -> mark the application submitted.

Profile and documents are stored locally. Users can enable filling saved gender, Hispanic/Latino, race, and veteran choices; other self-identification, consent, anti-bot, and unknown fields stay manual. Optional Gemini drafts send a question, job context, and a filtered profile summary to Google. Optional Sheets sync sends application tracking rows to the user's Drive.

## Layout

```text
apps/extension/      Extension entry points, UI, storage, ATS adapters, unit tests
packages/shared/     Reserved for future shared browser-independent modules
tests/fixtures/      Synthetic ATS forms
tests/e2e/           Hermetic extension browser tests (Playwright)
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

Then install and build the extension:

```sh
npm ci
npm run build        # outputs apps/extension/dist/chrome-mv3
```

Load it in Chrome from `chrome://extensions` (Developer mode → **Load unpacked**).

| Command | What it does |
| --- | --- |
| `npm run check` | Repository and documentation checks |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Unit tests against saved application forms |
| `npm run test:e2e` | Builds, then drives the extension in isolated Chromium with mocked network calls |
| `npm run dev` | Development build with live reload |

See [the extension README](apps/extension/README.md) for Gemini and Google Sheets setup.

## Collaboration

`main` holds integrated work. Create a fresh task branch from updated `main`, open a PR, and have the other contributor review it. Use separate clones/worktrees for parallel sessions. See [CONTRIBUTING.md](CONTRIBUTING.md).

The owner can invite a friend through repository **Settings -> Collaborators -> Add people**. Recommended branch protection and first task splits are in [collaboration setup](docs/COLLABORATION.md).

Keep real applicant information under ignored `local-data/`, `profiles/`, `resumes/`, or `exports/`. Committed examples must be fictional. Read the Gemini and Sheets data-sharing notes in the extension README before enabling either integration.
