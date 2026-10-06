# Design decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-09-30 | Extension first; backend deferred | Fill forms in the existing browser session and keep MVP manageable |
| 2026-09-30 | Local profile, JSON import/export, CSV history export | Nested profile data and immediate personal usefulness |
| 2026-09-30 | Preview and manual submission | Verify answers before committing an application |
| 2026-09-30 | AGENTS.md is canonical; CLAUDE.md imports it | Avoid instruction drift between assistants |
| 2026-09-30 | Short-lived task branches with PR review | Keep integrations small and main usable |
| 2026-10-05 | Fill any site: Workday adapter, generic adapter, optional `<all_urls>` host permission requested at first use | Most applications are on Workday or company sites. The permission is optional and requested from a click, and pages are read only when the person fills them; injection is on demand rather than a content script on every page |
| 2026-10-05 | AI field matching for unrecognised questions maps to profile keys, never free values | Covers unusual wording on unknown sites without inventing facts; only question text is sent |

Add rationale when a decision changes. Distinguish planned architecture from implemented behavior.
