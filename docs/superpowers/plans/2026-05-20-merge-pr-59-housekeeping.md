# Merge PR #59 + housekeeping cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Squash-merge open PR #59 (`docs: refresh CLAUDE.md (Jira memory + app layout) and bump tip-classification to v3.4`) to `main`, then clean up local + remote branch state so the working tree is back on a current `main`.

**Architecture:** PR #59 is the docs branch `docs/claude-md-housekeeping` with two commits ahead of `main` and no conflicts (fast-forward-ready). The `/ship` skill would halt at Stage 0 (pre-flight check 3) because the PR already exists, so we bypass it and merge directly via the `gh` CLI. After the squash-merge GitHub deletes the remote branch (`--delete-branch`); `git fetch --prune` then drops the local remote-tracking ref, and `git branch -d` removes the local feature branch. Final state: on `main`, fast-forwarded to the squashed commit, no dangling refs.

**Tech Stack:** `gh` CLI (GitHub), `git` 2.x. No code changes — Markdown-only docs PR.

---

### Task 1: Squash-merge PR #59 to main

**Files:**

- Modify (remote): GitHub PR #59 → branch `main`
- No local file changes in this task — purely a remote operation via `gh`

- [ ] **Step 1: Confirm pre-merge state**

```bash
gh pr view 59 --json number,state,mergeable,mergeStateStatus,headRefName,baseRefName
```

Expected output (one JSON line):

```json
{
  "baseRefName": "main",
  "headRefName": "docs/claude-md-housekeeping",
  "mergeStateStatus": "CLEAN",
  "mergeable": "MERGEABLE",
  "number": 59,
  "state": "OPEN"
}
```

If `mergeStateStatus` is not `CLEAN` or `mergeable` is not `MERGEABLE`, STOP and investigate before proceeding.

- [ ] **Step 2: Squash-merge with branch deletion**

```bash
gh pr merge 59 --squash --delete-branch --subject "docs: refresh CLAUDE.md and bump tip-classification to v3.4 (#59)" --body "$(cat <<'EOF'
Refreshes project memory and the tip-classification ledger after the v0.9.7 release.

## What changed

- **CLAUDE.md** — \`Where things live\` now lists \`components/PageNav.tsx\`, \`progression/page.tsx\`, \`probe-catalog.json\`, and the methodology probes sub-page; test count corrected from 223 to 494.
- **\`docs/tip-classification-2026-05-10.md\`** — header bumped to v3.4 with explicit note that v0.9.7 was UI-only (no scorer/rubric changes); changelog gained a PR #56 + #57 entry summarizing the unified PageNav, dashboard-aligned page chrome, probes card redesign, methodology editorial grid, captured-narrative scroll cap, and the dedicated /progression route.

## Why squash

Two related housekeeping commits — squashed for a clean release history that pairs with the v0.9.7 tag.
EOF
)"
```

Expected output (final line):

```
✓ Squashed and merged pull request #59 (docs: refresh CLAUDE.md (Jira memory + app layout) and bump tip-classification to v3.4)
✓ Deleted branch docs/claude-md-housekeeping
```

- [ ] **Step 3: Verify merge landed on main**

```bash
gh pr view 59 --json state,mergedAt,mergeCommit
```

Expected: `state` is `MERGED`, `mergedAt` is a recent ISO timestamp, `mergeCommit.oid` is a valid 40-char SHA.

---

### Task 2: Local branch + remote-tracking ref cleanup

**Files:**

- Modify (local): current working directory's git state — branch checkout, ref pruning
- No file edits

- [ ] **Step 1: Switch to main and fast-forward**

```bash
git checkout main && git pull --ff-only
```

Expected output (last two lines):

```
Already on 'main'
Fast-forward
```

or

```
Switched to branch 'main'
Updating <old>..<new>
Fast-forward
```

The HEAD of `main` should now point at the squashed-merge commit from Task 1.

- [ ] **Step 2: Prune stale remote-tracking refs and delete the local feature branch**

```bash
git fetch --prune && git branch -d docs/claude-md-housekeeping
```

Expected output:

```
 - [deleted]         (none)     -> origin/docs/claude-md-housekeeping
Deleted branch docs/claude-md-housekeeping (was <sha>).
```

If `git branch -d` fails with "not fully merged" (it shouldn't — the branch was just squash-merged), STOP and inspect the diff; do not force-delete without confirming.

- [ ] **Step 3: Verify final clean state**

```bash
git status -sb && git branch -vv | grep docs/claude-md-housekeeping; echo "exit=$?"
```

Expected output:

```
## main...origin/main
exit=1
```

`exit=1` from `grep` confirms the branch is gone. `git status -sb` should show no working-tree changes and `main` up to date with `origin/main`.

- [ ] **Step 4: Confirm the merged commit shows in main's log**

```bash
git log --oneline -1
```

Expected: the squashed commit subject from Task 1 step 2 (`docs: refresh CLAUDE.md and bump tip-classification to v3.4 (#59)`) followed by a 7-char SHA.

---

## Self-review

**1. Spec coverage:** Both items from the spec (merge PR #59, branch cleanup) are covered — Task 1 handles the merge, Task 2 handles local + remote-tracking cleanup. No gaps.

**2. Placeholder scan:** All commands have exact arguments. All expected outputs are concrete strings. No "TBD", no "add appropriate handling". No code blocks reference undefined identifiers — Markdown PR, no code changes.

**3. Type consistency:** N/A (operational plan, no types or function signatures). Branch name `docs/claude-md-housekeeping` and PR number `#59` are used identically across both tasks.
