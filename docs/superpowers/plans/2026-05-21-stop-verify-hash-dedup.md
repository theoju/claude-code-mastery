# Stop Verify Hook — Hash Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add diff-state hash dedup to `~/.claude/hooks/stop-verify.sh` so the Stop hook fires once per _new_ working-tree state above its threshold, not once per yield.

**Architecture:** Insert a hash-compute + dedup-check layer between the existing threshold check and the existing block emission. Hash state stored per-repo under `~/.claude/.stop-verify-hashes/<12-char-repo-key>`. Hash is written **only when the hook fires** so below-threshold transients don't silently advance the baseline. Graceful degradation when `shasum` is absent.

**Tech Stack:** Bash 3.2+ (macOS default), `shasum`, `git`, `jq` (already required by the existing hook), POSIX `mktemp`.

---

## File Structure

| File                                                                  | Purpose                                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Modify: `~/.claude/hooks/stop-verify.sh`                              | Add UNTRACKED_BLOCK accumulator, HASH computation, dedup check, hash write |
| Create: `~/.claude/hooks/stop-verify.sh.pre-dedup`                    | One-time backup of the pre-change hook (safety net; not in any repo)       |
| Create: `~/.claude/hooks/__tests__/stop-verify.test.sh`               | Test harness with 5 focused scenarios                                      |
| Modify: `docs/superpowers/plans/2026-05-21-stop-verify-hash-dedup.md` | This plan, committed to the docs branch (final task)                       |

Implementation files (`~/.claude/hooks/*`) live outside any git repository. There is no per-task git commit for them; safety comes from the backup file and the test harness. Only the plan doc itself lands as a git commit on the `docs/stop-verify-hash-dedup` branch.

The spec lives at `docs/superpowers/specs/2026-05-21-stop-verify-hash-dedup-design.md` (committed in `9a5580c`). Branch `docs/stop-verify-hash-dedup` is already created and the current HEAD.

---

## Task 1: Back up the existing hook

**Files:**

- Read: `~/.claude/hooks/stop-verify.sh`
- Create: `~/.claude/hooks/stop-verify.sh.pre-dedup`

- [ ] **Step 1: Confirm the hook exists and is the expected version**

Run:

```bash
ls -la ~/.claude/hooks/stop-verify.sh
sha256sum ~/.claude/hooks/stop-verify.sh 2>/dev/null || shasum -a 256 ~/.claude/hooks/stop-verify.sh
```

Expected: file exists; capture the hash for the rollback record.

- [ ] **Step 2: Copy to a side-by-side backup**

Run:

```bash
cp ~/.claude/hooks/stop-verify.sh ~/.claude/hooks/stop-verify.sh.pre-dedup
```

- [ ] **Step 3: Verify the backup is byte-identical**

Run:

```bash
diff -q ~/.claude/hooks/stop-verify.sh ~/.claude/hooks/stop-verify.sh.pre-dedup
```

Expected: no output (files match). If the command prints "differ," abort and investigate.

- [ ] **Step 4: No commit**

The backup file lives in `~/.claude/hooks/` (not in any repo). No git action.

---

## Task 2: Create the test harness scaffold

**Files:**

- Create: `~/.claude/hooks/__tests__/stop-verify.test.sh`

- [ ] **Step 1: Create the test directory**

Run:

```bash
mkdir -p ~/.claude/hooks/__tests__
```

- [ ] **Step 2: Write the harness with helpers and one sanity test**

Create `~/.claude/hooks/__tests__/stop-verify.test.sh` with the following exact content:

```bash
#!/usr/bin/env bash
# Test harness for ~/.claude/hooks/stop-verify.sh.
# Usage: bash ~/.claude/hooks/__tests__/stop-verify.test.sh
# Exit 0 on all pass, 1 on any failure.

set -u

HOOK="$HOME/.claude/hooks/stop-verify.sh"
HASHES_DIR="$HOME/.claude/.stop-verify-hashes"
PASS=0
FAIL=0

# --- Helpers ---

make_repo() {
  local d
  d=$(mktemp -d)
  (
    cd "$d"
    git init -q
    git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  ) >/dev/null
  echo "$d"
}

invoke_hook() {
  # $1: repo path; $2: JSON stdin (default '{}')
  local repo=$1
  local json=${2:-'{}'}
  ( cd "$repo" && printf '%s' "$json" | bash "$HOOK" )
}

assert_silent() {
  # $1: output; $2: test name
  if [[ -z "$1" ]]; then
    PASS=$((PASS + 1))
    printf '  ok   %s\n' "$2"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL %s (expected silent, got: %s)\n' "$2" "$1"
  fi
}

assert_blocks() {
  # $1: output; $2: test name
  if [[ "$1" == *'"decision":"block"'* || "$1" == *'"decision": "block"'* ]]; then
    PASS=$((PASS + 1))
    printf '  ok   %s\n' "$2"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL %s (expected block, got: %s)\n' "$2" "$1"
  fi
}

assert_state_present() {
  # $1: test name
  if compgen -G "$HASHES_DIR/*" > /dev/null; then
    PASS=$((PASS + 1))
    printf '  ok   %s\n' "$1"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL %s (expected state file under %s, found none)\n' "$1" "$HASHES_DIR"
  fi
}

clean_state() {
  rm -rf "$HASHES_DIR"
}

# --- Tests ---

echo "stop-verify.sh test harness"
echo

# Test 0: sanity — invoking the hook with no changes in an empty repo is silent
clean_state
R=$(make_repo)
OUT=$(invoke_hook "$R")
assert_silent "$OUT" "sanity: empty repo, empty diff"
rm -rf "$R"

# --- Summary ---

echo
echo "PASS=$PASS  FAIL=$FAIL"
[[ "$FAIL" -gt 0 ]] && exit 1
exit 0
```

- [ ] **Step 3: Make it executable and run**

Run:

```bash
chmod +x ~/.claude/hooks/__tests__/stop-verify.test.sh
bash ~/.claude/hooks/__tests__/stop-verify.test.sh
```

Expected output:

```
stop-verify.sh test harness

  ok   sanity: empty repo, empty diff

PASS=1  FAIL=0
```

If the sanity test fails, debug before continuing — likely `git init` failed in the tmpdir or `$HOOK` path is wrong.

- [ ] **Step 4: No commit** (file is in `~/.claude/`, outside any repo)

---

## Task 3: Add tests for existing baseline behavior

**Files:**

- Modify: `~/.claude/hooks/__tests__/stop-verify.test.sh`

These tests pin behavior that the existing hook already provides. They should pass before any change to `stop-verify.sh`.

- [ ] **Step 1: Append three baseline tests**

Find this line in `~/.claude/hooks/__tests__/stop-verify.test.sh`:

```
# --- Summary ---
```

Insert the following block immediately above it:

```bash
# Test 1: small diff below threshold (< 3 files AND < 50 lines) → silent
clean_state
R=$(make_repo)
( cd "$R" && printf 'small\n' > a.txt )
OUT=$(invoke_hook "$R")
assert_silent "$OUT" "baseline: 1-file 1-line untracked is below threshold"
rm -rf "$R"

# Test 2: large untracked file → blocks (existing threshold logic)
clean_state
R=$(make_repo)
( cd "$R" && yes line | head -200 > big.md )
OUT=$(invoke_hook "$R")
assert_blocks "$OUT" "baseline: 1-file 200-line untracked is above threshold"
rm -rf "$R"

# Test 3: stop_hook_active=true → silent (anti-loop guard preserved)
clean_state
R=$(make_repo)
( cd "$R" && yes line | head -200 > big.md )
OUT=$(invoke_hook "$R" '{"stop_hook_active": true}')
assert_silent "$OUT" "baseline: stop_hook_active=true bypasses everything"
rm -rf "$R"

```

(Keep the blank line at the end of the inserted block — it visually separates from the `# --- Summary ---` divider.)

- [ ] **Step 2: Run the harness**

Run:

```bash
bash ~/.claude/hooks/__tests__/stop-verify.test.sh
```

Expected output:

```
stop-verify.sh test harness

  ok   sanity: empty repo, empty diff
  ok   baseline: 1-file 1-line untracked is below threshold
  ok   baseline: 1-file 200-line untracked is above threshold
  ok   baseline: stop_hook_active=true bypasses everything

PASS=4  FAIL=0
```

All four tests should pass against the **unmodified** hook.

- [ ] **Step 3: No commit**

---

## Task 4: Add dedup tests (currently failing)

**Files:**

- Modify: `~/.claude/hooks/__tests__/stop-verify.test.sh`

These tests pin the new dedup behavior. They should **fail** against the unmodified hook.

- [ ] **Step 1: Append three dedup tests**

Find this line in `~/.claude/hooks/__tests__/stop-verify.test.sh`:

```
# --- Summary ---
```

Insert the following block immediately above it (after the baseline tests from Task 3):

```bash
# Test 4: large diff first fire creates state file
clean_state
R=$(make_repo)
( cd "$R" && yes line | head -200 > big.md )
OUT=$(invoke_hook "$R")
assert_blocks "$OUT" "dedup: first fire on large diff blocks"
assert_state_present "dedup: first fire creates state file under .stop-verify-hashes/"
rm -rf "$R"

# Test 5: large diff second fire on identical state → silent (dedup)
clean_state
R=$(make_repo)
( cd "$R" && yes line | head -200 > big.md )
invoke_hook "$R" > /dev/null  # first fire — populates state
OUT=$(invoke_hook "$R")
assert_silent "$OUT" "dedup: identical state on second invocation is silent"
rm -rf "$R"

# Test 6: state changes after first fire → second fire blocks again
clean_state
R=$(make_repo)
( cd "$R" && yes line | head -200 > big.md )
invoke_hook "$R" > /dev/null  # first fire on big.md
( cd "$R" && yes line | head -100 > another.md )  # add a second untracked file
OUT=$(invoke_hook "$R")
assert_blocks "$OUT" "dedup: changed state re-fires"
rm -rf "$R"

```

- [ ] **Step 2: Run the harness against the unmodified hook**

Run:

```bash
bash ~/.claude/hooks/__tests__/stop-verify.test.sh
```

Expected output:

```
stop-verify.sh test harness

  ok   sanity: empty repo, empty diff
  ok   baseline: 1-file 1-line untracked is below threshold
  ok   baseline: 1-file 200-line untracked is above threshold
  ok   baseline: stop_hook_active=true bypasses everything
  ok   dedup: first fire on large diff blocks
  FAIL dedup: first fire creates state file under .stop-verify-hashes/ (expected state file under /Users/.../.claude/.stop-verify-hashes, found none)
  FAIL dedup: identical state on second invocation is silent (expected silent, got: {"decision":"block",...})
  ok   dedup: changed state re-fires

PASS=6  FAIL=2
```

The two `FAIL` lines confirm the dedup tests target genuinely-new behavior. (Test 6's "ok" against the unmodified hook is incidental — without dedup, any large diff fires; once dedup is implemented, it still fires because the state changed.)

If the actual failure count differs from 2, re-read the harness for typos before proceeding.

- [ ] **Step 3: No commit**

---

## Task 5: Implement hash computation in `stop-verify.sh`

**Files:**

- Modify: `~/.claude/hooks/stop-verify.sh`

This task adds the UNTRACKED_BLOCK builder, HASH computation, REPO_KEY/STATE_FILE derivation, and LAST_HASH read — but **not yet the dedup short-circuit or hash write**. Tests still fail at the end of this task; the additions are scaffolding for Task 6.

- [ ] **Step 1: Read the current state of the hook for the exact context**

Run:

```bash
cat ~/.claude/hooks/stop-verify.sh
```

Locate the block that ends with:

```
FILES=$((TRACKED_FILES + UNTRACKED_FILES))
LINES=$((INS + DEL + UNTRACKED_LINES))
```

The hash logic inserts immediately after this pair of lines.

- [ ] **Step 2: Insert the hash computation block**

Using the Edit tool with `~/.claude/hooks/stop-verify.sh`:

```
old_string:
FILES=$((TRACKED_FILES + UNTRACKED_FILES))
LINES=$((INS + DEL + UNTRACKED_LINES))

if (( FILES == 0 && LINES == 0 )); then
  exit 0
fi

new_string:
FILES=$((TRACKED_FILES + UNTRACKED_FILES))
LINES=$((INS + DEL + UNTRACKED_LINES))

# Build a per-file (path + line count) block of untracked entries for hashing.
# Reuses the loop body shape from the UNTRACKED_LINES accumulator above.
UNTRACKED_BLOCK=""
if [[ -n "$UNTRACKED" ]]; then
  while IFS= read -r f; do
    [[ -z "$f" || ! -f "$f" ]] && continue
    n=$(wc -l < "$f" 2>/dev/null | tr -d ' ' || echo 0)
    UNTRACKED_BLOCK+="$f $n"$'\n'
  done <<< "$UNTRACKED"
fi

# Compute diff-state hash. If shasum is absent, leave HASH empty -> dedup
# layer becomes a no-op and we degrade to the existing threshold-only behavior.
HASH=""
STATE_FILE=""
if command -v shasum >/dev/null 2>&1; then
  HASH=$(printf '%s\n%s' "$TRACKED_STAT" "$UNTRACKED_BLOCK" | shasum -a 1 | awk '{print $1}')
  REPO_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -n "$REPO_TOPLEVEL" ]]; then
    REPO_KEY=$(printf '%s' "$REPO_TOPLEVEL" | shasum -a 1 | awk '{print $1}' | head -c 12)
    STATE_FILE="$HOME/.claude/.stop-verify-hashes/$REPO_KEY"
  fi
fi

if (( FILES == 0 && LINES == 0 )); then
  exit 0
fi
```

- [ ] **Step 3: Re-run the harness**

Run:

```bash
bash ~/.claude/hooks/__tests__/stop-verify.test.sh
```

Expected: same `PASS=6 FAIL=2` as Task 4 Step 2. The scaffolding doesn't change behavior yet — it only computes values that aren't used.

If the count regresses (e.g., a baseline test now fails), `diff ~/.claude/hooks/stop-verify.sh.pre-dedup ~/.claude/hooks/stop-verify.sh` and inspect the Edit output before continuing.

- [ ] **Step 4: No commit**

---

## Task 6: Add the dedup short-circuit and the hash write

**Files:**

- Modify: `~/.claude/hooks/stop-verify.sh`

- [ ] **Step 1: Insert dedup short-circuit before the threshold check**

Using the Edit tool with `~/.claude/hooks/stop-verify.sh`:

```
old_string:
if (( FILES == 0 && LINES == 0 )); then
  exit 0
fi

if (( FILES < 3 && LINES < 50 )); then
  exit 0
fi

new_string:
if (( FILES == 0 && LINES == 0 )); then
  exit 0
fi

# Dedup: if we already nagged for exactly this state, stay quiet until
# something actually changes. Hash is written only when we fire (below).
if [[ -n "$HASH" && -n "$STATE_FILE" ]]; then
  LAST_HASH=$(cat "$STATE_FILE" 2>/dev/null || echo "")
  [[ "$HASH" == "$LAST_HASH" ]] && exit 0
fi

if (( FILES < 3 && LINES < 50 )); then
  exit 0
fi
```

- [ ] **Step 2: Insert the hash write immediately before the jq emission**

Using the Edit tool with `~/.claude/hooks/stop-verify.sh`:

```
old_string:
# (5) Emit block decision with verification instructions.
REASON="Before yielding, verify your work:

new_string:
# Mark this state as "already nagged" so the next yield with the same
# state stays silent. Failures are ignored — degrading to today's
# every-yield behavior is acceptable if the state dir is unwritable.
if [[ -n "$HASH" && -n "$STATE_FILE" ]]; then
  mkdir -p "$HOME/.claude/.stop-verify-hashes" 2>/dev/null
  printf '%s\n' "$HASH" > "$STATE_FILE" 2>/dev/null || true
fi

# (5) Emit block decision with verification instructions.
REASON="Before yielding, verify your work:
```

- [ ] **Step 3: Run the full harness**

Run:

```bash
bash ~/.claude/hooks/__tests__/stop-verify.test.sh
```

Expected output:

```
stop-verify.sh test harness

  ok   sanity: empty repo, empty diff
  ok   baseline: 1-file 1-line untracked is below threshold
  ok   baseline: 1-file 200-line untracked is above threshold
  ok   baseline: stop_hook_active=true bypasses everything
  ok   dedup: first fire on large diff blocks
  ok   dedup: first fire creates state file under .stop-verify-hashes/
  ok   dedup: identical state on second invocation is silent
  ok   dedup: changed state re-fires

PASS=8  FAIL=0
```

All 8 tests pass. If any FAIL, read the diff `diff ~/.claude/hooks/stop-verify.sh.pre-dedup ~/.claude/hooks/stop-verify.sh` and reconcile against the spec's "Function/script shape" section.

- [ ] **Step 4: Visually verify the script structure**

Run:

```bash
cat ~/.claude/hooks/stop-verify.sh
```

Confirm the section order matches:

1. Shebang + header comment
2. `set -u` + `INPUT=$(cat)`
3. Anti-loop guard (unchanged)
4. Escape hatch (unchanged)
5. Git repo check (unchanged)
6. TRACKED_STAT / UNTRACKED parsing (unchanged)
7. UNTRACKED_FILES + UNTRACKED_LINES loop (unchanged)
8. `FILES=...; LINES=...` (unchanged)
9. **NEW:** UNTRACKED_BLOCK loop
10. **NEW:** HASH + REPO_KEY + STATE_FILE computation
11. `FILES==0 && LINES==0 → exit 0` (unchanged position)
12. **NEW:** dedup short-circuit
13. `FILES<3 && LINES<50 → exit 0` (unchanged position)
14. **NEW:** hash write
15. `# (5) Emit block decision` + REASON + jq (unchanged)

- [ ] **Step 5: No commit**

---

## Task 7: Add the shasum-absent fallback test

**Files:**

- Modify: `~/.claude/hooks/__tests__/stop-verify.test.sh`

This pins the graceful-degradation behavior from the spec's edge-case table.

- [ ] **Step 1: Append the fallback test**

Find this line in `~/.claude/hooks/__tests__/stop-verify.test.sh`:

```
# --- Summary ---
```

Insert immediately above it:

```bash
# Test 7: shasum absent → degrades to threshold-only (no dedup, but still fires on large diff)
clean_state
R=$(make_repo)
( cd "$R" && yes line | head -200 > big.md )
# Hide shasum by prepending a directory that doesn't contain it.
FAKEBIN=$(mktemp -d)
# Symlink every PATH binary EXCEPT shasum into FAKEBIN.
for cmd in git jq bash awk wc cat tr grep head printf mkdir rm command; do
  full=$(command -v "$cmd" 2>/dev/null || true)
  [[ -n "$full" ]] && ln -sf "$full" "$FAKEBIN/$cmd"
done
OUT=$( cd "$R" && PATH="$FAKEBIN" printf '%s' '{}' | bash "$HOOK" )
assert_blocks "$OUT" "fallback: shasum absent still fires on large diff"
rm -rf "$R" "$FAKEBIN"

```

- [ ] **Step 2: Run the harness**

Run:

```bash
bash ~/.claude/hooks/__tests__/stop-verify.test.sh
```

Expected: 9 tests, all pass.

If the shasum-absent test fails because PATH manipulation didn't actually hide it, debug by running:

```bash
PATH="$FAKEBIN" command -v shasum
```

Expected: empty output (shasum not found). If the binary still resolves, the FAKEBIN sandbox is incomplete — extend the symlink loop with any missing utilities.

- [ ] **Step 3: No commit**

---

## Task 8: Manual smoke test in a live Claude Code session

**Files:** none (live verification)

The harness covers the mechanical cases; this task confirms the fix actually silences the noise in real usage.

- [ ] **Step 1: Inspect the current dedup state for this repo**

Run:

```bash
REPO_KEY=$(printf '%s' "$(git rev-parse --show-toplevel)" | shasum -a 1 | awk '{print $1}' | head -c 12)
echo "REPO_KEY=$REPO_KEY"
ls -la "$HOME/.claude/.stop-verify-hashes/" 2>&1
cat "$HOME/.claude/.stop-verify-hashes/$REPO_KEY" 2>&1
```

If a state file already exists for this repo (from the harness running with a `cd` into a tmpdir, _not_ this repo), that's expected — the harness only mutates files under `mktemp -d` paths, but it does delete `~/.claude/.stop-verify-hashes/` between tests, so the file you see is the most recent test's leftover.

- [ ] **Step 2: Clear any stale state for this repo**

Run:

```bash
rm -f "$HOME/.claude/.stop-verify-hashes/$REPO_KEY"
```

This ensures the next yield in this live session goes through the "first fire" path, which exercises the hash write.

- [ ] **Step 3: Yield from Claude Code and observe**

End the current turn with a short message ("smoke test 1"). The Stop hook will fire because the 861-line untracked plan doc from earlier in the session is still present (`FILES=1, LINES=861+` — over threshold). This is expected.

After the yield completes:

```bash
cat "$HOME/.claude/.stop-verify-hashes/$REPO_KEY"
```

Expected: a 40-character hex string. This proves the hash-write step executed.

- [ ] **Step 4: Yield again with no intervening change**

End the next turn with another short message ("smoke test 2"). The Stop hook should **NOT** fire — the dedup short-circuit exits 0 before reaching the threshold check.

- [ ] **Step 5: Make a small change, yield, and observe re-fire**

Touch a tracked file with a trivial-but-real edit (e.g., update a comment), then yield. Because the diff state changed, HASH differs from the stored hash → dedup misses → threshold (still over, because the plan doc is still there) → hook fires + state file updated.

- [ ] **Step 6: No commit** (live verification only)

---

## Task 9: Commit the plan doc to git

**Files:**

- Add: `docs/superpowers/plans/2026-05-21-stop-verify-hash-dedup.md` (this file)

The plan doc itself is the only artifact landing in git. The implementation files (`~/.claude/hooks/*`) stay outside the repo.

- [ ] **Step 1: Verify branch state**

Run:

```bash
git branch --show-current
git log --oneline -3
```

Expected:

- Current branch: `docs/stop-verify-hash-dedup`
- HEAD: `9a5580c docs(spec): stop-verify hook hash-dedup design`

- [ ] **Step 2: Stage and commit the plan**

Run:

```bash
git add docs/superpowers/plans/2026-05-21-stop-verify-hash-dedup.md
git commit -m "$(cat <<'EOF'
docs(plan): stop-verify hash-dedup implementation plan

Companion to the design spec at
docs/superpowers/specs/2026-05-21-stop-verify-hash-dedup-design.md.
9 TDD-shaped tasks covering: backup, harness scaffold, 4 baseline
tests, 3 dedup tests, 1 fallback test, the script edits in two
phases (scaffold + dedup), manual smoke, and this commit.

Implementation files live at ~/.claude/hooks/* (outside any repo);
the plan + spec are the historical record.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Open the docs-only PR**

Run:

```bash
git push -u origin docs/stop-verify-hash-dedup
gh pr create --base main --title "docs(stop-verify): spec + plan for hash-dedup hook fix" --body "$(cat <<'EOF'
## Summary

Captures the root cause of the recurring Stop-hook false positive (\`stop-verify.sh\` checks diff-vs-HEAD on every yield with no memory of what it already nagged about) and the design + plan to fix it via a per-repo hash-dedup layer.

## What's in this PR

- **Spec:** \`docs/superpowers/specs/2026-05-21-stop-verify-hash-dedup-design.md\` (committed earlier in \`9a5580c\`)
- **Plan:** \`docs/superpowers/plans/2026-05-21-stop-verify-hash-dedup.md\` (this commit)

## What's NOT in this PR

The actual implementation edits \`~/.claude/hooks/stop-verify.sh\`, which lives outside any git repository. The plan documents the change for the historical record, but the code change ships independently when the plan executes.

## Test plan

- [x] Spec self-review passed (no TBDs, internal consistency, scope, ambiguity)
- [x] Plan self-review passed (spec coverage, no placeholders, type consistency)
- [ ] Plan execution: 9 tasks, 9 test cases in the bash harness
- [ ] Live smoke test in a Claude Code session confirms dedup engages

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: a PR URL is printed.

- [ ] **Step 4: Squash-merge from the main checkout**

Per CLAUDE.md `## Conventions` worktree-merge gotcha (and for safety even though this isn't a worktree):

Run from `/Users/theo/Projects/claude-extensions`:

```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

- [ ] **Step 5: Fast-forward local main**

Run:

```bash
git checkout main
git fetch --prune
git merge --ff-only origin/main
git log --oneline -1
```

Expected: HEAD is the new squash commit.

---

## Self-review

### Spec coverage

| Spec section                                      | Plan task(s)                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------- | ------------ | ------------------------- |
| Architecture (modify one file, add state dir)     | Task 5 (compute), Task 6 (dedup + write)                          |
| Detection flow steps 1-3 (existing)               | Preserved in Task 5/6 Edit anchors                                |
| Detection flow step 4 (compute hash)              | Task 5 Step 2 (HASH, UNTRACKED_BLOCK)                             |
| Detection flow step 5 (repo key, state file)      | Task 5 Step 2 (REPO_KEY, STATE_FILE)                              |
| Detection flow step 6 (read LAST_HASH)            | Task 6 Step 1                                                     |
| Detection flow step 7 (dedup short-circuit)       | Task 6 Step 1                                                     |
| Detection flow step 8 (threshold unchanged)       | Verified Task 6 Step 4 (visual structure check)                   |
| Detection flow step 9 (write hash)                | Task 6 Step 2                                                     |
| Detection flow step 10 (emit block unchanged)     | Verified Task 6 Step 4                                            |
| State file format (40-char hash + newline)        | Task 6 Step 2 (`printf '%s\n' "$HASH"`); Task 8 Step 3 verifies   |
| Per-repo key derivation                           | Task 5 Step 2 (`shasum ...                                        | head -c 12`) |
| Edge case: not a git repo                         | Preserved by existing `git rev-parse --git-dir` guard (untouched) |
| Edge case: shasum absent                          | Task 7                                                            |
| Edge case: state dir unwritable                   | Task 6 Step 2 (`                                                  |              | true`after`printf`)       |
| Edge case: state file corrupted                   | Self-healing via `cat ...                                         |              | echo ""` in Task 6 Step 1 |
| Edge case: worktrees of same repo                 | Implicit — `git rev-parse --show-toplevel` returns worktree path  |
| Bash test harness                                 | Tasks 2, 3, 4, 7                                                  |
| Success criteria #1 (script contains hash logic)  | Task 5 + Task 6                                                   |
| Success criteria #2 (preserves existing behavior) | Task 3 (baselines pass) + Task 6 Step 4 (visual order)            |
| Success criteria #3 (state file created)          | Task 4 Test 4, Task 8 Step 3                                      |
| Success criteria #4 (two yields, one nag)         | Task 8 Steps 3-4                                                  |
| Success criteria #5 (harness exists and passes)   | Tasks 2, 3, 4, 7                                                  |
| Branch + merge strategy                           | Task 9                                                            |

No gaps.

### Placeholder scan

Searched for "TBD", "TODO", "implement later", "fill in", "appropriate error handling", "similar to Task". None present. Every Edit step shows complete `old_string` and `new_string` blocks. Every test shows complete bash. Every commit message is verbatim heredoc.

### Type / identifier consistency

- `HASH` (40-char hex) — used in Tasks 5, 6, 7, 8 consistently
- `STATE_FILE` (`$HOME/.claude/.stop-verify-hashes/<REPO_KEY>`) — same path shape in Tasks 5, 6, 8
- `REPO_KEY` (12-char truncated shasum) — Task 5 derives, Task 8 reuses
- `LAST_HASH` — local to Task 6 Step 1, not referenced elsewhere
- `UNTRACKED_BLOCK` — Task 5 builds, hashed in Task 5; not referenced after
- `assert_blocks` / `assert_silent` / `assert_state_present` — defined Task 2 Step 2, used Tasks 3, 4, 7

No drift.

### Risks acknowledged

- **macOS-only `shasum` and `mktemp`:** the harness will not run on systems lacking these. Acceptable for this user — Mac primary.
- **No git safety net for user-level files:** mitigated by Task 1 backup; rollback is `cp ~/.claude/hooks/stop-verify.sh.pre-dedup ~/.claude/hooks/stop-verify.sh`.
- **State directory growth:** ~40 bytes per unique repo touched. Spec explicitly out-of-scope.
- **shasum-absent fallback is hard to test perfectly:** the FAKEBIN PATH trick may miss a shell builtin that resolves around it. If Task 7 Step 2 surfaces a flake, the spec's documented behavior (degrade to existing threshold-only) is still satisfied by the `command -v` guard regardless of harness coverage.
