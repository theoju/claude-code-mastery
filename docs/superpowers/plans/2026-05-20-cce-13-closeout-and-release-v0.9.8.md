# CCE-13 Close-of-Loop + v0.9.8 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the CCE-13 work cycle (Jira transition + tooling gap) and cut release v0.9.8 covering the six PRs that landed since v0.9.7 (#58–#63).

**Architecture:** Three independent operational tasks plus a no-op verification task. No code changes; no tests. The Jira transition and `vercel` install are single-command externalities. The release follows the standard release-branch shape documented in `CLAUDE.md` `## Conventions`: branch → `package.json` bump → PR → squash-merge → tag → `gh release create`.

**Tech Stack:** Atlassian MCP (`atlassian:transitionJiraIssue`), npm global install, `gh` CLI, git.

---

## Scope check + P1.3 reframing

This is a punch-list, not a feature. Each task is independently shippable:

| #   | Task                             | Coupling                                 |
| --- | -------------------------------- | ---------------------------------------- |
| 1   | Jira transition CCE-13 → Done    | None — single API call                   |
| 2   | `npm i -g vercel`                | None — single shell command              |
| 3   | Verify plans on main (no-action) | Prereq sanity for Task 4 only            |
| 4   | Cut release v0.9.8               | Independent; bundles all post-v0.9.7 PRs |

**P1.3 collapses to a no-op verification.** The original task list framed it as "archive merged plan docs following the PR #60 precedent," but a check against the repo shows:

- `docs/superpowers/plans/` is a **flat directory**, not subdivided by status
- PR #60 (`9cc07c5`) **added a new plan doc**, it did not move anything to an `archived/` subdir
- Both plans named in P1.3 (`2026-05-20-symmetric-pointers-jira-ship.md` and `2026-05-20-session-kind-filtering.md`) are already on `main` at HEAD; they landed with their respective feature PRs (#61 and #62)

There is no archive convention to follow because none exists. Introducing one is out of scope for this punch-list (would be its own brainstorm + spec). Task 3 confirms the state and proceeds.

---

## File Structure

| File                                                                | Purpose                        | Task |
| ------------------------------------------------------------------- | ------------------------------ | ---- |
| _(no file)_                                                         | Jira ticket transition via MCP | 1    |
| _(no file)_                                                         | Global npm install             | 2    |
| `docs/superpowers/plans/2026-05-20-session-kind-filtering.md`       | Verify present on main         | 3    |
| `docs/superpowers/plans/2026-05-20-symmetric-pointers-jira-ship.md` | Verify present on main         | 3    |
| `package.json`                                                      | Bump version `0.9.7` → `0.9.8` | 4    |

No code files touched. No tests added — the release PR's correctness is verified by the existing test suite (`520/520 vitest`, `tsc --noEmit` clean) on `main @ 6079729`, which is the release branch's base.

---

## Task 1: Transition CCE-13 to Done

**Files:** None (external Jira mutation via Atlassian MCP)

**Preconditions:**

- PR #62 squash-merged at `2061d43` (✅ already done)
- User has reauthenticated the Atlassian MCP server in this session (✅)
- User provides explicit per-action authorization for the transition (auto-mode classifier requirement)

- [ ] **Step 1: Confirm CCE-13 is currently at Backlog**

Run:

```
mcp__plugin_atlassian_atlassian__getJiraIssue
  cloudId: f375676f-949f-4187-8adf-c9e6bbdb8458
  issueIdOrKey: CCE-13
  fields: ["status"]
```

Expected: `status.name == "Backlog"` (status id `10070`).

- [ ] **Step 2: List available transitions to confirm "Done" id**

Run:

```
mcp__plugin_atlassian_atlassian__getTransitionsForJiraIssue
  cloudId: f375676f-949f-4187-8adf-c9e6bbdb8458
  issueIdOrKey: CCE-13
```

Expected: a transition entry with `name: "Done"` and `id: "41"` (per the earlier dispatch in this session that listed transitions 11/21/31/41).

- [ ] **Step 3: Request user authorization**

Per CLAUDE.md `## Issue tracking`: "Auto-mode authorization for Jira writes is scoped per action." The transition call must wait for an explicit yes from the user — even after the earlier comment was approved.

Ask: _"Authorize the Jira transition CCE-13 → Done (transition id 41) now?"_

Wait for an affirmative text response. If the classifier blocks anyway, the user can run the call via `! ` prefix in their prompt (the call surface is an MCP tool, not a shell command — so prefer asking the user to retype the authorization rather than fabricating a shell workaround).

- [ ] **Step 4: Execute the transition**

Run:

```
mcp__plugin_atlassian_atlassian__transitionJiraIssue
  cloudId: f375676f-949f-4187-8adf-c9e6bbdb8458
  issueIdOrKey: CCE-13
  transition: {"id": "41"}
```

Expected: 204 No Content (empty success response).

- [ ] **Step 5: Verify the new state**

Run the same `getJiraIssue` call from Step 1.

Expected: `status.name == "Done"`.

- [ ] **Step 6: No commit needed** — external mutation only. Move to Task 2.

---

## Task 2: Install Vercel CLI globally

**Files:** None (environment change)

**Preconditions:**

- macOS shell session (zsh on Darwin per environment)
- `npm` available on `PATH`

- [ ] **Step 1: Verify vercel is not currently installed**

Run: `which vercel && vercel --version`

Expected: `vercel not found` or non-zero exit. This matches the current `signalsSummary.hasVercelCli: false` reading.

- [ ] **Step 2: Install globally**

Run: `npm i -g vercel`

Expected: install completes within ~30s; output ends with `added N packages in <duration>`.

- [ ] **Step 3: Verify the install**

Run: `vercel --version`

Expected: a version string like `vercel 48.x.x` (or whatever ships current on npm). Exit 0.

- [ ] **Step 4: Sanity-check the agentic-flow commands resolve**

Run: `vercel env --help | head -5 && vercel deploy --help | head -3`

Expected: usage text for both. No "command not found" errors.

- [ ] **Step 5: No commit needed** — environment change only. The next `npm run assess` run will flip `hasVercelCli: true` and reduce the Integrations execution next-action rank. Move to Task 3.

---

## Task 3: Verify both plan docs are present on main

**Files:**

- Read: `docs/superpowers/plans/2026-05-20-session-kind-filtering.md`
- Read: `docs/superpowers/plans/2026-05-20-symmetric-pointers-jira-ship.md`

**Preconditions:**

- Local branch is `main`
- Local main fast-forwarded to `6079729` or later

- [ ] **Step 1: Confirm both plan files exist on main**

Run:

```bash
git log --oneline --all -- docs/superpowers/plans/2026-05-20-session-kind-filtering.md | head -1
git log --oneline --all -- docs/superpowers/plans/2026-05-20-symmetric-pointers-jira-ship.md | head -1
```

Expected:

- First command: `2061d43 feat(score): session-kind filtering for execution posture scorers — CCE-13 (#62)`
- Second command: `b99856d docs: bidirectional cross-references between /ship spec, ship-pattern, and Jira convention (#61)`

If either is empty, stop and investigate — the file should be on main.

- [ ] **Step 2: Confirm flat-directory convention**

Run: `ls docs/superpowers/plans/ | wc -l && ls -d docs/superpowers/plans/archived/ 2>&1`

Expected: ~17 plan files listed; `archived/` directory does **not** exist (output: `ls: docs/superpowers/plans/archived/: No such file or directory`).

- [ ] **Step 3: Record the no-op decision**

No file moves. No commit. Document in plan preamble that this matches repo convention. Proceed to Task 4.

---

## Task 4: Cut release v0.9.8

**Files:**

- Modify: `package.json` (line containing `"version": "0.9.7"` → `"version": "0.9.8"`)
- Create: nothing else

**Preconditions:**

- Local branch is `main` at `6079729` (PR #63 merged)
- Working tree is clean (or only `next-env.d.ts` modified, which is gitignored-equivalent)
- `gh` CLI authenticated
- `git tag --list v0.9.7` shows the tag exists; `v0.9.8` does not yet exist

### Task 4a: Create release branch and bump version

- [ ] **Step 1: Verify clean preflight**

Run:

```bash
git branch --show-current
git log --oneline -1
git status --short
git tag --list 'v0.9.7'
git tag --list 'v0.9.8'
```

Expected:

- Current branch: `main`
- HEAD: `6079729 docs(claude.md): worktree-merge gotcha + per-write Jira auth scoping (#63)`
- Working tree: clean or only `M next-env.d.ts`
- `v0.9.7` exists
- `v0.9.8` does **not** exist

If `v0.9.8` already exists, stop. Either the release already shipped or the tag is stale and needs investigation (`git tag -d v0.9.8` would be the recovery, but ask the user before deleting tags).

- [ ] **Step 2: Create release branch**

Run: `git checkout -b chore/release-0.9.8`

Expected: `Switched to a new branch 'chore/release-0.9.8'`.

- [ ] **Step 3: Bump package.json version**

Use the Edit tool against `/Users/theo/Projects/claude-extensions/package.json`:

```
old_string:   "version": "0.9.7",
new_string:   "version": "0.9.8",
```

The line includes the trailing comma. If JSON formatting differs from this exact pattern (e.g., trailing whitespace), Read the file first and match the exact byte sequence.

- [ ] **Step 4: Confirm the bump**

Run: `cat package.json | python3 -c "import json,sys; print('version:', json.load(sys.stdin)['version'])"`

Expected: `version: 0.9.8`

- [ ] **Step 5: Commit the bump**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore(release): bump version to 0.9.8

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: 1 file changed, 1 insertion(+), 1 deletion(-).

### Task 4b: Open the release PR

- [ ] **Step 6: Push the branch**

Run: `git push -u origin chore/release-0.9.8`

Expected: `* [new branch] chore/release-0.9.8 -> chore/release-0.9.8` and a tracking ref message.

- [ ] **Step 7: Open the PR**

Run (verbatim — the body uses a HEREDOC to preserve formatting):

```bash
gh pr create --base main --title "chore(release): bump version to 0.9.8" --body "$(cat <<'EOF'
Release v0.9.8 — Session-kind filtering + docs hardening.

## What's in this release

**Execution posture scoring now uses the right denominator** (#62 — CCE-13)
- New \`classifySessionKind\` taxonomy: \`interactive_cli\` / \`sdk_orchestrated\` / \`subagent\` / \`observer\` / \`unknown\`
- \`withGates({ universe: "interactive_only" })\` restricts posture scorers (permissions, plan mode, learning, multi-task) to user-set sessions
- Volume scorers (integrations, scheduled, remote) keep \`all_sessions\`
- \`interactiveSessionsAnalyzed\` denominator + \`sessionsByKind\` census on the probes page
- New CLAUDE.md hard rule on denominator semantics

**/ship surfaced as a recommended pattern** (#58, #61)
- \`docs/ship-pattern.md\` describes the 8-stage chain
- Rendered at \`/docs/ship-pattern\` via new \`app/lib/doc-markdown.tsx\` in-repo doc renderer
- Reader-vs-agentic callouts on the design spec; bidirectional cross-references between spec, ship-pattern doc, and CLAUDE.md \`## Issue tracking\`

**Jira convention codified** (#59)
- New \`## Issue tracking\` section in CLAUDE.md
- designitright.atlassian.net · Claude-Code-Extensions project · \`CCE-N\` ticket pattern

**Operational gotchas captured** (#63)
- \`gh pr merge --delete-branch\` from worktree failure mode + recovery recipe
- Per-action Jira authorization scoping (each Jira write needs its own user direction)

**Plan archival housekeeping** (#60)
- Operational plan for the PR #59 merge cycle filed under \`docs/superpowers/plans/\`

## Validation

- 520/520 vitest tests pass on \`main @ 6079729\`
- \`tsc --noEmit\` clean (exit 0)
- \`next build\` prerenders all routes including \`/docs/ship-pattern\`

## Test plan

- [x] \`npm run assess\` produces a snapshot that names the new dimensions/universes
- [x] PRs #58–#63 all merged cleanly with no rollbacks
- [x] Working tree clean; no orphan worktrees

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: URL output like `https://github.com/theoju/claude-code-self-assessment/pull/64` (number may differ).

- [ ] **Step 8: Note the PR number**

Capture the PR number from Step 7's stdout. Subsequent steps reference it as `$PR`. Example: if the URL ends in `/pull/64`, then `$PR = 64`.

### Task 4c: User-executed merge

- [ ] **Step 9: Request user merge**

Ask the user to merge from this main checkout (per the new CLAUDE.md gotcha bullet — running `gh pr merge` from the worktree would fail mid-cleanup):

```
! gh pr merge $PR --squash --delete-branch
```

Wait for the user to confirm the merge landed.

- [ ] **Step 10: Verify the merge**

Run:

```bash
gh pr view $PR --json state,mergeCommit
```

Expected: `state: MERGED`; capture the squash commit SHA from `mergeCommit.oid`. Call this `$RELEASE_SHA`.

- [ ] **Step 11: Update local main**

Run:

```bash
git checkout main
git fetch --prune
git merge --ff-only origin/main
git log --oneline -1
```

Expected: HEAD is the new squash commit (`$RELEASE_SHA`); commit subject is `chore(release): bump version to 0.9.8 (#$PR)`.

### Task 4d: Tag the release

- [ ] **Step 12: Create the annotated tag**

Run:

```bash
git tag -a v0.9.8 -m "v0.9.8 — Session-kind filtering + docs hardening" $RELEASE_SHA
```

Use the actual SHA captured in Step 10 in place of `$RELEASE_SHA`. (Annotated, not lightweight — matches the pattern used by previous tags per `git tag --list 'v0.9*'`.)

- [ ] **Step 13: Push the tag**

Run: `git push origin v0.9.8`

Expected: `* [new tag] v0.9.8 -> v0.9.8`.

- [ ] **Step 14: Verify the tag**

Run: `git tag --list 'v0.9.8' && git log --oneline v0.9.8 -1`

Expected: tag exists; commit subject is the release bump squash.

### Task 4e: Create the GitHub release

- [ ] **Step 15: Create the release**

Run (verbatim):

```bash
gh release create v0.9.8 --title "v0.9.8 — Session-kind filtering + docs hardening" --notes "$(cat <<'EOF'
## Session-kind filtering release

Execution posture scoring now restricts itself to sessions whose posture is actually settable by the user. Everything else stays where it already was.

### Highlights

**Session-kind taxonomy** (#62 — CCE-13)
- \`classifySessionKind\` reads transcript and session-meta JSON to label each session as one of:
  - \`interactive_cli\` — you driving the keyboard
  - \`sdk_orchestrated\` — SDK-spawned sessions (Routine, hook, headless)
  - \`subagent\` — agent-tool invocations
  - \`observer\` — observer-mode sessions
  - \`unknown\` — fallback when signals are absent
- Posture scorers (permissions, plan mode, learning, multi-task) now declare \`withGates({ universe: "interactive_only" })\` and divide by \`interactiveSessionsAnalyzed\`
- Volume scorers (integrations, scheduled, remote) keep the broad \`all_sessions\` universe
- New \`sessionsByKind\` census exposed on the probes page
- CLAUDE.md gains a hard rule documenting denominator semantics

**/ship pattern surfaced** (#58, #61)
- \`docs/ship-pattern.md\` walks through the 8-stage release ceremony
- Rendered at \`/docs/ship-pattern\` via a new \`app/lib/doc-markdown.tsx\` doc renderer (superset of \`boris-content.tsx\` — H1/GFM tables/HR/OL)
- Spec and ship-pattern doc cross-reference each other; CLAUDE.md \`## Issue tracking\` points at Stage 7 as the canonical Jira-touching automation example

**Jira convention** (#59)
- designitright.atlassian.net · Claude-Code-Extensions project · \`CCE-N\` ticket keys
- First CCE-N ticket shipped: CCE-13 (this release's feature)

**Operational gotchas** (#63)
- Worktree + \`gh pr merge --delete-branch\` failure mode + recovery recipe
- Per-action Jira authorization scoping

### Validation

- 520/520 vitest tests pass
- \`tsc --noEmit\` clean
- \`next build\` prerenders all routes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: URL output for the release page on GitHub.

- [ ] **Step 16: Verify the release**

Run: `gh release view v0.9.8 --json name,tagName,publishedAt | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))"`

Expected: JSON showing `name: "v0.9.8 — …"`, `tagName: "v0.9.8"`, and a `publishedAt` timestamp.

- [ ] **Step 17: Final prune**

Run: `git fetch --prune`

Expected: any stale remote-tracking ref for `chore/release-0.9.8` is removed (output line like `- [deleted] (none) -> origin/chore/release-0.9.8`).

---

## Self-review (post-write)

1. **Task coverage check.** The original P0+P1 list has four items:
   - P0.1 Jira transition → Task 1 ✅
   - P0.2 vercel install → Task 2 ✅
   - P1.3 archive plans → Task 3 (reframed to no-op verify per repo reality) ✅
   - P1.4 v0.9.8 release → Task 4 (subdivided 4a-4e) ✅

2. **Placeholder scan.** No TBDs. No "implement later." `$PR` and `$RELEASE_SHA` are explicit substitution markers with the source step labeled. All commit messages, PR body, release notes are quoted verbatim.

3. **Type/path consistency.**
   - `cloudId f375676f-949f-4187-8adf-c9e6bbdb8458` used consistently in Task 1 (matches the value from earlier successful comment in this session)
   - Transition id `41` matches the response from the earlier `getTransitionsForJiraIssue` call
   - `package.json` line target (`"version": "0.9.7"`) verified by reading the file
   - PR/commit SHA references are exact: `6079729` (#63), `2061d43` (#62), `b99856d` (#61), `9cc07c5` (#60), `7813479` (#59), `26ad68b` (#58), `fe9ad2f` (v0.9.7 bump)
   - Tag pattern matches prior releases (annotated tag via `git tag -a`)

4. **Scope check.** Four independent tasks, all operational. Two are single-call externalities (Task 1, Task 2). Task 3 is a 2-command verification with a documented no-op outcome. Task 4 is a multi-step but standard release flow that has been executed five times prior on this repo (v0.9.0, .5, .6, .7).

5. **Risk check.**
   - Task 1: only risk is classifier block; mitigation is per-action user authorization at Step 3 before invoking the tool.
   - Task 2: low risk; if install fails, retry or report and move on.
   - Task 3: zero risk; read-only.
   - Task 4: standard release flow. The main risk is `gh pr merge` from the worktree, but Task 4c explicitly directs the merge to run from the main checkout and references the CLAUDE.md gotcha.

---

## Success criteria

This plan succeeds when all of the following are true:

1. CCE-13 Jira status is `Done` (visible at https://designitright.atlassian.net/browse/CCE-13).
2. `which vercel` returns a path and `vercel --version` prints a version.
3. Both plan files (`2026-05-20-session-kind-filtering.md`, `2026-05-20-symmetric-pointers-jira-ship.md`) are confirmed present on `main` at the original paths.
4. `git tag --list 'v0.9.8'` returns `v0.9.8`.
5. `gh release view v0.9.8` returns a published release with the notes block from Step 15.
6. `package.json` on `main` has `"version": "0.9.8"`.
7. No orphan branches: `git branch --list 'chore/release-0.9.8'` is empty; `git ls-remote origin chore/release-0.9.8` is empty.
