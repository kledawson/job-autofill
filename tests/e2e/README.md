# Browser tests

These Playwright tests load the built extension in an isolated Chromium profile and exercise fictional
HTTPS application forms. They do not use your Chrome profile or submit applications to employers.

From the repository root, run `npm run setup` once to install dependencies and Chromium, then
`npm run test:e2e` to build and run the full suite. A focused run such as
`npx playwright test tests/e2e/submission.spec.ts` uses the existing build; rebuild after source changes.

| Test file | Main coverage |
| --- | --- |
| `extension.spec.ts` | Setup, Profile, Memories, geographic matching, simulated Sheets connection and merged history controls |
| `memory-backup.spec.ts` | Backup downloads, restore previews, keep/override conflicts, multiselect rules and stale-safe imports |
| `presets.spec.ts` | Role-specific documents/answers and isolated application snapshots |
| `queue.spec.ts` | Independent fills, capacity changes, add-links intake, duplicate decisions, cancellation, worker/browser recovery and abandonment |
| `login-resume.spec.ts` | Login/account/verification waiting, bounded resume and original-job ownership |
| `queue-review.spec.ts` | Review priorities, Show field, user edits, confirmed Profile/Memory saves and AI review |
| `fill-controls.spec.ts` | Upload replacement/retry guard, employer contact isolation, relative start dates, nested Show field, compact persisted summary, Stop fill and explicit redirected/new-tab handoff |
| `submission.spec.ts` | Supported confirmations, manual fallback, validation failures, tab handoff and independent Sheets retries |

Sheets and Gemini responses are simulated; these cases do not validate personal-account OAuth or
every employer's form. The missing-OAuth setup case is skipped when the build already has an OAuth
client configured. See the [dated checkpoint record](../../docs/WORKFLOW_RESTRUCTURE_PROPOSAL.md#implementation-checkpoints)
for actual run results and remaining release work.

Optional `SCREENSHOTS` writes synthetic proof images to a local folder. Use an ignored path under
`local-data/`; keep personal applicant information and real credentials out of fixtures and evidence.

Checkpoint 6 also tests failed tab closure through alarm/worker recovery, permanent Fill and keyboard
access to version/build metadata at 320px. Pure unit checks exercise repeated observer replacement,
disconnect cleanup and idle overlay teardown. `npm run benchmark` uses its own Playwright config and
separate fixture/browser baseline; see the [review guide](../../docs/RELEASE_REVIEW.md) for its limits.
