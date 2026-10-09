# Changelog

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
