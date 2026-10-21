# Controlled workflow benchmark

Recorded **2026-10-20 at 15:58 PDT (UTC−07:00)**, version 0.2.0, Windows, Node.js 22.23.3,
Chromium 153.0.8010.12. Reproduce with `npm run benchmark`; the raw report is written to ignored
`local-data/benchmarks/latest.json`. CI retains that report as an artifact.

Three rounds each filled three local fictional forms through the Greenhouse, Lever and Ashby adapters.
Forms use identical controlled HTML, not downloaded employer forms. Each contains ten eligible facts/
approved Memories, including a multiselect and conditional question. Transcripts and an unprepared
company-specific essay are excluded. AI is disabled.

| Measurement | Result |
| --- | --- |
| Applications exercised | 9, three open at once |
| Correct eligible answers | 90 / 90 (100% on this fixture) |
| Incorrect nonempty answers | 0 / 90 |
| Observed time from queue start to review | 4.571–4.810 seconds; median 4.602 seconds |
| Three idle forms without the extension: page JS heap | 3,820,664 bytes |
| Three filled forms: page JS heap | 9,287,940–9,318,484 bytes |
| DOM nodes: idle / filled | 532 / 568–572 |
| User correction preserved on retry | Passed in each round; same application record reused |
| Automatic submissions | 0 |

Review-state polling has 100–400ms resolution. Heap measurements are page-reported snapshots without
forced GC. They exclude the extension worker/sidebar, GPU, browser and other renderer memory, and
must not be described as total Chrome RAM or total extension overhead. The baseline browser does not
load the extension. Browser initialization, local fixture serving and machine load affect these results.

These results demonstrate a reproducible supported fixture, not general employer coverage. The larger
regression suite separately exercises custom dropdowns, login, storage, recovery and submission guards.
Human review time, applications per minute on real sites, whole-browser RAM, and manual time savings
remain unmeasured. Use those limitations alongside any portfolio claim.
