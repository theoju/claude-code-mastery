# /refresh-insights Slash Command G1+G2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing YAML frontmatter to `.claude/commands/refresh-insights.md` (G1) and add a cross-reference to the canonical daily workflow (G2). Both findings come from this morning's Thariq-playbook audit, which graded the file **B+** with G1 as a critical discoverability bug and G2 as a concrete improvement.

**Architecture:** Two surgical edits to a single 49-line slash-command file. G1 prepends 5 lines of YAML frontmatter at the top of the file. G2 adds a one-line cross-reference under the existing "Why a separate command" section. No new files, no scripts, no behavioral changes — both fixes affect discoverability and documentation only. Single PR, single commit.

**Tech Stack:** Markdown with YAML frontmatter only. No code, no tests. Verification is content review (does the new frontmatter parse? does the cross-reference render correctly?) plus the existing 223-test vitest suite must remain green (no test reads slash-command frontmatter, but defense-in-depth).

---

## Background

This morning's audit of `.claude/commands/refresh-insights.md` against Thariq's 9 principles surfaced:

- **G1 (CRITICAL — principle 5, description=trigger):** The file has **no YAML frontmatter at all** (no `description`, no `argument-hint`, no `allowed-tools`). The slash-command picker shows just `/refresh-insights` with the literal slug as the description (auto-generated fallback). Anyone browsing `/<TAB>` won't know what the command does without invoking it. The sibling `/self-assessment.md` has full frontmatter — this is an asymmetry to fix.
- **G2 (concrete — principle 5/discoverability):** The "Why a separate command rather than a flag on /self-assessment" section explains the _separation_ but not the _chain_. PR #22 documented the canonical `/insights → /refresh-insights && /self-assessment` chain in README.md. A user reading just this file won't find the chain.

G3 (data-path deviation note), G4 (style-asymmetry with sibling — informational), and G5 (section naming — very minor) are all deferred per the audit conclusion.

## File Structure

A single file is modified. No new files, no deletions, no spokes.

```
.claude/commands/
  refresh-insights.md   ← G1: prepend YAML frontmatter (5 lines); G2: add cross-reference (1 line)
```

Verification surfaces (no edits):

```
.claude/commands/self-assessment.md   ← sibling slash command with frontmatter — reference for G1's shape
README.md                              ← cross-reference target for G2 ("Running the full workflow" anchor)
scripts/__tests__/                     ← full vitest suite must stay green
```

## Self-Review Anchors

- **Type consistency:** N/A — no code, no types.
- **Spec coverage:** G1 covers the missing-frontmatter bug; G2 covers the missing chain reference. G3/G4/G5 are explicitly out of scope.
- **Placeholder scan:** None. Both edits use exact text below.

---

## Task 1: Add YAML frontmatter to the top of the file (G1)

**Files:**

- Modify: `.claude/commands/refresh-insights.md` (prepend 5 lines + a blank line at the very top, before the existing `# /refresh-insights` H1 heading)

**Why:** Without frontmatter, the slash-command picker has no description to render. The sibling slash command (`.claude/commands/self-assessment.md`) carries `description`, `argument-hint`, and `allowed-tools` — we mirror that pattern but tailored to this command's needs (no Bash needed, full overwrite means no Edit needed, no flags means empty argument-hint).

- [ ] **Step 1: Confirm the current file starts at line 1 with the H1 heading (no existing frontmatter)**

Run: `head -3 /Users/theo/Projects/claude-extensions/.claude/commands/refresh-insights.md`

Expected (verbatim):

```
# /refresh-insights

Imports the markdown summary printed by Claude Code's `/insights` command into the dashboard's inline narrative section. **User-initiated**: nothing is auto-captured. The summary is written verbatim to `app/data/insights-narrative.md` (gitignored), rendered locally on the dashboard, and never uploaded or posted to Slack.
```

If line 1 is `---` (frontmatter already exists) or anything other than `# /refresh-insights`, the file has drifted since the plan was written. STOP and report BLOCKED with the actual first three lines.

- [ ] **Step 2: Prepend the frontmatter via the Edit tool**

Use the Edit tool. We anchor the insertion on the existing first line (`# /refresh-insights`) so the prepend is unambiguous.

`old_string` (verbatim — the current first line):

```
# /refresh-insights
```

`new_string` (verbatim — frontmatter block + blank line + the original heading restored at the end):

```
---
description: File the markdown summary from a /insights run into app/data/insights-narrative.md (verbatim, gitignored, never posted to Slack). Run /insights first; this command never auto-fires it.
argument-hint:
allowed-tools: Read, Write
---

# /refresh-insights
```

Notes for the engineer:

- **Why `argument-hint:` is empty.** The command takes no flags. An empty value (with a colon and trailing newline) is valid YAML and matches the Claude Code convention of "field present but empty" for argument-less commands. Do **not** delete the line — keep the field for symmetry with `/self-assessment.md` so future maintainers don't think it was forgotten.
- **Why `allowed-tools: Read, Write`** (not the broader allow-list `/self-assessment.md` uses). This command's operation is: optionally read any pre-existing `app/data/insights-narrative.md`, then write the new content. Full overwrite — no in-place editing, no shell-out. Adding `Bash`, `Edit`, or other tools would be over-grant. Sticking to least-privilege.
- **Why the description leads with the action and ends with a usage gate.** Thariq's principle 5: descriptions are trigger conditions, not summaries. "File the markdown summary..." is the action; "Run /insights first; this command never auto-fires it" is the gate that prevents users from invoking it in the wrong order. The gate phrasing also encodes the file's most important hard rule (lines 14, 27 of the existing body).
- **Don't paraphrase.** The frontmatter `new_string` above is exact. Insert it verbatim.

- [ ] **Step 3: Verify the file now opens with valid frontmatter**

Run: `head -8 /Users/theo/Projects/claude-extensions/.claude/commands/refresh-insights.md`

Expected (line numbers shift by 6 — the original line 1 is now line 7):

```
---
description: File the markdown summary from a /insights run into app/data/insights-narrative.md (verbatim, gitignored, never posted to Slack). Run /insights first; this command never auto-fires it.
argument-hint:
allowed-tools: Read, Write
---

# /refresh-insights

```

The leading `---`, three field lines, trailing `---`, blank line, and original `# /refresh-insights` H1 must all appear in this order. If anything is missing or out of order, the slash command will fail to load (or worse, load with broken metadata).

- [ ] **Step 4: Confirm only this one file changed**

Run: `git status --porcelain` from `/Users/theo/Projects/claude-extensions`.

Expected:

```
 M .claude/commands/refresh-insights.md
?? docs/superpowers/
```

If anything else is modified, STOP and report BLOCKED.

## Task 2: Add cross-reference to the daily chain (G2)

**Files:**

- Modify: `.claude/commands/refresh-insights.md` — under the existing "Why a separate command rather than a flag on `/self-assessment`" H2 section, add one line that points to the canonical chain in README.md.

**Why:** PR #22 documented the canonical chain in README.md's "Running the full workflow" section. Anyone reading just `/refresh-insights.md` won't find the chain because nothing in this file references it. Adding one cross-reference line solves the discoverability gap without duplicating the README content.

- [ ] **Step 1: Confirm the target section is intact**

Run: `grep -n "Why a separate command" /Users/theo/Projects/claude-extensions/.claude/commands/refresh-insights.md`

Expected (after Task 1 prepend, the original line numbers shift by 6 — the H2 was at line 40, now at line 46):

```
46:## Why a separate command rather than a flag on `/self-assessment`
```

If the line number differs but the heading matches, that's fine — Task 1's prepend may have changed the offset. What matters is that the section heading text is unchanged. If the heading itself is missing or modified, STOP and report BLOCKED.

- [ ] **Step 2: Add the cross-reference line via the Edit tool**

Anchor on the existing closing sentence of that section + the next H2 heading. The current section text (verbatim, after Task 1 prepend) ends with:

> Different cadence. `/self-assessment` runs daily (cheap), `/insights` runs weekly-ish (token-heavy). Bundling them would either over-spend tokens or hide the `/insights` invocation from the user. Keeping `/refresh-insights` separate makes the data flow explicit: _you_ decide when to refresh the narrative.

Followed by:

> ## Privacy & attribution

We add the cross-reference as a new paragraph between this closing sentence and the next H2.

`old_string` (verbatim — the closing sentence + the blank line + the next H2 heading; this anchor is unique in the file):

```
Different cadence. `/self-assessment` runs daily (cheap), `/insights` runs weekly-ish (token-heavy). Bundling them would either over-spend tokens or hide the `/insights` invocation from the user. Keeping `/refresh-insights` separate makes the data flow explicit: *you* decide when to refresh the narrative.

## Privacy & attribution
```

`new_string` (verbatim — same closing sentence, blank line, new cross-reference paragraph, blank line, next H2):

```
Different cadence. `/self-assessment` runs daily (cheap), `/insights` runs weekly-ish (token-heavy). Bundling them would either over-spend tokens or hide the `/insights` invocation from the user. Keeping `/refresh-insights` separate makes the data flow explicit: *you* decide when to refresh the narrative.

Pair with [`/self-assessment`](./self-assessment.md) for the full weekly chain — see [README.md "Running the full workflow"](../../README.md#running-the-full-workflow). The chain is `/insights` → `/refresh-insights` → `/self-assessment`; the first is token-heavy and user-initiated, the second is the verbatim filer, the third is the daily scorer.

## Privacy & attribution
```

Notes:

- **Why the link target form `../../README.md#running-the-full-workflow`.** From `.claude/commands/refresh-insights.md`, the README is two directory levels up (`../../README.md`). The anchor `#running-the-full-workflow` is GitHub's auto-generated slug for `## Running the full workflow` (which we shipped in PR #22). GitHub renders both relative file links and anchor fragments correctly when viewed in the repo browser.
- **Why the chain is restated inline.** Even though the README section is the source of truth, restating the chain (`/insights → /refresh-insights → /self-assessment`) in this file gives a reader who never clicks through enough context to act. Three commands, three roles, one sentence. Not duplication — minimal recall.
- **Don't restructure other sections.** This is purely additive. Don't reformat the surrounding paragraphs.

- [ ] **Step 3: Verify the cross-reference renders correctly**

Run: `grep -n "Pair with" /Users/theo/Projects/claude-extensions/.claude/commands/refresh-insights.md`

Expected: a single line like `48:Pair with [\`/self-assessment\`](./self-assessment.md) for the full weekly chain — see [README.md "Running the full workflow"](../../README.md#running-the-full-workflow). The chain is \`/insights\` → \`/refresh-insights\` → \`/self-assessment\`; the first is token-heavy and user-initiated, the second is the verbatim filer, the third is the daily scorer.`

The line number depends on where Task 1's prepend landed; what matters is that the line exists exactly once and has the correct text.

- [ ] **Step 4: Verify section structure is intact**

Run: `grep -n '^##' /Users/theo/Projects/claude-extensions/.claude/commands/refresh-insights.md`

Expected (line numbers will have shifted from Task 1's prepend, but the relative order and content of headings must be unchanged):

```
?:## Steps
?:## What NOT to do
?:## Configuration
?:## Why a separate command rather than a flag on `/self-assessment`
?:## Privacy & attribution
```

All five H2 headings must still be present in this exact order. The `?` placeholders represent line numbers that shift after Task 1's prepend — substitute the actual numbers when running.

- [ ] **Step 5: Run the test suite (defense-in-depth)**

Run: `cd /Users/theo/Projects/claude-extensions && npx vitest run`

Expected: `Test Files  16 passed (16)`, `Tests  223 passed (223)`. No test reads slash-command content, so this should be a no-op — but a regression here means something else broke unrelated to this edit.

- [ ] **Step 6: Confirm only this one file changed**

Run: `git status --porcelain` from `/Users/theo/Projects/claude-extensions`.

Expected:

```
 M .claude/commands/refresh-insights.md
?? docs/superpowers/
```

If anything else appears, STOP and report.

## Task 3: Branch, commit, PR, squash-merge

**Files:**

- No file edits in this task — git operations only.

**Why:** Both edits are tightly coupled (same audit pass, same slash-command file, same discoverability theme). Single commit, single PR, squash-merge — mirroring the workflow used in PRs #21 / #22 / #23 / #24 / #25 today.

- [ ] **Step 1: Verify clean baseline**

Run: `git status --porcelain` from `/Users/theo/Projects/claude-extensions`.

Expected:

```
 M .claude/commands/refresh-insights.md
?? docs/superpowers/
```

If anything else is modified or staged, STOP and reconcile.

- [ ] **Step 2: Create the feature branch**

Run: `git checkout -b chore/refresh-insights-slash-command-audit-g1-g2`

Expected: `Switched to a new branch 'chore/refresh-insights-slash-command-audit-g1-g2'`.

Branch naming follows today's repo convention (PR #25 used `chore/self-assessment-slash-command-audit-f1-f2`; this is the `/refresh-insights` counterpart).

- [ ] **Step 3: Stage and commit**

Stage **only** the slash command file. Do NOT use `git add -A` or `git add .` — those would stage the untracked `docs/superpowers/` plan dir.

Run:

```bash
git add .claude/commands/refresh-insights.md
git commit -m "$(cat <<'EOF'
Add YAML frontmatter and daily-chain cross-reference to /refresh-insights

Two findings from this morning's Thariq-playbook audit (audit graded
the file B+, with these as the worth-shipping items):

G1 (description = trigger): The slash command file had no YAML
frontmatter at all — no description, no argument-hint, no
allowed-tools. The slash-command picker showed just /refresh-insights
with the literal slug as the description (auto-generated fallback).
Sibling /self-assessment.md has full frontmatter; this brings them
into alignment.

The new description leads with the action and ends with a usage gate
("Run /insights first; this command never auto-fires it") — encoding
the file's most important hard rule directly in the trigger text.
allowed-tools is minimal: Read + Write only. No Bash needed (the
command doesn't shell out), no Edit needed (full overwrite, not a
patch), no over-grant.

G2 (cross-reference): The "Why a separate command" section explained
the separation from /self-assessment but not the canonical chain.
PR #22 documented /insights → /refresh-insights → /self-assessment
in README.md. This adds a one-paragraph cross-reference so a reader
of just this file finds the chain without round-tripping to README.

No code, no tests, no behavioral change at runtime.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: a single commit hash, "1 file changed".

- [ ] **Step 4: Push and open PR**

Run:

```bash
git push -u origin chore/refresh-insights-slash-command-audit-g1-g2
gh pr create --base main --title "Add YAML frontmatter and daily-chain cross-reference to /refresh-insights" --body "$(cat <<'EOF'
## Summary

Two findings from this morning's Thariq-playbook audit of \`.claude/commands/refresh-insights.md\` (audit composite grade: B+).

### G1 — missing YAML frontmatter (description = trigger, principle 5)
- The file had no YAML frontmatter at all — no \`description\`, no \`argument-hint\`, no \`allowed-tools\`. The slash-command picker showed just \`/refresh-insights\` with the literal slug as the description (auto-generated fallback).
- Sibling \`.claude/commands/self-assessment.md\` carries full frontmatter; this brings the two into alignment.
- New description leads with the action ("File the markdown summary…") and ends with a usage gate ("Run /insights first; this command never auto-fires it") — encoding the file's most important hard rule directly in the trigger text.
- \`allowed-tools: Read, Write\` is minimal — no \`Bash\` (no shell-out), no \`Edit\` (full overwrite, not a patch). Least-privilege.
- \`argument-hint\` is empty (the command takes no flags) but the field is kept for symmetry with the sibling.

### G2 — cross-reference to the daily workflow (discoverability)
- The "Why a separate command" section explained the *separation* from \`/self-assessment\` but not the canonical *chain*.
- PR #22 documented \`/insights → /refresh-insights → /self-assessment\` in README.md.
- This adds a one-paragraph cross-reference so a reader of just this file finds the chain without round-tripping to README.

### Out of scope
- G3 (note the \`app/data/\` deviation in this file too — already documented in \`signals.md\` per PR #24, low value to repeat here)
- G4 (style asymmetry: \`/self-assessment.md\` is a 14-line shim, this file is 49 lines self-contained — both patterns valid; the asymmetry reflects real differences in workload)
- G5 ("What NOT to do" vs. "Gotchas" naming — current name is clearer for end users)

## Test plan
- [x] \`npx vitest run\` — 223 passed, no behavior changed
- [x] YAML frontmatter parses (\`head -8\` shows valid \`---/description/argument-hint/allowed-tools/---/blank/H1\`)
- [x] Section structure intact (5 H2 headings still in original order, with the new cross-reference paragraph correctly placed)
- [x] Cross-reference link uses \`../../README.md#running-the-full-workflow\` (correct relative path from \`.claude/commands/\`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed (e.g. `https://github.com/theoju/claude-code-mastery/pull/26`). Capture the PR number from the trailing path segment.

- [ ] **Step 5: Squash-merge and clean up**

Replace `<PR-NUMBER>` with the actual number from Step 4:

```bash
gh pr merge <PR-NUMBER> --squash --delete-branch
git checkout main
git pull --ff-only
git fetch --prune origin
```

Expected:

- `Squashed and merged.` confirmation from `gh pr merge`.
- `Already on 'main'` followed by `Fast-forward` from `git pull`.
- A `[deleted]` line from `git fetch --prune origin` clearing the stale remote-tracking ref. Per CLAUDE.md `## Conventions`, this is the universal fix for stale refs after `--delete-branch`.

- [ ] **Step 6: Verify final state**

Run:

```bash
git log --oneline -3
git status --porcelain
git branch -a
```

Expected:

- Top commit on `main` is the squash-merged title.
- `git status --porcelain` shows only the still-untracked `docs/superpowers/`.
- `git branch -a` shows only `* main` and `remotes/origin/main`.

If any leftover branches or remote-tracking refs appear, run `git fetch --prune origin` again.

---

## Notes for the executor

- **Edit tool, not `sed`.** Both file edits use the Edit tool. The frontmatter and cross-reference content contain shell-significant characters (backticks, brackets, parentheses, em-dashes, arrow glyphs) that are easy to mangle with `sed`. Edit's `old_string`/`new_string` form is unambiguous and reviewable in transcript.
- **Don't add frontmatter to other slash commands.** Only `.claude/commands/refresh-insights.md` should change. `/self-assessment.md` already has correct frontmatter (we shipped #25 today).
- **Don't post to Slack while testing.** If you happen to invoke `/refresh-insights` to verify the new picker description, do not pair it with a `/self-assessment` run unless you pass `--no-slack`. The user has a daily 7:15 AM cloud routine and this morning's manual post; an extra mid-day post is noise.
- **Don't commit `docs/superpowers/`.** The plan dir is a session artifact, intentionally not tracked. Per the established pattern in PRs #24 and #25, plans stay local.
- **PR cadence is mandatory.** Don't skip the PR step and merge to main directly. Today's commit log #20–#25 shows every change goes through a squash-merged PR.
