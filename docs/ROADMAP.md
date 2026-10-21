# Roadmap

## Completed foundation

- Shared instructions with Codex and Claude entry points.
- Directory boundaries, architecture, and initial contracts.
- Contribution workflow, issue/PR templates, and repository checks.

## Implemented application queue

Review polish adds pinned cancellation, compact persistent application details, nested field navigation,
guarded uploads, relative availability and manual employer contact/address fields. Detected submissions
remain open until explicit Continue or closure. Redirected/new-tab forms can be explicitly attached to
their queue job with Use this page for this job; title/company similarity never grants access.

Workflow restructuring is approved for increments on the feature branch. See the
[proposal and checkpoints](WORKFLOW_RESTRUCTURE_PROPOSAL.md#implementation-checkpoints).
The first increment pins Fill, simplifies its summary, reveals missing-answer review, shares derived
workflow action rules between queue/current views, and permits independent manual fills during queue work.
The second increment recognizes authentication screens, persists bounded waiting, and safely resumes
the same queued job after sign-in without blocking other jobs. Standalone fills explain when to click
Fill again. The third increment adds evidence-based field priorities, explicit Show field, neutral
user edits, amber AI review, and clearer Profile/Memory confirmation. The fourth increment adds visible
live capacity, links added to running/paused queues, status-aware explicit resume/retry, stale-token
controls, and abandonment during stalled fills. The fifth increment shares submission detection,
manual fallback and independent Sheets retry. The sixth checkpoint hardens failed-closure capacity and
observer cleanup, adds visible build information and narrow-sidebar keyboard coverage, and supplies a
controlled benchmark plus a checked versioned review package. See the [review guide](RELEASE_REVIEW.md).

- Multiline link preview, duplicate detection and existing-application review.
- User-started 1–5-tab continuous queues with independent background fills and a per-tab review/submission barrier; optional legacy batch mode remains available.
- Pinned preset/documents, per-attempt ownership, persisted recovery and pause/stop/retry controls.
- Local confirmed submission independent of optional Sheets success.

- Compact persistent sidebar sections: Fill is permanently pinned; Queue initially opens; Review & remember reveals missing answers after filling, while presets and history initially close. Settings checkboxes hide/show optional categories; Setup and Track initially hidden. Compact Fill summary and Queue primary actions; Memory capture has its own bounded review list. Drag/keyboard reorder of optional categories persists; Applications appears last by default. Link drafts survive panel reopening.
- Restart stalled attempts without replacing manual answers; basic fields do not wait on optional AI. Shared readiness/local recovery improves queue/manual Memory parity. Stop autofill & review unlocks manual capture; exact rerenders retain review tokens.
- Shared Greenhouse, Lever and Ashby user-submission confirmation records success and retains the tab; explicit Continue/closure frees its slot. Unsupported confirmation requires manual Submitted.

Measured baseline: [90/90 eligible answers on nine fictional forms](BENCHMARK_RESULTS.md). Future work:
expand employer-specific coverage and measure human review time and whole-browser memory use.

## Implemented chat-website free responses

- A Free responses menu above Fill this page (and in Settings): None (first-time default), Gemini API,
  ChatGPT, Claude, Gemini (web) or Perplexity.
- Need review counts required questions only; optional ones are listed and outlined yellow.
- **Draft in …** per free response: prompt template rendered locally, copied, and placed in the chat's empty
  message box when its optional site permission is granted. The person sends it and pastes the reply.
- A draft card shown on every tab; **Use answer** fills only the still-empty field as an amber AI draft.

- **Draft all** asks every free response in one prompt; the pasted reply is split into one box per question.
- Clickable Need review list under the fill counts; answered questions leave it.
- Reloading an application page hides that fill's results until the next fill.
- Prompts include the posting link and, when the form lacks it, the description from the same-site posting.
  The default asks for 3–5 sentences within the question's character limit.

Later: Copilot once its new-chat address settles.

## Implemented application presets

- Role presets with shared personal facts, independent resumes/cover letters and portfolio links.
- Guided Settings editor, duplication, confirmed deletion and a sidebar selector with resume preview.
- Prepared text responses before AI and optional writing emphasis using existing Profile facts.
- Persistent per-application snapshots protect fills from later preset switches and worker restarts.

## Implemented remembered mappings

- Explicit capture/confirmation of a selected page answer; missing cards remain teachable after manual entry.
- Searchable Settings → Memories, compact cards, advanced aliases/profile links, and last-used dates.
- Dated Memories JSON backup/restore with validated previews, duplicates skipped, explicit keep/override
  conflict choices, multi-select/alias/scope preservation and atomic stale-safe restores.
- Separate restore review with side-by-side answer comparisons, grouped add/skip choices, collapsed
  identical items and an explicit added/replaced summary; the saved library remains separate.
- Sidebar capture and Save all confirmation; Memory browsing/editing/deletion live in Settings.
- Supported captured facts update the profile with replacement confirmation; mixed batches commit atomically.
  Education-level checks prevent GPA reuse across unrelated education entries.
- Simpler reuse controls with optional company/site limits; consistent accessible deletion dialogs.
- Sheets tab IDs, read-only connection tests, occupied-cell/formula preservation and URL-based retry detection.
- Guided **Improve future matching** sections with editable variation rows, readable scope/meaning help,
  current profile-value display and a local **Try a variation** preview; answered cards visibly offer
  **Save this answer**, while empty cards remain white.
- Local versioned persistence with conservative legacy migration, company/application/site/global scope,
  approved question meanings and alternate wordings, option equivalents, and conflict checks.
- Local suggestions for unfamiliar wording require confirmation; optional Gemini aliases require a click
  and individual approval. No AI calls are required for saved-answer reuse.
- Reuse before AI responses, including conditional fields, with existing-value preservation and verified dropdown selection.
- Unit coverage and a real-extension Chromium test for teaching, persistence, reuse, editing, and removal.
- Fixed multi-select answers with per-choice aliases, native/select checkbox-group/React-select capture,
  full-set matching and verified writes. Existing selections are preserved; missing choices stay manual.
- **Save all answered questions** captures only answered review fields, confirms answers and individual
  scopes together, and saves atomically. Stale captures or conflicting stored answers stop the batch.

Later extensions: profile-linked selection arrays, Workday multi-select widgets, broader tested local intent/category
coverage, local embeddings if measurement justifies them, explicit replacement of non-empty page answers,
and a stricter employer identity registry across platforms. Capture tokens deliberately expire on rerender/navigation.

## Milestone 1: shared baseline (merge before parallel feature work)

- WXT/React/TypeScript extension scaffold with minimal permissions.
- Zod profile schema, canonical types, versioned message contracts, and synthetic examples.
- Working development/build/typecheck/unit-test commands and CI.
- Manual installation instructions and one controlled test form.

## Milestone 2: parallel MVP work

| Track A: UI and persistence | Track B: forms and matching |
| --- | --- |
| Profile editor and JSON import/export | Field extraction and pure matching |
| Trusted local storage and migration | Explainable fill-plan generation |
| Preview UI and manual mappings | Approved writing and read-back verification |

Agree on contracts in milestone 1. Use separate issues, branches, and PRs; coordinate changes to shared files.

## Milestone 3: useful first release

- One selected ATS adapter based on the team's actual applications.
- Local tracker with explicit status updates and duplicate detection.
- CSV export.
- Meaningful Vitest/Playwright coverage for imports, ambiguity, user edits, dynamic forms, and repeat fills.
- Documentation, demo using fictional data, and measurements of precision, supported-field coverage, and time saved.

## Later

Additional adapters and widgets, Sheets sync, job-description fit analysis, grounded AI drafts, selected-board job discovery, and optional cloud accounts/sync. Prioritize after personal use identifies the largest friction.

All six workflow redesign checkpoints are implemented for branch review. Store publication, a merge to
main, real-employer throughput studies and broader platform support remain separate work.
