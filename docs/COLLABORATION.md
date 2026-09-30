# Collaboration setup

## Owner setup

1. Invite the friend using repository Settings -> Collaborators -> Add people. Choose the account carefully; this setup does not send an invitation.
2. After the first CI run, configure a rule for `main` when supported by the GitHub plan: require a pull request, one approving review, and the `Repository checks` status check. Apply rules to administrators if desired.
3. Private-repository protection availability depends on the plan. Until enabled, PR/review requirements are team conventions, not enforced settings.
4. Prefer squash merging small task PRs and automatically deleting merged branches.
5. Create the milestone-1 scaffold/contracts issue together, then split milestone-2 work.

## Friend onboarding

Clone the repository on your own machine, read `AGENTS.md`, and run `npm run check` with Node 22. Start Claude Code from the repository root. `CLAUDE.md` imports the canonical guide. Inspect `/memory` or ask the assistant to summarize the shared rules to confirm loading.

## Task coordination

Use issues or draft PRs as visible claims. Include scope and shared files affected. Assistant chat histories are not shared automatically: record durable decisions in docs and task findings in the issue/PR.

Keep main short-lived branch examples such as `codex/profile-editor` and `feature/form-detection` in documentation; create real branches only when work begins. Empty permanent branches add no isolation beyond a clean starting commit.

## Updating instructions

Change `AGENTS.md` through a reviewed PR. Keep the Claude import unchanged. After pulling the change, explicitly ask existing sessions to re-read it or restart them. Do not assume either assistant continually watches instruction files.
