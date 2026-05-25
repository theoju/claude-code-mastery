# Symmetric Cross-References (/ship Spec + Jira Convention) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land two cross-reference edits (one back-pointer in `/ship` spec, one forward-pointer in `CLAUDE.md` `## Issue tracking`) as two separate commits on `docs/symmetric-pointers-jira-ship`, then push and open a PR squash-merged to `main`.

**Architecture:** Pure docs change. Two minimal `Edit` calls (one per file) on a branch that already exists with the spec doc committed. Each edit gets its own conventional commit (`docs(spec)`: …, `docs(claude.md)`: …) so per-file blame stays clean. A final task pushes and opens the PR; merge is left to the user because the local auto-mode classifier blocks PR-merge against `main`.

**Tech Stack:** `git`, `gh` CLI, `Edit` tool. No application code, no tests, no scorer paths touched.

**Pre-flight checks (must hold before Task 1 starts):**

- Working tree is clean (`git status --short` empty).
- Current branch is `docs/symmetric-pointers-jira-ship`.
- Last commit is `235d26c docs(spec): design for bidirectional /ship + Jira cross-references` (the spec).
- `docs/superpowers/specs/2026-05-09-ship-slash-command-design.md` line 3 is the existing "For agentic workers" blockquote callout.
- `CLAUDE.md` contains a `## Issue tracking` section ending with the "Atlassian MCP server" bullet, followed by a blank line and `## Privacy`.

---

### Task 1: Edit 1 — Add "For readers" back-pointer to /ship spec

**Files:**

- Modify: `docs/superpowers/specs/2026-05-09-ship-slash-command-design.md` (insert one blockquote callout after line 3, before the `**Goal:**` line)

- [ ] **Step 1: Read the spec to confirm the insertion anchor**

Run: `sed -n '1,8p' docs/superpowers/specs/2026-05-09-ship-slash-command-design.md`

Expected output (exactly):

```
# /ship Slash Command — Design Spec

> **For agentic workers:** REQUIRED NEXT STEP: invoke `superpowers:writing-plans` to turn this spec into an implementation plan. **Do not implement in this repo (`claude-extensions`).** The /ship command is a personal tool that lives in `~/.claude/`; the plan should be created and executed in the user's personal-tools workspace, not here.

**Goal:** Codify Theo's recurring shipping pattern as a personal `/ship` slash command at `~/.claude/commands/ship.md`. The command chains test → verify-agent → simplify → code-review → commit → push+PR → Jira-update, with sensible halt rules and silent skips when optional tooling is absent.
```

If the line containing "For agentic workers" is not at line 3 or the blank line after it is not at line 4, STOP and re-investigate before editing — the file structure has drifted from what the spec assumed.

- [ ] **Step 2: Apply Edit 1 via the Edit tool**

Use the `Edit` tool with these exact arguments (verbatim text, no paraphrasing):

`file_path`: `/Users/theo/Projects/claude-extensions/docs/superpowers/specs/2026-05-09-ship-slash-command-design.md`

`old_string`:

```
> **For agentic workers:** REQUIRED NEXT STEP: invoke `superpowers:writing-plans` to turn this spec into an implementation plan. **Do not implement in this repo (`claude-extensions`).** The /ship command is a personal tool that lives in `~/.claude/`; the plan should be created and executed in the user's personal-tools workspace, not here.

**Goal:**
```

`new_string`:

```
> **For agentic workers:** REQUIRED NEXT STEP: invoke `superpowers:writing-plans` to turn this spec into an implementation plan. **Do not implement in this repo (`claude-extensions`).** The /ship command is a personal tool that lives in `~/.claude/`; the plan should be created and executed in the user's personal-tools workspace, not here.

> **For readers:** A reader-facing one-page summary is rendered at the dashboard's `/docs/ship-pattern` route and lives at `docs/ship-pattern.md`. Read that first if you want the 8-stage chain and where-to-start without the full design.

**Goal:**
```

- [ ] **Step 3: Verify the edit landed correctly**

Run: `grep -n "For readers" docs/superpowers/specs/2026-05-09-ship-slash-command-design.md`

Expected output (exactly one line):

```
5:> **For readers:** A reader-facing one-page summary is rendered at the dashboard's `/docs/ship-pattern` route and lives at `docs/ship-pattern.md`. Read that first if you want the 8-stage chain and where-to-start without the full design.
```

If grep returns 0 matches OR more than 1 line OR the line number is not 5, STOP and inspect the file before continuing — the edit landed wrong.

- [ ] **Step 4: Confirm only the intended file changed**

Run: `git diff --stat`

Expected output:

```
 docs/superpowers/specs/2026-05-09-ship-slash-command-design.md | 2 ++
 1 file changed, 2 insertions(+), 0 deletions(-)
```

If any other file appears in the diff, STOP and inspect.

- [ ] **Step 5: Commit Edit 1**

Run:

```bash
git add docs/superpowers/specs/2026-05-09-ship-slash-command-design.md && git commit -m "$(cat <<'EOF'
docs(spec): add reader-facing summary back-pointer to ship-pattern.md

Closes the spec ↔ ship-pattern asymmetry surfaced by the post-merge
audit: ship-pattern.md forward-pointed to the spec since PR #58, but
the spec lacked a back-pointer to the public summary doc.

Inserted as a "For readers" blockquote callout sitting parallel to the
existing "For agentic workers" callout at the top of the spec — both
serve a navigation purpose, so they belong together.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected output (last line):

```
[docs/symmetric-pointers-jira-ship <SHA>] docs(spec): add reader-facing summary back-pointer to ship-pattern.md
 1 file changed, 2 insertions(+)
```

If the file-change count is not `1 file changed, 2 insertions(+)`, STOP and inspect.

---

### Task 2: Edit 2 — Add forward-pointer bullet to CLAUDE.md ## Issue tracking

**Files:**

- Modify: `CLAUDE.md` (append one bullet at the end of the `## Issue tracking` section, before the `## Privacy` heading)

- [ ] **Step 1: Read CLAUDE.md to confirm the insertion anchor**

Run: `grep -n "^## " CLAUDE.md`

Expected output (the headings; line numbers will vary slightly with formatter passes, but the order must be):

```
... (earlier sections) ...
<N>:## Issue tracking
<M>:## Privacy
... (later sections) ...
```

`<M>` must be greater than `<N>` and the section between them must contain the existing "Atlassian MCP server" bullet ending with "integration surface." If `## Issue tracking` is missing entirely, STOP — the assumed state from PR #59 has drifted.

- [ ] **Step 2: Apply Edit 2 via the Edit tool**

Use the `Edit` tool with these exact arguments (verbatim text):

`file_path`: `/Users/theo/Projects/claude-extensions/CLAUDE.md`

`old_string`:

```
- When future automation in this repo needs Jira integration (status
  reports, ticket creation, transitions), target this instance and
  project — don't spin up a second project for sub-areas. The
  Atlassian MCP server (`atlassian:*` tools) is the canonical
  integration surface.

## Privacy
```

`new_string`:

```
- When future automation in this repo needs Jira integration (status
  reports, ticket creation, transitions), target this instance and
  project — don't spin up a second project for sub-areas. The
  Atlassian MCP server (`atlassian:*` tools) is the canonical
  integration surface.
- For the reference example of Jira-touching automation, see
  `docs/ship-pattern.md` Stage 7 — the `/ship` command transitions
  the linked ticket and posts the PR link as the close-of-loop step.

## Privacy
```

- [ ] **Step 3: Verify the edit landed correctly**

Run: `grep -n "reference example of Jira-touching automation" CLAUDE.md`

Expected output (exactly one line, with some line number):

```
<line>:- For the reference example of Jira-touching automation, see
```

If grep returns 0 matches OR more than 1 line, STOP and inspect.

- [ ] **Step 4: Confirm only CLAUDE.md changed and the diff is +3 lines**

Run: `git diff --stat`

Expected output:

```
 CLAUDE.md | 3 +++
 1 file changed, 3 insertions(+), 0 deletions(-)
```

If any other file appears OR the line count differs, STOP and inspect.

- [ ] **Step 5: Commit Edit 2**

Run:

```bash
git add CLAUDE.md && git commit -m "$(cat <<'EOF'
docs(claude.md): forward-ref ship-pattern Stage 7 from ## Issue tracking

The ## Issue tracking section (added in PR #59) talked generically
about "future automation in this repo needs Jira integration" but
didn't surface the canonical example. ship-pattern.md Stage 7 is
exactly that example: the /ship command's Jira-update step.

Inline code path (no markdown link) to match the section's existing
bullets.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected output (last line):

```
[docs/symmetric-pointers-jira-ship <SHA>] docs(claude.md): forward-ref ship-pattern Stage 7 from ## Issue tracking
 1 file changed, 3 insertions(+)
```

If the file-change count is not `1 file changed, 3 insertions(+)`, STOP and inspect.

---

### Task 3: Push branch and open PR

**Files:**

- No file changes (purely remote/PR ops via `gh` and `git`)

- [ ] **Step 1: Confirm both edits are committed and branch state is correct**

Run: `git log --oneline main..HEAD`

Expected output (3 commits, oldest first when reading bottom-up):

```
<SHA2> docs(claude.md): forward-ref ship-pattern Stage 7 from ## Issue tracking
<SHA1> docs(spec): add reader-facing summary back-pointer to ship-pattern.md
235d26c docs(spec): design for bidirectional /ship + Jira cross-references
```

If you see fewer than 3 commits, OR the order/subjects are wrong, STOP and inspect.

- [ ] **Step 2: Confirm working tree is clean**

Run: `git status --short`

Expected output: empty (no lines).

If anything appears, STOP — there are uncommitted changes that need to be reconciled before pushing.

- [ ] **Step 3: Push the branch with upstream tracking**

Run: `git push -u origin docs/symmetric-pointers-jira-ship`

Expected output (last line):

```
branch 'docs/symmetric-pointers-jira-ship' set up to track 'origin/docs/symmetric-pointers-jira-ship'.
```

- [ ] **Step 4: Open the PR via gh**

Run:

```bash
gh pr create --base main --title "docs: bidirectional cross-references between /ship spec, ship-pattern, and Jira convention" --body "$(cat <<'EOF'
## Summary

Closes two cross-reference asymmetries surfaced by a post-merge audit of PR #58 and PR #59:

1. **`docs(spec)`** — `/ship` design spec now back-references `docs/ship-pattern.md` (the reader-facing one-page summary rendered at the dashboard's `/docs/ship-pattern` route). Sits as a "For readers" blockquote parallel to the existing "For agentic workers" callout.

2. **`docs(claude.md)`** — `CLAUDE.md` `## Issue tracking` section gains a forward pointer to `docs/ship-pattern.md` Stage 7 as the canonical example of Jira-touching automation in this repo.

## Why this PR

The `CLAUDE.md` `## Conventions` doctrine: _"default to symmetric; one-way pointers age into stale asymmetric trees."_ Both edits close real one-way pointers; neither couples a project-neutral pattern doc to a specific project.

## Out of scope (documented in the spec)

- Pinning `docs/ship-pattern.md` to project CCE — would conflict with the doc's intentional project-neutrality (line 75: _"embedding it in a product repo would couple it to that product's CI and review conventions"_).
- Filing this PR as the first `CCE-N` Jira ticket — the `## Issue tracking` rule says "when work maps to a ticket"; cross-reference housekeeping doesn't.

Full design: [`docs/superpowers/specs/2026-05-20-symmetric-pointers-jira-ship-design.md`](docs/superpowers/specs/2026-05-20-symmetric-pointers-jira-ship-design.md)

## Test plan

- [x] `git diff --stat` shows only the two intended files modified (one `+2 lines`, one `+3 lines`)
- [x] No automated tests touched (docs-only); 508/508 vitest baseline on `main @ 9cc07c5` carries forward unchanged
- [x] No dashboard route impacted: `/docs/ship-pattern` reads `docs/ship-pattern.md` which is not edited here
- [x] Manual re-read of each addition in context confirms wording flows with surroundings
- [ ] After merge: `git fetch --prune` to drop the stale `origin/docs/symmetric-pointers-jira-ship` remote-tracking ref

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected output (last line is the PR URL):

```
https://github.com/theoju/claude-code-self-assessment/pull/<N>
```

Capture the `<N>` (PR number) for Task 4.

- [ ] **Step 5: Verify the PR is open, mergeable, and points at main**

Run: `gh pr view <N> --json number,state,mergeable,mergeStateStatus,baseRefName,headRefName`

Expected output (single JSON object, fields in any order):

```json
{
  "baseRefName": "main",
  "headRefName": "docs/symmetric-pointers-jira-ship",
  "mergeStateStatus": "CLEAN",
  "mergeable": "MERGEABLE",
  "number": <N>,
  "state": "OPEN"
}
```

If `state` is not `OPEN`, OR `mergeable` is not `MERGEABLE`, OR `mergeStateStatus` is not `CLEAN`, STOP and inspect.

---

### Task 4: User-executed merge + local cleanup

**Files:** none (remote merge + local refs only)

**Note:** This task cannot be executed by an agent. The Claude Code auto-mode classifier blocks `gh pr merge` against `main` from agent-side. The user must paste the command into their prompt with the `!` prefix.

- [ ] **Step 1: User executes the squash-merge**

User runs (with `!` prefix in their Claude Code prompt to execute in-session):

```bash
gh pr merge <N> --squash --delete-branch
```

Expected output (last line):

```
✓ Squashed and merged pull request #<N> ...
✓ Deleted branch docs/symmetric-pointers-jira-ship
```

- [ ] **Step 2: Switch to main and pull**

Run: `git checkout main && git pull --ff-only`

Expected output (last two lines):

```
Updating <prev>..<new>
Fast-forward
```

Or, if `gh` already updated the local main as a side-effect (it sometimes does), the first command will say "Already on 'main'" and the pull will be a no-op fast-forward.

- [ ] **Step 3: Prune stale remote-tracking ref**

Run: `git fetch --prune`

Expected output (the line that matters):

```
 - [deleted]         (none)     -> origin/docs/symmetric-pointers-jira-ship
```

- [ ] **Step 4: Verify final clean state on main**

Run: `git status -sb && git log --oneline -2`

Expected output:

```
## main...origin/main
<NEW-SHA> docs: bidirectional cross-references between /ship spec, ship-pattern, and Jira convention (#<N>)
9cc07c5 docs: archive implementation plan for PR #59 merge + cleanup (#60)
```

If `git status` shows any uncommitted changes OR the new squash commit is missing from the log, STOP and investigate.

---

## Self-Review

**1. Spec coverage:**

- ✅ Edit 1 (spec back-pointer) → Task 1
- ✅ Edit 2 (CLAUDE.md forward pointer) → Task 2
- ✅ Branch + commit + merge strategy → Tasks 1, 2, 3, 4
- ✅ Verification (no automated tests, no dashboard render) → embedded as verify steps inside each task
- ✅ No CCE ticket → documented in spec, reinforced in PR body (Task 3 Step 4)
- ✅ Post-merge cleanup → Task 4 Steps 2-4
- ✅ Success criteria #1-#5 → all covered by Task 1 Step 3, Task 2 Step 3, Task 3 Step 5, Task 4 Step 4

**2. Placeholder scan:**

- No "TBD", "TODO", "implement later" — all edit text is verbatim and quoted
- No "Add appropriate handling" — every step has an exact command + expected output
- No "Similar to Task N" — Task 2 repeats the verify-and-commit pattern with its own exact text rather than referring back to Task 1

**3. Type consistency:**

- N/A (docs-only, no types or function signatures)
- Branch name `docs/symmetric-pointers-jira-ship` is used identically across Tasks 1-4
- Path `docs/superpowers/specs/2026-05-09-ship-slash-command-design.md` is used identically wherever referenced
- Commit message prefixes match the spec's "Branch + commit + merge strategy" section exactly (`docs(spec):` and `docs(claude.md):`)
