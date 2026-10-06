# Job Autofill

A local-first Chrome extension for assisted job application autofill and application tracking.

**Status:** working MVP in [`apps/extension`](apps/extension/README.md): fills Greenhouse, Lever, Ashby, Workday, and other careers-site applications from a saved profile, writes free responses with Gemini (optional), tracks applications in Google Sheets (optional), and never submits for you.

Recent improvements: multi-select memories, batch saving, quick sidebar editing, and a redesigned
**Memories** library. See the [changelog](CHANGELOG.md).

## Start here

1. Read [shared project instructions](AGENTS.md).
2. Read [architecture](docs/ARCHITECTURE.md), [contracts](docs/CONTRACTS.md), and [roadmap](docs/ROADMAP.md).
3. Follow [contribution workflow](CONTRIBUTING.md) and claim a task before coding.

Codex reads the root `AGENTS.md`. Claude Code loads `CLAUDE.md`, which imports the same guide. After instructions change, start a fresh session or explicitly ask the assistant to re-read the files. To verify, ask it to summarize the current product scope and validation commands. Claude users can also inspect `/memory`.

## Using the extension

Set up your profile -> open an application -> fill -> review and answer remaining questions ->
remember reusable answers -> submit manually -> mark submitted.

- Fill supported fields from your profile or confirmed memories, with verified writes and preserved user edits.
- Remember single answers or multiple selections, with approved variations and company/application/site scopes.
- Review and save several answered questions together using **Save all answered questions**.
- Edit or delete memories directly in the sidebar, or browse the searchable **Settings → Memories** library.
- Track applications locally; optionally configure Gemini drafts and Google Sheets tracking.

Applicant data stays local by default. External integrations are opt-in, and the extension never submits applications.

## Layout

```text
apps/extension/      Extension entry points, UI, storage, and DOM adapters
packages/shared/    Schemas, types, matching, and message contracts
tests/fixtures/     Synthetic profiles and controlled forms
tests/e2e/          Extension browser tests (Playwright)
scripts/            Repository checks
docs/               Design, roadmap, contracts, and decisions
.github/            CI and issue/PR templates
AGENTS.md           Canonical shared instructions
CLAUDE.md           Claude import of AGENTS.md
```

## Local setup

Install Node.js 22.13 or newer (22, 24, 26+ all work) and Git, then clone the repository:

```sh
git clone https://github.com/kledawson/job-autofill.git
cd job-autofill
npm run check
```

Then install everything and build the extension (`npm run setup` runs `npm install` plus the one-time Chromium download for e2e tests; use plain `npm install` if you only need to build):

```sh
npm run setup
npm run build        # outputs apps/extension/dist/chrome-mv3
```

Load it in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked**.
3. In the file picker, select the folder `apps/extension/dist/chrome-mv3` inside this repository (the one containing `manifest.json`) and click **Select**. Choose the folder itself, not a file inside it, and not the repository root.
4. Pin the extension from the puzzle-piece menu if you want quick access.

After rebuilding, click the reload icon on the extension's card in `chrome://extensions`.

| Command | What it does |
| --- | --- |
| `npm run check` | Repository and documentation checks |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Unit tests against saved application forms |
| `npm run test:e2e` | Builds, then drives the real extension in Chromium (needs the Chromium that `npm run setup` installs) |
| `npm run dev` | Development build with live reload |

See [the extension README](apps/extension/README.md) for Gemini and Google Sheets setup.

## Collaboration

`main` holds integrated work. Create a fresh task branch from updated `main`, open a PR, and have the other contributor review it. Use separate clones/worktrees for parallel sessions. See [CONTRIBUTING.md](CONTRIBUTING.md).

The owner can invite a friend through repository **Settings -> Collaborators -> Add people**. Recommended branch protection and first task splits are in [collaboration setup](docs/COLLABORATION.md).

Keep real applicant information under ignored `local-data/`, `profiles/`, `resumes/`, or `exports/`. Committed examples must be fictional.
