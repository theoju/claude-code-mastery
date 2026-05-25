# /self-assessment Slash Command F1+F2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two YAML-frontmatter bugs in `.claude/commands/self-assessment.md` — the `argument-hint` documents only `name=path` form for `--claude-md-target` (third surface still wrong after PR #23 corrected README and CLAUDE.md), and the `allowed-tools` list omits `Edit`, which the SKILL.md first-run setup flow needs to patch `assessment.config.json`.

**Architecture:** Two surgical edits to YAML frontmatter in a single 14-line slash-command file. No new files. No code paths change. Both fixes are documentation+permission-allowlist changes that take effect at next invocation. Single PR, single commit.

**Tech Stack:** Markdown with YAML frontmatter only. No code, no tests. Verification is content review (does the argument hint match the actual parser? does the allow-list include the tool the setup flow actually uses?) plus the existing 223-test vitest suite must remain green (no test reads slash-command frontmatter, but defense-in-depth).

---

## Background

This morning's audit of `.claude/commands/self-assessment.md` against Thariq's 9 principles graded it **A−**. Five findings emerged; F1 and F2 are the two worth shipping now.

### F1 — argument-hint perpetuates the bare-path omission

PR #23 already fixed this same incorrect doc claim in `README.md`. `docs/self-assessment.md` had it right from the start. The slash command's `argument-hint` field is the **third surface** still showing only `name=path`, omitting the bare-path form. `parseTargetSpec` (`scripts/run-assessment.mjs:61-70`) explicitly accepts both. Anyone reading the slash-command picker hint will see incomplete syntax.

### F2 — allowed-tools missing Edit

The SKILL.md first-run flow defers to `setup.md`, which instructs Claude to copy `assessment.config.example.json → assessment.config.json` and then "patch the values per the user's answers." Patching = surgical key/value updates, which is the Edit tool's job. The slash command's `allowed-tools` lists `Bash(node:*), Bash(npm:*), Read, Write` — Edit is missing. With only Write, Claude has to either rewrite the entire JSON file (heavy, error-prone for nested structures) or shell out to `sed`/`jq` (not in the allowlist). Adding Edit aligns the slash command's permissions with what the setup flow actually does.

F3 (description rephrase), F4 (cross-reference to /refresh-insights), and F5 (explicit setup gate language) are all minor and deferred.

## File Structure

A single file is modified. No new files, no deletions, no spokes.

```
.claude/commands/
  self-assessment.md   ← F1: argument-hint expanded; F2: allowed-tools gains Edit
```

Verification surfaces (no edits):

```
scripts/__tests__/             ← full vitest suite must stay green (223 tests, 0 changes expected)
scripts/run-assessment.mjs     ← parseTargetSpec at lines 61-70 is the source-of-truth for F1
.claude/skills/self-assessment/setup.md   ← prescribes "patch values" — confirms F2's need for Edit
```

## Self-Review Anchors

- **Type consistency:** N/A — no code, no types.
- **Spec coverage:** F1 covers the argument-hint mismatch; F2 covers the allowed-tools gap. F3/F4/F5 are explicitly out of scope.
- **Placeholder scan:** None. Both edits use exact text below.

---

## Task 1: Fix `argument-hint` for `--claude-md-target` (F1)

**Files:**

- Modify: `.claude/commands/self-assessment.md:3` (the YAML frontmatter `argument-hint:` line — single line replaced)

**Why:** PR #23 corrected this in README.md and CLAUDE.md memory. The slash command file is the third surface and is still wrong. `parseTargetSpec` at `scripts/run-assessment.mjs:61-70` accepts both `name=path` and bare `<path>` forms (with name defaulting to the last directory segment). The argument hint must reflect both.

- [ ] **Step 1: Confirm the current line before editing**

Run: `sed -n '3p' .claude/commands/self-assessment.md`

Expected output (one line):

```
argument-hint: [--no-slack] [--print] [--include-transcripts] [--no-transcripts] [--insights-lookback N] [--progression-lookback N|none] [--claude-md-target name=path]
```

If this differs (someone has edited the slash command between this plan and execution), STOP and report BLOCKED with the actual line content.

- [ ] **Step 2: Replace the line via the Edit tool**

Use the Edit tool, not `sed`, so the change is reviewable in transcript.

`old_string` (verbatim, one line):

```
argument-hint: [--no-slack] [--print] [--include-transcripts] [--no-transcripts] [--insights-lookback N] [--progression-lookback N|none] [--claude-md-target name=path]
```

`new_string` (verbatim, one line — the only delta is `[--claude-md-target name=path]` → `[--claude-md-target name=path|path]`):

```
argument-hint: [--no-slack] [--print] [--include-transcripts] [--no-transcripts] [--insights-lookback N] [--progression-lookback N|none] [--claude-md-target name=path|path]
```

Notes:

- The `name=path|path` form mirrors how `docs/self-assessment.md:56` documents it: `--claude-md-target <name=path> or <path>`. We use `|` here instead of "or" because the argument-hint is a compact terminal hint, not prose, and `|` is the standard shell convention for alternation in usage strings.
- All other flags are preserved unchanged.

- [ ] **Step 3: Confirm the YAML frontmatter still parses**

Run: `head -6 .claude/commands/self-assessment.md`

Expected:

```
---
description: Run the Claude Code mastery assessment. Scores ~/.claude/* state against Boris Cherny's 87 tips and the two-axis Platform Setup vs Execution rubric, then (if configured) posts the summary to Slack.
argument-hint: [--no-slack] [--print] [--include-transcripts] [--no-transcripts] [--insights-lookback N] [--progression-lookback N|none] [--claude-md-target name=path|path]
allowed-tools: Bash(node:*), Bash(npm:*), Read, Write
---

```

The leading `---`, three field lines (`description`, `argument-hint`, `allowed-tools`), and trailing `---` must all be present in this order. The `description` and `allowed-tools` lines are unchanged in this task.

## Task 2: Add `Edit` to `allowed-tools` (F2)

**Files:**

- Modify: `.claude/commands/self-assessment.md:4` (the YAML frontmatter `allowed-tools:` line — single line replaced)

**Why:** The first-run setup flow (`.claude/skills/self-assessment/setup.md`) instructs Claude to _patch_ `assessment.config.json` after copying from the example template. Patching nested JSON keys (e.g. `user.displayName`, `slack.channel`, `claudeMd.targets[0]`) is the Edit tool's natural job. With only `Write` allowed, Claude has to rewrite the entire file each time — heavier, more error-prone for multi-key updates, and not how Claude naturally reaches for surgical edits.

- [ ] **Step 1: Confirm the current line before editing**

Run: `sed -n '4p' .claude/commands/self-assessment.md`

Expected output (one line, post-Task-1):

```
allowed-tools: Bash(node:*), Bash(npm:*), Read, Write
```

If this differs, STOP and report BLOCKED with the actual content.

- [ ] **Step 2: Replace the line via the Edit tool**

`old_string` (verbatim, one line):

```
allowed-tools: Bash(node:*), Bash(npm:*), Read, Write
```

`new_string` (verbatim, one line — adds `Edit` to the comma-separated list, alphabetized within the non-Bash tools):

```
allowed-tools: Bash(node:*), Bash(npm:*), Edit, Read, Write
```

Notes:

- `Edit` is inserted alphabetically among the non-Bash tools (`Edit, Read, Write`). The two `Bash(...)` entries stay first because they're qualified with permission scopes; mixing them with bare tool names breaks readability.
- This is a permission _grant_ — adding `Edit` doesn't force Claude to use it. The setup flow uses Write today; with Edit available, Claude can pick the right tool for the job.
- The grant is bounded: `Edit` only edits files Claude reads first. The slash command does not gain shell-level write access beyond what `Write` already provides.

- [ ] **Step 3: Confirm the YAML frontmatter is well-formed**

Run: `head -6 .claude/commands/self-assessment.md`

Expected (post-Tasks-1-and-2):

```
---
description: Run the Claude Code mastery assessment. Scores ~/.claude/* state against Boris Cherny's 87 tips and the two-axis Platform Setup vs Execution rubric, then (if configured) posts the summary to Slack.
argument-hint: [--no-slack] [--print] [--include-transcripts] [--no-transcripts] [--insights-lookback N] [--progression-lookback N|none] [--claude-md-target name=path|path]
allowed-tools: Bash(node:*), Bash(npm:*), Edit, Read, Write
---

```

If any of the three field lines is missing, malformed, or out of order, the slash command will fail to load.

- [ ] **Step 4: Run the test suite (defense-in-depth)**

Run: `cd /Users/theo/Projects/claude-extensions && npx vitest run`

Expected: `Test Files  16 passed (16)`, `Tests  223 passed (223)`. No test reads slash-command frontmatter, so this should be a no-op — but a regression here would mean something else broke unrelated to this edit.

- [ ] **Step 5: Confirm `git status` shows exactly one modified file**

Run: `git status --porcelain` from `/Users/theo/Projects/claude-extensions`.

Expected: only `.claude/commands/self-assessment.md` modified, plus the still-untracked `docs/superpowers/` directory:

```
 M .claude/commands/self-assessment.md
?? docs/superpowers/
```

If anything else appears, STOP and report — the planning artifact (`docs/superpowers/`) is intentional, but any other modified file is not.

## Task 3: Branch, commit, PR, squash-merge

**Files:**

- No file edits in this task — git operations only.

**Why:** Both edits are tightly coupled (same audit pass, same slash-command file, same YAML frontmatter). Single commit, single PR, squash-merge to keep `main`'s history readable. Mirrors the workflow used in PRs #21 / #22 / #23 / #24.

- [ ] **Step 1: Verify clean baseline**

Run: `git status --porcelain` from `/Users/theo/Projects/claude-extensions`.

Expected: only the modified slash command + the untracked plan dir:

```
 M .claude/commands/self-assessment.md
?? docs/superpowers/
```

If anything else is modified or staged, STOP and reconcile.

- [ ] **Step 2: Create the feature branch**

Run: `git checkout -b chore/self-assessment-slash-command-audit-f1-f2`

Expected: `Switched to a new branch 'chore/self-assessment-slash-command-audit-f1-f2'`.

Branch naming follows recent repo convention (PR #24 used `chore/self-assessment-skill-audit-p1-p2`; this is the slash-command counterpart).

- [ ] **Step 3: Stage and commit**

Stage the slash command file explicitly. Do NOT use `git add -A` or `git add .` — those would stage the untracked `docs/superpowers/` plan dir.

Run:

```bash
git add .claude/commands/self-assessment.md
git commit -m "$(cat <<'EOF'
Fix /self-assessment slash command argument-hint and allowed-tools

Two findings from this morning's Thariq-playbook audit of the slash
command shim (audit graded the file A-, with these as the
worth-shipping-now items):

F1 (argument-hint): The --claude-md-target hint listed only the
name=path form. parseTargetSpec at scripts/run-assessment.mjs:61-70
accepts both name=path and bare <path>. PR #23 already fixed this
same omission in README.md and CLAUDE.md; the slash command's
argument-hint was the third surface still wrong. Now reads
[--claude-md-target name=path|path].

F2 (allowed-tools): The SKILL.md first-run flow (setup.md) tells
Claude to patch assessment.config.json after copying from the
example template. "Patch" is the Edit tool's job — surgical key/value
updates on nested JSON. The allow-list previously had only Write,
forcing whole-file rewrites for any config change. Adding Edit
aligns permissions with what the setup flow actually does.

No code, no tests, no behavioral change at runtime.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: a single commit hash, "1 file changed".

- [ ] **Step 4: Push and open the PR**

Run:

```bash
git push -u origin chore/self-assessment-slash-command-audit-f1-f2
gh pr create --base main --title "Fix /self-assessment slash command argument-hint and allowed-tools" --body "$(cat <<'EOF'
## Summary

Two findings from this morning's Thariq-playbook audit of the \`.claude/commands/self-assessment.md\` slash-command shim (audit composite grade: A-).

### F1 — argument-hint missing the bare-path form
- The \`argument-hint\` for \`--claude-md-target\` listed only the \`name=path\` form, but \`parseTargetSpec\` (\`scripts/run-assessment.mjs:61-70\`) accepts both \`name=path\` and a bare \`<path>\` (with name defaulting to the last directory segment).
- PR #23 fixed this same omission in README.md and CLAUDE.md memory. \`docs/self-assessment.md\` had it right from the start. The slash command argument-hint was the third surface still wrong.
- Now reads \`[--claude-md-target name=path|path]\`, matching how \`docs/self-assessment.md:56\` documents it.

### F2 — allowed-tools missing Edit
- The first-run flow in \`.claude/skills/self-assessment/setup.md\` instructs Claude to *patch* \`assessment.config.json\` after copying from the example template. Patching nested JSON keys (e.g. \`user.displayName\`, \`slack.channel\`, \`claudeMd.targets[0]\`) is the Edit tool's job.
- The allow-list previously had only \`Read, Write\` (plus \`Bash(node:*), Bash(npm:*)\`), forcing whole-file rewrites for any config change.
- Adding \`Edit\` aligns permissions with what the setup flow actually needs. Permission *grant*, not a behavioral change.

### Out of scope
- F3 (description rephrase — minor): the description is descriptive rather than action-oriented, but it works.
- F4 (cross-reference to \`/refresh-insights\` — minor): nice for discoverability, not blocking.
- F5 (explicit setup gate — marginal): SKILL.md already gates correctly; the shim's delegation phrasing is clear enough in context.

## Test plan
- [x] \`npx vitest run\` — 223 passed, no behavior changed
- [x] YAML frontmatter parses (\`head -6\` shows valid \`---/description/argument-hint/allowed-tools/---\`)
- [x] Slash command still loads in \`/<TAB>\` picker after the change (verified manually post-merge if desired)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed (e.g. `https://github.com/theoju/claude-code-mastery/pull/25`). Capture the PR number from the trailing path segment.

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

- [ ] **Step 6: Verify clean final state**

Run:

```bash
git log --oneline -3
git status --porcelain
git branch -a
```

Expected:

- Top commit on `main` is the squash-merged title.
- `git status --porcelain` shows only the still-untracked `docs/superpowers/` (or empty if you've removed the planning artifact).
- `git branch -a` shows only `* main` and `remotes/origin/main`.

If any leftover branches or remote-tracking refs appear, run `git fetch --prune origin` again.

---

## Notes for the executor

- **Edit tool, not `sed`.** Both file edits use the Edit tool. The two `argument-hint` and `allowed-tools` lines are long and contain shell-significant characters (brackets, pipes) that are easy to mangle with `sed`. Edit's `old_string`/`new_string` form is unambiguous and reviewable in transcript.
- **Don't add Edit to allowed-tools elsewhere.** Only the slash command file at `.claude/commands/self-assessment.md` should change. Other slash commands have their own correct allow-lists.
- **Don't post to Slack while testing.** If you happen to invoke `/self-assessment` to verify the new argument-hint shows in the picker, pass `--no-slack` to avoid a duplicate post (the user has a daily 7:15 AM cloud routine and this morning's manual post; an extra mid-day post is noise).
- **Don't commit `docs/superpowers/`.** The plan dir is a session artifact, intentionally not tracked. Per the established pattern in PR #24, plans stay local.
- **PR cadence is mandatory.** Don't skip the PR step and merge to main directly. Recent commits #20-#24 all use squash-merged PRs.
