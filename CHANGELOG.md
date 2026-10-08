# Changelog

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
