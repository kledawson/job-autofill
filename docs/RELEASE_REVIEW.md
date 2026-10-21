# Workflow redesign review build — 0.2.0

Checkpoint 6 completes the planned redesign sequence on `codex/application-queue`. This is an
unpacked review build; Chrome Web Store publication and merging to `main` are separate decisions.
Validation results are recorded in the [checkpoint record](WORKFLOW_RESTRUCTURE_PROPOSAL.md).

## Install and update

Use the Node version in `.node-version` (22), then run from the repository root:

```sh
npm ci
npx playwright install chromium
npm run check
npm run typecheck
npm test
npm run test:e2e
npm run benchmark
npm run release:package
npm run test:release
```

`release:package` builds a production ZIP with WXT and checks it against the unpacked build.
The development-only [yauzl ZIP reader](https://github.com/thejoshwolfe/yauzl) verifies members as streams
without extracting archive paths; it is not bundled into the extension. The outputs, all ignored by Git, are:

- `apps/extension/dist/job-autofill-0.2.0-chrome-mv3.zip`
- The adjacent `.zip.sha256` checksum and `release-info.json` (version, hash, verification timestamp,
  source commit and whether the checkout was dirty; a dirty build is not identical to that commit).
- `apps/extension/dist/chrome-mv3/` for Load unpacked.

Extract the ZIP to a stable folder, then open `chrome://extensions`, enable Developer mode, and select
Load unpacked on the folder containing `manifest.json`. For an existing installation, keep its original
folder to preserve extension identity and data. Both `npm run build` and `npm run zip` update the legacy
`.output/chrome-mv3` folder too. Click the extension's Reload button, reopen the sidebar, and refresh old
application tabs after copying unsaved answers. The sidebar footer shows version and build timestamp.
No store installation or automatic update service is configured.

## Supported workflow matrix

This matrix describes controlled test coverage, not certification of every employer's implementation.

| Area | Tested behavior | Boundary / recovery |
| --- | --- | --- |
| Greenhouse, Lever, Ashby | Known facts, approved Memories, native choices, bounded queue fills and guarded success confirmation | Unfamiliar controls/results stay open for manual review |
| Workday and permitted generic sites | Existing adapter/widget unit fixtures and manual step filling | Employer-specific authentication and completion are not universally verified; use explicit submission confirmation |
| Custom dropdowns/multiselects | Committed React-select chips, approved option aliases, checkbox groups, complete-set verification | Partial/ambiguous selections remain unresolved; never treat search text as an answer |
| Location | City/state/country checks, delayed suggestions, misleading prefixes, repeated state qualifiers | Clear an old wrong value before refilling; nonempty answers are preserved |
| Login/verification | Manual sign-in, same-job resume, explicit destination handoff, fixed wait deadline, unrelated-job rejection | For another URL/new tab, select the actual form and use More → Use this page for this job |
| Review and learning | Keyboard controls, 320px sidebar, textual field states, Show field, single/Save all confirmation | No whole-page answer harvesting or automatic learning |
| Queue | 1–5 slots, live capacity, pause/add/retry/abandon, stalled AI and persisted opening recovery | Browser restarts pause and detach old tab ownership; Retry opens a new owned tab |
| Completion | Intent plus supported evidence, retained review tab, explicit Continue/closure, idempotent tracking | Detection never closes the tab; a submit click, disappearance, URL change or validation error alone is insufficient |
| Failed tab closure | Completed tab retains occupancy until verified closed, including worker recovery | Close manually or retry; no replacement exceeds the limit |
| Sheets | Simulated OAuth/API tests, independent retry, serialized row selection and lost-response deduplication | Real account OAuth/network/edit conflicts remain external; keep a Job Posting URL column |

A restarted worker recovers persisted intent. A restarted browser pauses queued work and keeps restored
pages; old numeric tab IDs do not authorize closure. Repeated observer setup replaces earlier listeners;
disconnect cancels pending edit work and optional-employer cleanup. Empty overlays release their DOM,
scroll listeners and periodic timer. Existing tests cover cancellation, late results and preserved edits.

## Benchmark and claims

`npm run benchmark` uses a separate browser without the extension as the baseline, then runs three
rounds of a three-tab queue across fictional Greenhouse/Lever/Ashby URLs. The same ten reusable fields
per form include a degree abbreviation, multiselect Memory and conditional Memory. It checks exact
answers, preserves a user correction on retry, verifies record reuse and never submits. Uploads and
unprepared employer-specific essays are excluded explicitly. `BENCHMARK_ROUNDS` accepts 1–5.

The raw report is `local-data/benchmarks/latest.json`. See [measured results](BENCHMARK_RESULTS.md).
Timings include local navigation and readiness waits, sampled at 100–400ms intervals. Page JS heap
and DOM nodes exclude the extension worker, sidebar and other Chromium processes; they are not total
RAM measurements and no forced garbage collection is used. Machine load affects both measurements.
Manual user time, real-site throughput, and an application-per-minute improvement have not been measured.
Do not turn synthetic coverage into a claim that 90% of every employer's form is filled correctly.

## Privacy and release checks

Profiles, Memories, resume files, drafts and queue context stay in trusted extension storage. It is not
claimed to be encrypted. Only relevant approved fill values go to the page. Gemini and Sheets are
optional external integrations configured by the user; routine Memory reuse needs no network call.
Back up Profile and Memories through Settings before changing installations.

The package check rejects source/debug/private folders, source maps, private key files and selected
credential patterns, checks manifest resources/version consistency, and verifies every ZIP member
against the built files. A public Google OAuth client ID and the extension public key are allowed.
Pattern scanning is an additional check, not a guarantee that arbitrary sensitive data can be detected.
`test:release` reversibly adds synthetic private-file, credential-pattern, manifest-version and ZIP-mismatch fixtures to
the generated build, checks rejection, restores its bytes in `finally`, and reverifies the clean package.
Keep personal data out of the build inputs. No new permissions are introduced in checkpoint 6.

Existing permissions: storage/unlimitedStorage hold local documents and data; activeTab/scripting enable
user-invoked fills; sidePanel provides review; alarms support durable queue recovery; notifications
signal review readiness; identity enables optional Google OAuth. Known ATS/API hosts support adapters
and opt-in integrations; generic-site host access is requested at runtime. The extension never submits,
logs in, solves CAPTCHA, or searches/automates LinkedIn.

CI is configured to run the full checks, benchmark and package verification, and upload the ZIP, checksum, release
metadata and aggregate synthetic benchmark report for review. Generated files and personal data are
not committed to the repository.
