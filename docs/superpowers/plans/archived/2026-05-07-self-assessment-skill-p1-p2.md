# Self-Assessment Skill P1+P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the `description` field of `.claude/skills/self-assessment/SKILL.md` to remove implementation prose and add missing trigger phrases (P1), and document the intentional `${CLAUDE_PLUGIN_DATA}` deviation in `signals.md` (P2).

**Architecture:** Two surgical edits to the existing skill folder, no new files, no scripts, no behavioral changes. The skill is read-only metadata as far as runtime is concerned — these edits change discoverability and clarity, not execution. One PR, one commit.

**Tech Stack:** Markdown only. No code, no tests, no build step. Verification is content review (does the description still trigger? does the deviation note explain the why?) plus the existing 223-test vitest suite must remain green since the skill folder participates in nothing tested.

---

## Background

Today's audit against Thariq's 9 skill-authoring principles graded `.claude/skills/self-assessment` as **A−**. Two improvement levers are worth shipping now:

- **P1 (principle 5 — description = trigger):** Current description ends with implementation prose ("Reads ~/.claude/\* state, writes app/data/assessment.json…") that doesn't help triggering. Missing common phrasings the user might say: "rate my setup", "audit my claude code", "mastery score".
- **P2 (principle 7 — memory & storing data):** Skill writes to `app/data/` instead of Thariq's recommended `${CLAUDE_PLUGIN_DATA}`. The deviation is intentional (data is consumed by the colocated Next.js dashboard) but is not written down anywhere — a future reader can't tell whether it's a violation or a deliberate choice.

P3, P4, P5 from the audit are deferred (P3 is polish; P4/P5 depend on future state).

## File Structure

Two files modified in the existing skill folder. No new files, no deletions.

```
.claude/skills/self-assessment/
  SKILL.md          ← P1: tighten description field (1 line replaced)
  signals.md        ← P2: add deviation note in "What gets written" section (1 paragraph added)
```

Verification surface (no edits):

```
scripts/__tests__/   ← full vitest suite must stay green (223 tests, 0 changes expected)
```

## Self-Review Anchors

- **Type consistency:** N/A — no code, no types.
- **Spec coverage:** P1 covers principle 5; P2 covers principle 7. P3/P4/P5 are out of scope by user choice.
- **Placeholder scan:** None. Both edits use exact text below.

---

## Task 1: Tighten the description field (P1)

**Files:**

- Modify: `.claude/skills/self-assessment/SKILL.md:3` (the YAML frontmatter `description:` line — single line, no surrounding code blocks change)

**Why:** The description field is what Claude scans across all installed skills to decide whether to trigger one. Implementation prose at the tail ("Reads ~/.claude/\* state, writes app/data/assessment.json, appends history, optionally posts to Slack") doesn't help triggering — Claude doesn't pick a skill based on what it writes. Three common phrasings ("rate my setup", "audit my claude code", "mastery score") are missing.

- [ ] **Step 1: Read the current line to confirm exact text before editing**

Run: `sed -n '3p' .claude/skills/self-assessment/SKILL.md`

Expected output (one long line, abbreviated here):

```
description: Score Claude Code usage against the 12-dimension Mastery rubric (weighted by Boris Cherny's 87 tips). Trigger on "score me", "mastery audit", "self-assessment", "how am I doing with claude code", "am I improving", "/self-assessment". Reads ~/.claude/* state, writes app/data/assessment.json, appends history, optionally posts to Slack.
```

This is the line we replace. Confirm it matches before editing — if it differs, the skill description has been edited since this plan was written, and the engineer should reconcile before proceeding.

- [ ] **Step 2: Replace the line via the Edit tool**

Use the Edit tool (not `sed`) so the change is reviewable in transcript and unambiguous about preserving surrounding YAML frontmatter delimiters.

`old_string` (verbatim, this is the entire current line):

```
description: Score Claude Code usage against the 12-dimension Mastery rubric (weighted by Boris Cherny's 87 tips). Trigger on "score me", "mastery audit", "self-assessment", "how am I doing with claude code", "am I improving", "/self-assessment". Reads ~/.claude/* state, writes app/data/assessment.json, appends history, optionally posts to Slack.
```

`new_string` (verbatim — drops implementation tail, adds three new trigger variants, keeps every existing trigger phrase):

```
description: Score Claude Code usage on two axes (Platform Setup vs Execution) using the 12-dimension Mastery rubric. Trigger on "score me", "mastery audit", "self-assessment", "rate my setup", "audit my claude code", "mastery score", "how am I doing with claude code", "am I improving", "/self-assessment".
```

Notes for the engineer:

- The new description is **shorter** (drops 87 chars of implementation prose, adds 51 chars of new triggers).
- The summary clause now mentions the two-axis scoring model — that aligns with how the project's CLAUDE.md describes the system (`## Scoring model — Two independent axes, never collapsed`) and with PR #21 which made the Slack post two-axis. This makes the description simultaneously a trigger and a contract: any future skill output that collapses the axes contradicts its own description.
- All six original trigger phrases are preserved (no regressions for existing user habits).
- The `/self-assessment` slash-command form is preserved as a trigger (the project ships a slash command of this name — `.claude/commands/self-assessment.md`).

- [ ] **Step 3: Confirm the YAML frontmatter still parses**

Run: `head -5 .claude/skills/self-assessment/SKILL.md`

Expected:

```
---
name: self-assessment
description: Score Claude Code usage on two axes (Platform Setup vs Execution) using the 12-dimension Mastery rubric. Trigger on "score me", "mastery audit", "self-assessment", "rate my setup", "audit my claude code", "mastery score", "how am I doing with claude code", "am I improving", "/self-assessment".
---

```

The leading `---`, `name:` line, new `description:` line, and trailing `---` must all be present in this order. If any are missing, the YAML frontmatter is broken and the skill will not load.

- [ ] **Step 4: Run the test suite (must stay green — no skill content is tested, but defense-in-depth)**

Run: `npx vitest run`

Expected: `Test Files  16 passed (16)` and `Tests  223 passed (223)`. If the count differs from 223, that's fine as long as everything passes — the suite grows over time. Failures here would mean something else broke unrelated to this edit; investigate before continuing.

## Task 2: Document the `${CLAUDE_PLUGIN_DATA}` deviation (P2)

**Files:**

- Modify: `.claude/skills/self-assessment/signals.md:44-50` (the "What gets written" section — add one paragraph at the end of that section, before the next H2 heading)

**Why:** Thariq's playbook recommends `${CLAUDE_PLUGIN_DATA}` because data inside a skill folder may be deleted on upgrade. This skill writes to `app/data/` instead. The deviation is intentional — the data is consumed by a Next.js dashboard colocated in the same repo, so portability across repos is a non-goal. But that intent is currently nowhere written. A future reader (or Thariq-audit-bot) sees the deviation and can't tell whether it's a bug or a deliberate trade.

- [ ] **Step 1: Read the current "What gets written" section to confirm exact context before editing**

Run: `sed -n '43,52p' .claude/skills/self-assessment/signals.md`

Expected output (the section heading, the three bullet lines, and the lead-in to the next section):

```
## What gets written

- `app/data/assessment.json` — current snapshot. Re-rendered by the dashboard at `npm run dev` (http://localhost:3737).
- `app/data/assessment-history.json` — gitignored trend series. Local only.
- Slack webhook (if `slack.enabled: true` and `SLACK_WEBHOOK_URL` is set) — fire-and-forget summary post. Failures log a warning; they don't fail the run.

The CLAUDE.md auditor (when `claudeMd.targets` is configured) reads each target but writes **nothing** — `mode: "report-only"` is the only mode shipped, and the scorer reports aggregate stats only (no paths or per-file detail).

## How counts stay honest
```

This locates the insertion point: the new paragraph goes between the existing CLAUDE.md auditor sentence and the `## How counts stay honest` heading. Confirm it matches before editing.

- [ ] **Step 2: Insert the deviation paragraph via the Edit tool**

Use the Edit tool. We anchor on the last sentence of the existing "What gets written" section (the CLAUDE.md auditor sentence) and append a paragraph after it, leaving a blank line before `## How counts stay honest`.

`old_string` (verbatim — anchors on the CLAUDE.md auditor sentence and the blank line + next H2 to make the match unique):

```
The CLAUDE.md auditor (when `claudeMd.targets` is configured) reads each target but writes **nothing** — `mode: "report-only"` is the only mode shipped, and the scorer reports aggregate stats only (no paths or per-file detail).

## How counts stay honest
```

`new_string` (verbatim — same first paragraph, then a blank line, then the new deviation paragraph, then a blank line, then the next H2):

```
The CLAUDE.md auditor (when `claudeMd.targets` is configured) reads each target but writes **nothing** — `mode: "report-only"` is the only mode shipped, and the scorer reports aggregate stats only (no paths or per-file detail).

`app/data/` is used instead of `${CLAUDE_PLUGIN_DATA}` because the assessment is rendered by a Next.js dashboard colocated in the same repo. The data path is project-scoped on purpose — this skill is not portable across repos and is not intended to be installed via the marketplace. If the dashboard is ever extracted into its own repo, the storage path becomes a real decision.

## How counts stay honest
```

Notes for the engineer:

- The deviation note explains both **what** is different (path) and **why** (colocated dashboard rendering).
- It also explains **when this would change** (extraction into a separate repo) — which gives a future maintainer a concrete trigger to revisit the decision.
- The phrase "not intended to be installed via the marketplace" is a deliberate signal: anyone who tries to package this skill for distribution will hit this paragraph and know they need to reroute storage first.

- [ ] **Step 3: Verify the file still has clean section structure**

Run: `grep -n '^##' .claude/skills/self-assessment/signals.md`

Expected:

```
3:## Default-mode reads
27:## Behavioral-mode reads (`includeTranscripts: true` or `--include-transcripts`)
43:## What gets written
54:## How counts stay honest
65:## Privacy
```

The line numbers will shift slightly after the insertion (`## How counts stay honest` will move down by ~3 lines from its current line 54). What matters is that all five H2 headings are still present and in this order. If any heading is missing or out of order, the edit went wrong.

- [ ] **Step 4: Confirm no other markdown is broken (no orphan code fences, no broken links)**

Run: `awk '/^```/{c++} END{print c, "code fences (must be even)"}' .claude/skills/self-assessment/signals.md`

Expected: an even number followed by `code fences (must be even)`. The current file has zero code fences in the section we're editing, so the count should match what was there before. An odd number means a code fence was orphaned.

## Task 3: Commit, push, PR, merge

**Files:**

- No file edits in this task — git operations only.

**Why:** Both edits are tiny and tightly related (same skill, same audit pass). Single commit, single PR, squash-merge to keep `main`'s history readable.

- [ ] **Step 1: Verify clean working tree before branching**

Run: `git status --porcelain`

Expected: only the two modified files:

```
 M .claude/skills/self-assessment/SKILL.md
 M .claude/skills/self-assessment/signals.md
```

If anything else appears (untracked files, other modified files), stop and reconcile — those changes don't belong in this PR.

- [ ] **Step 2: Create the feature branch**

Run: `git checkout -b chore/self-assessment-skill-audit-p1-p2`

Expected: `Switched to a new branch 'chore/self-assessment-skill-audit-p1-p2'`

Branch naming follows the repo's existing convention (PR #23 used `docs/correct-target-flag-and-memory`; PR #21 used `fix/slack-two-axis-form`). `chore/` is appropriate here because this is neither a bug fix nor a feature — it's metadata polish.

- [ ] **Step 3: Stage and commit**

Run:

```bash
git add .claude/skills/self-assessment/SKILL.md .claude/skills/self-assessment/signals.md
git commit -m "$(cat <<'EOF'
Tighten self-assessment skill description and document data-path deviation

Two surgical changes from today's Thariq-playbook audit (audit graded
the skill A-, with these as the only worth-shipping-now items):

P1 (description = trigger): Drop implementation prose from the
description field and add three missing trigger phrases ("rate my
setup", "audit my claude code", "mastery score"). The new summary
clause mentions the two-axis scoring model, aligning the description
with how CLAUDE.md and PR #21 describe the system.

P2 (memory & storing data): Add a paragraph to signals.md explaining
why the skill writes to app/data/ instead of \${CLAUDE_PLUGIN_DATA}.
The deviation is intentional — data is consumed by the colocated
Next.js dashboard — but the rationale was nowhere written. Future
maintainers (and audit bots) can now see the decision and the
condition under which it would need to change (repo extraction).

No code, no tests, no behavioral change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: a single commit hash printed, "2 files changed".

- [ ] **Step 4: Push and open PR**

Run:

```bash
git push -u origin chore/self-assessment-skill-audit-p1-p2
gh pr create --base main --title "Tighten self-assessment skill description and document data-path deviation" --body "$(cat <<'EOF'
## Summary

Two surgical changes from today's Thariq-playbook audit of \`.claude/skills/self-assessment\` (audit composite grade: A-, these were the only worth-shipping-now items).

### P1 — description = trigger
- Drop implementation prose ("Reads ~/.claude/* state, writes app/data/assessment.json...") from the description field. Implementation detail doesn't help triggering — Claude doesn't decide which skill to use based on what it writes.
- Add three missing trigger phrases: \`rate my setup\`, \`audit my claude code\`, \`mastery score\`.
- New summary clause mentions the two-axis scoring model, aligning the description with CLAUDE.md (\`## Scoring model — Two independent axes, never collapsed\`) and PR #21 (Slack two-axis form).
- All six existing trigger phrases preserved.

### P2 — data-path deviation note
- Skill writes to \`app/data/\` instead of \`\${CLAUDE_PLUGIN_DATA}\`. Intentional — data is consumed by the colocated Next.js dashboard, so portability across repos is a non-goal.
- The rationale was nowhere written. Now documented in \`signals.md\` under "What gets written", including the trigger condition for revisiting the decision (extraction into a separate repo).

### Out of scope
- P3 (gotchas anchor links — polish), P4 (on-demand /insights guard hook — wrong layer for a one-shot skill), P5 (split gotchas.md when it grows past ~20 entries — premature now at 12).

## Test plan
- [x] \`npx vitest run\` — 223 passed, no behavior changed
- [x] YAML frontmatter parses (\`head -5\` shows valid \`---/name/description/---\`)
- [x] \`signals.md\` H2 structure intact (5 sections in order)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed (e.g. `https://github.com/theoju/claude-code-mastery/pull/24`).

- [ ] **Step 5: Squash-merge and clean up**

Run:

```bash
gh pr merge <PR-NUMBER> --squash --delete-branch
git checkout main
git pull --ff-only
git fetch --prune origin
```

Replace `<PR-NUMBER>` with the actual PR number from Step 4.

Expected:

- `Squashed and merged.` confirmation from `gh pr merge`.
- `Already on 'main'` followed by `Fast-forward` from `git pull`.
- A `[deleted]` line from `git fetch --prune origin` clearing the stale remote-tracking ref.

- [ ] **Step 6: Verify clean final state**

Run:

```bash
git log --oneline -3
git status
git branch -a
```

Expected:

- Top commit on `main` is the squash-merged title.
- `nothing to commit, working tree clean`.
- Only `* main` and `remotes/origin/main` listed.

If any leftover branches or remote refs appear, run `git fetch --prune origin` again — per CLAUDE.md `## Conventions`, this is the universal fix for stale refs after `--delete-branch`.

---

## Notes for the executor

- **Edit tool, not `sed`.** Both file edits use the Edit tool because the `old_string`/`new_string` form is reviewable in transcript and unambiguous about preserving YAML frontmatter and surrounding markdown. Using `sed` for these edits would obscure intent and risk eating delimiters.
- **Don't auto-run `/insights`.** This is a hard rule from CLAUDE.md. Nothing in this plan should invoke it. If the executor feels tempted to "verify the trigger phrases work" by running `/self-assessment`, that's fine — the skill does not invoke `/insights` on its own per its own design. But never `/insights`.
- **Don't post to Slack as part of testing.** If you run `npm run assess` while testing, pass `--no-slack` or unset `SLACK_WEBHOOK_URL` first. The user has a daily 7:15 AM cloud routine; an extra Slack post mid-day is noise.
- **Stay in the project's PR cadence.** Do not skip the PR step and merge directly. The repo's commit history (recent: #20, #21, #22, #23) shows every change goes through a PR with a squash-merge, even tiny ones. This plan continues that cadence.
