# Roadmap

## Completed foundation

- Shared instructions with Codex and Claude entry points.
- Directory boundaries, architecture, and initial contracts.
- Contribution workflow, issue/PR templates, and repository checks.

## Implemented remembered mappings

- Explicit capture/confirmation of a selected page answer; missing cards remain teachable after manual entry.
- Searchable Settings → Memories, compact cards, advanced aliases/profile links, and last-used dates.
- Shared inline memory editing/deletion in the current-page sidebar and Settings; completed questions
  remain manageable. Search across wordings/answers/choice aliases/scopes, answer-type filters, sorting,
  result counts, keyboard focus and visible save/cancel/delete feedback. Legacy Settings links still work.
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

Later extensions: mapping import/export, profile-linked selection arrays, Workday multi-select widgets, broader tested local intent/category
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
