# Changelog

Workflow redesign checkpoints below are development snapshots on `codex/application-queue`,
not releases on `main`. Dates record the documented checkpoint day in America/Los_Angeles;
exact implementation times were not recorded. The publication review began on
**2026-10-19 at 13:21 PDT (UTC−07:00)**. See the
[checkpoint status and validation](docs/WORKFLOW_RESTRUCTURE_PROPOSAL.md#implementation-checkpoints)
for completed work, test evidence and the remaining recovery/release checkpoint.

## 2026-10-19 — Feature-branch integration

- Integrate the latest `main` history improvements into the redesign branch: compact company/date details and confirmed Clear all, preserving the pinned Fill, collapsible Applications section and Sheets retry actions.
- Update the root and extension guides, architecture, contracts, roadmap and checkpoint record for collaborator review. Personal data, local screenshots and build outputs remain ignored.
- Validate the combined source: 481 unit tests and 59 applicable browser cases across full/focused runs; one configuration-specific OAuth case skipped. Document the corrected history fixture and exact results in the checkpoint record.

## 2026-10-19 — Workflow increment 5: submission and tracking

- Share guarded Greenhouse, Lever and Ashby success confirmation between individual fills and queues; record detected versus user-confirmed outcomes.
- Keep individual tabs open, offer explicit safe closure, and retain manual confirmation after unfamiliar result navigation or more than 50 history entries.
- Surface website validation failures without closing or advancing; preserve the original submission date on repeated confirmation.
- Keep queue completion and owned-tab handoff independent of sheet failures and closure retries.
- Serialize sheet writes across applications, persist pending sync, expose history retry, and require a Job Posting URL column for safe retry deduplication.

## 2026-10-18 — Workflow increment 4: live queue controls

- Expose live 1–5-tab capacity, immediate refill on increase, and safe reductions without closing review tabs.
- Add links to running/paused queues with the pinned preset, atomic deduplication, and a 100-job total limit.
- Distinguish submitted, unfinished and abandoned history; require explicit resume/retry and keep submitted jobs excluded.
- Allow Abandon during a stalled fill, cancel the writer, record Abandoned and close only the owned tab before replacement.
- Reject stale queue controls, release closed blocked slots, and show recoverable tab-closure failures.

## 2026-10-17 — Workflow increment 3: review and learning

- Prioritize required gaps and review items, with green Verified, amber Review, red Missing and neutral Entered by you labels. Keep completed results under a collapsible list.
- Add Show field to locate a live question with one scroll/focus; reject hidden, changed, navigated or stale targets without capturing answers.
- Compare current values with local read-back signatures so manual edits no longer stay green. Preserve user edits and distinguish them from partial writer failures.
- Clearly name Profile versus Memory destinations, show mixed-batch counts, and bring the confirmation editor into view after capture.
- Prevent autofill focus and virtualized dropdown searches from scrolling the job page.
- Fix wrapping labels inheriting nearby headings, dropdown options or textarea answers, improving Memory matching without adding AI calls.
- Remove unused outline references that retained detached controls during dynamic application flows.

## 2026-10-17 — Workflow increment 2: login and resume

- Recognize visible sign-in, account creation and verification screens; leave credentials and codes untouched.
- Show Sign in required and Open to sign in while other queued jobs continue. Resume on the original application after same-tab navigation or a dynamic form transition.
- Persist a fixed 30-minute wait bound and recover after worker restarts. Stop, Skip, closure and browser-session changes cancel automatic resume.
- Bind resumed claims to the owned tab, original job and one frame. Unrelated jobs and unsupported redirects require returning to the original application.
- Individual fills explain the login step and offer Fill this page once the form appears. Bind sidebar status to the reporting page URL.

## 2026-10-17 — Workflow increment 1: workflow presentation and location fixes

- Fix applicant location dropdowns selecting a different city with a shared prefix. Match saved city/state/country, support CA/California and US equivalents, reject ambiguous results, and verify the committed place before marking green. Missing typeahead suggestions stay unresolved.
- Follow up location searches: remove duplicated saved City qualifiers, use complete place queries instead of state-only/truncated guesses, wait for matching delayed results, and refuse outdated content scripts on manual fills after extension reload.

- Pin Fill this page above optional sidebar sections, preserving it during scroll, collapse, and reordering.
- Share workflow status/action rules between current-page summaries and queue cards; old results cannot unlock capture during a retry.
- Reveal missing-answer review when filling finishes without moving focus; put detailed counts behind Fill details.
- Allow an independent manual fill while unrelated queue jobs are filling, retaining per-tab/preset ownership checks.
- Discard stale sidebar tab/status reads after switching applications.
- Add incremental implementation checkpoints to the shared workflow proposal. Later increments listed above document the review, queue and submission work completed since this initial increment.

## Unreleased — Queue review and confirmed progression

- Use the same stable-field readiness and changed-empty-field recovery for queue and manual fills.
- Keep answer capture live after writing, separate optional metadata reporting, and retain review tokens across exact form rerenders.
- Add Stop autofill & review to cancel a slow writer before entering manual review without losing page answers.
- Add a continuous 1–5-tab window that replaces one finished application at a time; retain optional batch mode.
- Optionally detect supported Greenhouse success only after a user submit action, then record submission, close the owned tab and queue the next job. Validation failures and unsupported confirmation stay manual.

## Unreleased — Application review queue

- Fill all current-batch tabs independently; slow AI or a missing form no longer holds the rest.
- Fill known Profile and Memories fields before optional AI matching; bound network waits and ignore cancelled results.
- Restart an active fill from the queue or top Fill action while preserving existing page answers.
- Compact sidebar sections remember open/closed choices and drag order. Fill and Queue come first by default, Applications last. Settings → Sidebar controls optional categories; Setup and Track start hidden. Link drafts survive panel reopening.
- Separate missing-question review and confirmed Memory capture into Review & remember, with a bounded scrolling question list. Fill keeps a short application summary.
- Queue cards prioritize Review and Submitted, keep failure Retry visible, and place refill/skip/details under More.
- Dismiss stopped/completed queue notices with a small ×; remember dismissal across sidebar reopening without changing queue progress.

- Replace single-link entry with a multiline list, preview, duplicate removal and existing-application review.
- Process up to 100 links in configurable batches of 1–5 tabs (default 3), independent background fills.
- Wait for every current application to be explicitly submitted or skipped before opening the next batch.
- Pin preset documents and prepared answers; use current Profile and Memories for each new fill.
- Add pause/resume/stop, manual step filling, retry and actionable missing-form/closed-tab feedback.
- Persist attempts and tab/frame ownership, recover worker interruptions and pause after browser restarts.
- Keep document snapshots separate from progress records; unopened links create no tabs or PDF copies.
- Record submission locally before optional Sheets writes; skipped jobs become Abandoned, with no Sheets write.
- Add the alarms permission for durable timeout/recovery checks; no new dependency or backend.
- Retain manual website submission, user-edit preservation and explicit Memories capture.


## Unreleased — Profile-aware saving and simpler Memories

- Keep capture/Save all in the sidebar; browse and manage Memories in Settings.
- Save supported captured facts to the profile with replacement confirmation and atomic mixed batches.
- Protect concurrent profile edits and check education levels before GPA learning/reuse.
- Match GPA dropdowns numerically; skip different scores and ambiguous ranges.
- Explicitly relink a matching fixed Memory when confirming its profile update, preserving wording/scope.
- Simplify reuse choices while retaining company/site limits and existing scopes.
- Use consistent accessible deletion dialogs for Memories, documents, skills, profile entries and local data.
- Respect spreadsheet tab links, display tab names, add read-only connection tests, preserve occupied
  cells/formulas and recognize repeated posting URLs during retries.
- Explain missing Google sign-in configuration when connecting a pasted sheet link, with setup steps.
- No new dependencies or permissions. Live OAuth testing requires the README’s client-ID setup.

## 2026-10-06 — Memories improvements

- Remember multiple selections for one question, including supported dropdowns, checkbox groups and
  React-select controls. Each selection can have approved alternate labels for future applications.
- Save several manually answered questions together with **Save all answered questions**. Review
  answers and reuse scopes before saving; stale answers or conflicts stop the entire batch.
- Quickly edit or delete memories in the application sidebar, including memories for completed fields.
  Updates apply to future fills and preserve the current page answers.
- Rename **Saved answers** to **Memories** and revamp its Settings tab with inline editors, improved
  search, answer-type filters, sorting, result counts and visible save/cancel/delete feedback.
- Preserve memory usage history when editing, keep drafts reachable if another window deletes a record,
  and continue supporting existing Settings bookmarks and stored memories.

Validated with 291 unit tests and 12 Chromium extension tests, plus type checking, production build,
and repository checks. No new permissions or dependencies.
