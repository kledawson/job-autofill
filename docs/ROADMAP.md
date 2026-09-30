# Roadmap

## Completed foundation

- Shared instructions with Codex and Claude entry points.
- Directory boundaries, architecture, and initial contracts.
- Contribution workflow, issue/PR templates, and repository checks.

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
