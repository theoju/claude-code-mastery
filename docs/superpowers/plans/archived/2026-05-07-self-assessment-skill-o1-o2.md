# self-assessment skill audit follow-ups (O1+O2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two small docs improvements to `.claude/skills/self-assessment/`: convert section-targeted plain-text cross-references to GitHub anchor links (O1), and close the asymmetric cross-reference between sibling slash commands by adding `/refresh-insights` to SKILL.md's `## Pointers` section (O2).

**Architecture:** Two file edits + one ship task. O1 touches `signals.md` line 58 (only place with a section-targeted plain-text reference; setup.md line 88 references signals.md as a whole and is fine). O2 touches `SKILL.md` `## Pointers` section. Both changes are pure documentation; no scorer code, no tests run except `npx vitest run` smoke check before commit.

**Tech Stack:** Markdown, GitHub auto-slug heading anchors (lowercase + hyphens, special chars stripped).

---

### Task 1: O1 — Convert section-targeted reference in `signals.md` to a GitHub anchor link

**Files:**

- Modify: `.claude/skills/self-assessment/signals.md:58`

**Context:** Line 58 currently reads:

```
See [`gotchas.md`](./gotchas.md) → "Hook execution score capped despite many hooks configured".
```

The reader has to open `gotchas.md` and scroll/search for the heading. A GitHub anchor link jumps directly to it. The target heading is `## Hook execution score capped despite many hooks configured` in `gotchas.md:46` — GitHub's auto-slug for that heading is `hook-execution-score-capped-despite-many-hooks-configured` (lowercase, spaces → hyphens, no other special chars to strip).

`setup.md:88` contains `See [`signals.md`](./signals.md)` as a whole-file reference (no section pointer), so it does **not** need conversion.

- [ ] **Step 1: Verify the heading slug**

Run: `grep -n "^## Hook execution" /Users/theo/Projects/claude-extensions/.claude/skills/self-assessment/gotchas.md`
Expected: `46:## Hook execution score capped despite many hooks configured`

This confirms the heading text exactly matches the slug we'll use.

- [ ] **Step 2: Edit `signals.md` line 58**

Use Edit tool on `/Users/theo/Projects/claude-extensions/.claude/skills/self-assessment/signals.md`:

old_string:

```
 Without this, every fresh user would get hard-zeroed on hook execution. See [`gotchas.md`](./gotchas.md) → "Hook execution score capped despite many hooks configured".
```

new_string:

```
 Without this, every fresh user would get hard-zeroed on hook execution. See [Hook execution score capped despite many hooks configured](./gotchas.md#hook-execution-score-capped-despite-many-hooks-configured) in `gotchas.md`.
```

- [ ] **Step 3: Verify the change**

Run: `grep -n "hook-execution-score-capped" /Users/theo/Projects/claude-extensions/.claude/skills/self-assessment/signals.md`
Expected: line 58 contains the new anchor URL.

Run: `grep -c '→ "Hook execution' /Users/theo/Projects/claude-extensions/.claude/skills/self-assessment/signals.md`
Expected: `0` (the old plain-text form is gone).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/self-assessment/signals.md
git commit -m "$(cat <<'EOF'
docs(self-assessment): convert section-targeted gotchas.md reference to anchor link

O1 from third re-audit. signals.md previously referenced a specific
gotchas.md section by quoting its heading text — readers had to open
the file and scroll. Replace with a GitHub anchor link that jumps
directly to the section.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: O2 — Add `/refresh-insights` cross-reference to SKILL.md `## Pointers`

**Files:**

- Modify: `.claude/skills/self-assessment/SKILL.md:30-35`

**Context:** PR #26 added a cross-reference from `.claude/commands/refresh-insights.md` back to `/self-assessment` (and to `README.md#running-the-full-workflow`). The reverse direction was not added — `SKILL.md` doesn't tell a reader of `/self-assessment` that `/refresh-insights` exists or how the two pair. Closing the loop in `## Pointers` makes the daily workflow chain discoverable from either entry point.

The current `## Pointers` section:

```
## Pointers

- Tune at `app/data/rubric.json` (titles, weights, targets, noise floors, next-action lists).
- Scoring logic: `scripts/score.mjs`. Explainer copy: `app/lib/dimension-explainer.ts` → renders at `/dimensions/<id>` on the dashboard.
- Cloud routine (07:15 daily run): `ROUTINE.md`.
- Human-facing user guide: `docs/self-assessment.md`.
```

- [ ] **Step 1: Edit SKILL.md `## Pointers` section**

Use Edit tool on `/Users/theo/Projects/claude-extensions/.claude/skills/self-assessment/SKILL.md`:

old_string:

```
## Pointers

- Tune at `app/data/rubric.json` (titles, weights, targets, noise floors, next-action lists).
- Scoring logic: `scripts/score.mjs`. Explainer copy: `app/lib/dimension-explainer.ts` → renders at `/dimensions/<id>` on the dashboard.
- Cloud routine (07:15 daily run): `ROUTINE.md`.
- Human-facing user guide: `docs/self-assessment.md`.
```

new_string:

```
## Pointers

- Tune at `app/data/rubric.json` (titles, weights, targets, noise floors, next-action lists).
- Scoring logic: `scripts/score.mjs`. Explainer copy: `app/lib/dimension-explainer.ts` → renders at `/dimensions/<id>` on the dashboard.
- Cloud routine (07:15 daily run): `ROUTINE.md`.
- Human-facing user guide: `docs/self-assessment.md`.
- Companion slash command: `/refresh-insights` (`.claude/commands/refresh-insights.md`) — files the markdown that Claude Code's `/insights` already produced into the dashboard's narrative section. Pair them as the daily workflow: `/refresh-insights && /self-assessment ...`.
```

- [ ] **Step 2: Verify the change**

Run: `grep -n "refresh-insights" /Users/theo/Projects/claude-extensions/.claude/skills/self-assessment/SKILL.md`
Expected: at least one match in the `## Pointers` section.

Run: `awk '/^## Pointers/,/^## |^$/' /Users/theo/Projects/claude-extensions/.claude/skills/self-assessment/SKILL.md | grep -c refresh-insights`
Expected: `1` (the new bullet is inside the `## Pointers` section, not stranded above or below).

- [ ] **Step 3: Smoke-test that nothing else regressed**

Run: `cd /Users/theo/Projects/claude-extensions && npx vitest run 2>&1 | tail -20`
Expected: all tests pass (the docs change shouldn't affect tests, but confirm the suite is clean before opening a PR).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/self-assessment/SKILL.md
git commit -m "$(cat <<'EOF'
docs(self-assessment): cross-reference /refresh-insights from SKILL.md Pointers

O2 from third re-audit. PR #26 added a one-way reference from
/refresh-insights to /self-assessment but didn't close the loop in the
reverse direction. Adding the companion-command pointer makes the daily
workflow chain (/refresh-insights && /self-assessment ...) discoverable
from either entry point.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Ship via PR

**Files:** No edits — git workflow only.

- [ ] **Step 1: Create feature branch and push**

Run from `/Users/theo/Projects/claude-extensions`:

```bash
git checkout -b chore/self-assessment-skill-audit-o1-o2
git push -u origin chore/self-assessment-skill-audit-o1-o2
```

Expected: branch created, push succeeds, upstream tracking set.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "docs(self-assessment): anchor link + companion-command cross-reference (O1+O2)" --body "$(cat <<'EOF'
## Summary

Two follow-up docs improvements from the third re-audit of the `self-assessment` skill against Thariq's 9 design principles:

- **O1** — `signals.md` referenced a specific `gotchas.md` section by quoting its heading text; readers had to open the file and scroll. Now an anchor link.
- **O2** — `SKILL.md` `## Pointers` section didn't reference the sibling `/refresh-insights` slash command. PR #26 added the reverse direction; this closes the loop so the daily workflow chain is discoverable from either entry point.

## Test Plan

- [ ] `npx vitest run` — all tests pass (docs change, but confirm clean).
- [ ] Open `signals.md` rendered on GitHub: anchor link jumps to the right `gotchas.md` heading.
- [ ] Open `SKILL.md` rendered on GitHub: `## Pointers` lists `/refresh-insights` with the daily-chain example.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 3: Squash-merge and clean up**

```bash
gh pr merge --squash --delete-branch
git checkout main
git pull
git fetch --prune origin
```

Expected: PR squash-merged, remote branch deleted, local main synced, stale remote-tracking ref pruned.

- [ ] **Step 4: Verify final state**

```bash
git log --oneline -3
git status
git branch -vv
```

Expected: top commit is the squash of O1+O2 on main; working tree clean; no stale `chore/self-assessment-skill-audit-o1-o2` branch locally.
