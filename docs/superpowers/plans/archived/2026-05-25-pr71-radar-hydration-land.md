# Land PR #71 (Radar SSR Hydration Fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the already-clean PR #71 (`fix/radar-hydration-and-docs`) onto `main` with an accurate CLAUDE.md test count, so it bundles into the upcoming v0.9.10 release.

**Architecture:** PR #71 is `MERGEABLE`/`CLEAN` against current `main` (GitHub recomputed after #73/#74/#75 landed) — **no rebase or force-push is required for conflict resolution**. The only correction needed is a doc-staleness bug: the PR "fixes" CLAUDE.md's test count to `527 across 37 files`, but it branched before #73/#74/#75 added tests, so the true current count is higher. We empirically measure the post-merge count on a throwaway verify branch, fix the number on the PR branch with one additive commit (fast-forward push — no force), then squash-merge from the main checkout.

**Tech Stack:** Next.js 16, React (SSR + hydration), Vitest, `gh` CLI, git.

**Scope note:** This plan ends when PR #71 is merged to `main` and the tree is verified green. Cutting the v0.9.10 release tag is the **next, separate** backlog item — not covered here.

---

### Task 1: Empirically measure the post-merge test count

**Why:** We must not claim a test count we haven't observed (CLAUDE.md hard rule: _verify before claiming_). PR #71 adds exactly one test and zero new files; merging it onto current `main` (538 tests / 38 files) should yield 539 / 38 — but we measure rather than assume. The merge also proves the `q()` fix integrates cleanly with the scoring code that landed in #73/#74/#75.

**Files:**

- No edits. Throwaway branch only.

- [ ] **Step 1: Fetch and confirm starting state**

Run:

```bash
git fetch origin --prune
git switch main
git log --oneline -1
```

Expected: HEAD is `131e1cf feat(score): model-effort Execution scorer ... (#75)` (or newer if main advanced), working tree clean apart from the untracked `docs/superpowers/plans/` files.

- [ ] **Step 2: Build a throwaway merge-preview branch**

Run:

```bash
git switch -c verify/pr71 origin/main
git merge --no-edit origin/fix/radar-hydration-and-docs
```

Expected: a clean merge (`Merge made by the 'ort' strategy` or fast-forward), **no conflict markers**. If this conflicts, STOP — GitHub's `CLEAN` status would be contradicted and the plan's premise is wrong; investigate before proceeding.

- [ ] **Step 3: Run the full suite on the merged state**

Run:

```bash
npx vitest run 2>&1 | tail -4
```

Expected: all green, e.g. `Test Files  38 passed (38)` and `Tests  539 passed (539)`. **Record the exact two numbers** (`<FILES>` and `<TESTS>`) — they feed Task 2. If the file count is not 38 or the test count is not 538+1, recount before continuing.

- [ ] **Step 4: Tear down the throwaway branch**

Run:

```bash
git switch main
git branch -D verify/pr71
```

Expected: `Deleted branch verify/pr71`. No commit was pushed; this branch was measurement-only.

---

### Task 2: Correct the stale test-count claim on the PR branch

**Why:** PR #71's CLAUDE.md hunk changes the count to `527 across 37 files`. Squash-merging that onto current `main` would write a number that is already wrong. We fix it on the branch with one additive commit so the squash lands the verified count. Adding a commit is a fast-forward push — **no force-push needed**.

**Files:**

- Modify: `CLAUDE.md` (the `## Tests` block, one line)

- [ ] **Step 1: Check out the PR branch**

Run:

```bash
git switch fix/radar-hydration-and-docs
git log --oneline -1
```

Expected: HEAD is `61ca59c fix(radar): quantize SVG coords ...`.

- [ ] **Step 2: Confirm the stale line is present**

Run:

```bash
grep -n "tests across" CLAUDE.md
```

Expected: `72:npx vitest run            # 527 tests across 37 files, ~5s` (line number may differ slightly).

- [ ] **Step 3: Edit the count to the verified numbers from Task 1**

Replace this exact line in `CLAUDE.md`:

```
npx vitest run            # 527 tests across 37 files, ~5s
```

with (substitute the `<TESTS>`/`<FILES>` you recorded in Task 1 Step 3 — expected 539 / 38):

```
npx vitest run            # 539 tests across 38 files, ~5s
```

Leave the surrounding ` ```bash ` fence and the `## Commands` section the PR added untouched.

- [ ] **Step 4: Verify the edit and that nothing else changed**

Run:

```bash
git diff CLAUDE.md
```

Expected: a single one-line change (`527`→`539`, `37`→`38`). No other hunks.

- [ ] **Step 5: Commit (additive — do NOT amend)**

Run:

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): sync test count to post-merge total (539/38)

PR #71 branched before #73/#74/#75 added tests; its 527/37 figure was
stale on arrival. Measured 539 tests / 38 files on a merge preview of
this branch onto current main.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Expected: a new commit on `fix/radar-hydration-and-docs` on top of `61ca59c`. (Squash-merge will collapse both commits into one, so the stale-then-fixed history does not reach `main`.)

- [ ] **Step 6: Push the branch (USER ACTION — fast-forward, no force)**

This adds a commit; it is **not** a history rewrite, so `--force` is not required and the `block-destructive` force-push restriction does not apply. The user runs from their prompt:

```
! git push origin fix/radar-hydration-and-docs
```

Expected: a normal (non-forced) push updating the remote branch. PR #71 picks up the new commit automatically.

---

### Task 3 (OPTIONAL): Browser smoke-test the hydration fix

**Why:** PR #71's test plan left "Verified in browser: no React hydration warning" unchecked. The unit test pins the _contract_ (every coord ≤1 decimal) and the root cause is well understood, so this is confirmatory, not blocking. Skip if not running a dev server.

**Files:**

- No edits.

- [ ] **Step 1: Start the dev server**

Run (background):

```bash
npm run dev
```

Expected: Next.js (Turbopack) listening on `http://localhost:3737`.

- [ ] **Step 2: Load the dashboard and read the console**

Open `http://localhost:3737` (the dashboard renders the radar). Read the browser console.
Expected: **no** `Warning: Prop \`cy\` did not match`/`Text content did not match`/ hydration-mismatch messages originating from`RadarChart`. The radar renders visually identical to before (the 0.1px quantization is sub-pixel).

- [ ] **Step 3: Stop the dev server**

Stop the background `npm run dev` process.

---

### Task 4: Squash-merge PR #71 and sync main

**Why:** With the branch clean and the count corrected, land it. Per the CLAUDE.md gotcha, run `gh pr merge` **from the main checkout** (not a worktree) so the local fast-forward half doesn't fail. Squash keeps `main` history one-commit-per-PR.

**Files:**

- No edits.

- [ ] **Step 1: Confirm the PR is still clean and now carries the fix commit**

Run:

```bash
gh pr view 71 --json mergeable,mergeStateStatus,commits -q '{mergeable,mergeStateStatus,commits:[.commits[].messageHeadline]}'
```

Expected: `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, and the commit list includes both the original `fix(radar): quantize SVG coords ...` and the new `docs(claude.md): sync test count ...`. If `mergeStateStatus` is not `CLEAN`, STOP and reassess (main may have moved).

- [ ] **Step 2: Squash-merge from the main checkout (USER ACTION or authorized)**

From the `main` checkout (confirm with `git rev-parse --show-toplevel` that you are in the primary repo, not a worktree):

```bash
gh pr merge 71 --squash --delete-branch
```

Expected: `Merged pull request #71`. If the local cleanup half fails with `fatal: 'main' is already checked out`, the GitHub-side merge still succeeded — recover via Step 3.

- [ ] **Step 3: Sync local main and prune**

Run:

```bash
git switch main
git fetch origin --prune
git merge --ff-only origin/main
git log --oneline -3
```

Expected: local `main` fast-forwards to the new squash commit `fix(radar): quantize SVG coords ... (#71)`; the remote `fix/radar-hydration-and-docs` ref is gone after prune.

- [ ] **Step 4: Verify main is green with the accurate count**

Run:

```bash
npx vitest run 2>&1 | tail -4
grep -n "tests across" CLAUDE.md
```

Expected: `Tests  539 passed (539)` / `Test Files  38 passed (38)`, and CLAUDE.md line reads `# 539 tests across 38 files, ~5s` (matching the live suite). The numbers in the doc and the suite now agree.

- [ ] **Step 5: Confirm the release-readiness delta**

Run:

```bash
git tag --list 'v*' --sort=-v:refname | head -1
git log --oneline v0.9.9..HEAD
```

Expected: latest tag `v0.9.9`; the `v0.9.9..HEAD` range now lists five unreleased commits — #72, #73, #74, #75, and #71. This is the bundle the **next** backlog item (cut v0.9.10) will tag. This plan is complete here.
