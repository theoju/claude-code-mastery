---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/114
synthesized_into: []
---

# Plans archive housekeeping (2026-06-01)

PR #114 moved four shipped engineering plans from `docs/superpowers/plans/` into
`docs/superpowers/plans/archived/`. No content was changed — this is a pure
rename to close open items from the plans-audit process.

## What moved

The archived plans correspond to features delivered in PRs #94, #104, #108,
and #110. Each plan had already shipped before this housekeeping run; the
move stamps them as closed without altering their content.

## Why it matters

The plans-audit process flags any landed plan that hasn't been archived yet.
Leaving shipped plans in the active directory pollutes the live queue and
makes it harder to see what's still in flight. Archiving on delivery is the
right discipline — this PR catches up the backlog.

## User impact

None. This is internal engineering planning hygiene. No scoring logic, signals,
dashboard behavior, or public API changed.
