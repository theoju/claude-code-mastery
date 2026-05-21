# Stop Verify Hook — Hash Dedup Design Spec

> **For agentic workers:** REQUIRED NEXT STEP: invoke `superpowers:writing-plans` to turn this spec into an implementation plan. The implementation edits `~/.claude/hooks/stop-verify.sh` (a user-level file, not in any repo); the spec and plan are committed to this repo as a historical record.

> **For readers:** This spec fixes the recurring false-positive in the user-level Stop hook (`~/.claude/hooks/stop-verify.sh`) that fires on every yield when a long-lived untracked file sits in the working tree. Root cause: the hook computes diff-vs-HEAD on every invocation but has no memory of what it already nagged about. The fix: hash the diff state and skip if it hasn't changed since the last fire.

**Goal:** Stop nagging Claude when nothing has changed since the last nag. Preserve the existing "did meaningful work happen?" semantics for actual changes.

**Why now:** This session ran 8+ consecutive yields where the hook fired on identical state (`1 file / 861 lines changed since HEAD`), forcing a verification ritual every turn even on read-only assessment runs. The noise crowds out the signal — a verification reminder that fires on every yield stops being a useful reminder.

**Why this fix:** Two alternatives (mtime freshness filter; per-file size cap) were considered and rejected. Mtime requires arbitrary window tuning. Per-file cap defeats the hook's original intent for legitimately-large new work. Hash dedup directly addresses the root cause ("we already told you about this exact state") without retuning the threshold or introducing new heuristics.

---

## Architecture

**Premise:** The hook should fire once per _new_ working-tree state above the threshold, not once per yield. "New" is defined as "diff hash differs from the last hash we stored after firing."

**One file modified:**

- `~/.claude/hooks/stop-verify.sh` — add hash computation and dedup logic between the threshold check and the block emission.

**One new state directory:**

- `~/.claude/.stop-verify-hashes/` — per-repo hash storage. Created with `mkdir -p` on first write. Files are 40-char shasums, one per repo.

**No new dependencies:** uses `shasum` (POSIX, present on macOS and most Linux distributions). If `shasum` is absent, the hook falls back to skipping dedup (i.e., behaves like today). No `jq`-version bump.

**Nothing else changes:**

- `~/.claude/settings.json` hook registration
- The block-reason text
- The `CLAUDE_STOP_VERIFY=0` escape hatch
- The anti-loop guard via `stop_hook_active`
- The `(FILES < 3 && LINES < 50)` threshold itself
- Any other hooks (notification, SessionStart sync check, PreToolUse guards)

---

## Detection flow

```
1. Anti-loop guard           (existing, unchanged)
2. Escape hatch              (existing, unchanged)
3. Git repo check            (existing, unchanged)
4. Compute current state:
     TRACKED_STAT = git diff HEAD --shortstat
     UNTRACKED    = git ls-files --others --exclude-standard
     For each untracked path P with line count N: append "P N\n"
     HASH = shasum -a 1 over (TRACKED_STAT + "\n" + UNTRACKED_BLOCK), take first 40 chars
5. Compute repo key:
     REPO_TOPLEVEL = git rev-parse --show-toplevel
     REPO_KEY      = shasum -a 1 over REPO_TOPLEVEL, take first 12 chars
     STATE_FILE    = ~/.claude/.stop-verify-hashes/$REPO_KEY
6. Read stored hash:
     LAST_HASH = $(cat $STATE_FILE 2>/dev/null || echo "")
7. Dedup check:
     If HASH == LAST_HASH → exit 0   ← skip; we already nagged for this state
8. Threshold check           (existing, unchanged: FILES < 3 && LINES < 50 → exit 0)
9. Write hash:
     mkdir -p ~/.claude/.stop-verify-hashes
     printf '%s\n' "$HASH" > $STATE_FILE
10. Emit block decision      (existing, unchanged)
```

### Why write only when firing

If we wrote the hash on every invocation (including the below-threshold skips), a small uncommitted change would silently update the stored hash, and a later legitimate large change would not get nagged because the recorded baseline would have moved. Writing only when we actually fire preserves "we last nagged when the state was X; nag again when it changes from X."

### Why this is correct under the bug scenario

- **Turn 1** — user creates 861-line plan doc. State: `1 file / 861 lines`. HASH=H1. Stored=empty. Mismatch → threshold passes → fire + store H1. ✓
- **Turn 2** — read-only assessment. State identical. HASH=H1. Stored=H1. Match → exit 0 (no fire). ✓
- **Turn 3** — edit a different tracked file by 10 lines. State: `2 files / 871 lines`. HASH=H2. Stored=H1. Mismatch → threshold passes → fire + store H2. ✓
- **Turn 4** — read-only. State unchanged. HASH=H2. Stored=H2. Match → exit 0. ✓
- **Turn 5** — user commits the plan doc. State: `0 files / 0 lines`. HASH=empty-state. Stored=H2. Mismatch → threshold's `FILES==0 && LINES==0` short-circuit → exit 0. Hash NOT written (we didn't fire). ✓
- **Turn 6** — user adds another large untracked file. State: `1 file / 600 lines`. HASH=H3. Stored=H2. Mismatch → threshold passes → fire + store H3. ✓

### Why per-repo state (not global)

Switching between repos (e.g., `claude-extensions` ↔ `advanced-data-importer`) shouldn't reset dedup for either. Each repo accumulates its own nag baseline. The 12-char `REPO_KEY` is derived from the absolute toplevel path, so identical-name repos in different locations stay distinct.

---

## State file format

```
$ ls ~/.claude/.stop-verify-hashes/
9c1f4a8d2b3e

$ cat ~/.claude/.stop-verify-hashes/9c1f4a8d2b3e
e3b0c44298fc1c149afbf4c8996fb92427ae41e4
```

One file per repo. 40-char hex hash + newline. No locking needed (writes are atomic at the filesystem level for files this small; rare contention since hooks run serially per session).

---

## Edge cases

| Case                                              | Behavior                                                                                                                                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not in a git repo (step 3)                        | Existing skip; no state file touched                                                                                                                                                                                                    |
| `shasum` not installed                            | Compute HASH=empty; LAST_HASH also empty; match → exit 0 (graceful degradation to "never nag"). Alternative: fall through to existing threshold logic. **Decision:** fall through — preserve existing behavior when `shasum` is absent. |
| State directory unwritable                        | `printf > $STATE_FILE` fails silently with `2>/dev/null`; hook still fires but dedup doesn't accumulate. Acceptable — degrades to current behavior.                                                                                     |
| State file corrupted (manual edit, partial write) | `cat` returns garbage; HASH won't match; hook fires; new hash overwrites. Self-healing.                                                                                                                                                 |
| Multiple worktrees of same repo                   | `git rev-parse --show-toplevel` returns the worktree path, not the main repo path. Each worktree gets its own state file. This is correct — each worktree has its own diff state.                                                       |
| `~/.claude/` deleted/reset                        | Directory recreated on first fire. Initial fire nags once, then dedup engages.                                                                                                                                                          |
| User runs `git stash` mid-session                 | State changes → hash changes → next yield nags (correctly — the working tree changed).                                                                                                                                                  |
| User commits inside the session, no other change  | Diff empties → step 8's `FILES==0 && LINES==0` exits before hash write. No nag, no state update. Hash from prior nag remains. Next non-trivial change still triggers correctly.                                                         |

---

## Function/script shape

```bash
# Inserted between the existing threshold check and the existing jq emission.

UNTRACKED_BLOCK=""
if [[ -n "$UNTRACKED" ]]; then
  while IFS= read -r f; do
    [[ -z "$f" || ! -f "$f" ]] && continue
    n=$(wc -l < "$f" 2>/dev/null | tr -d ' ' || echo 0)
    UNTRACKED_BLOCK+="$f $n"$'\n'
  done <<< "$UNTRACKED"
fi

HASH=""
if command -v shasum >/dev/null 2>&1; then
  HASH=$(printf '%s\n%s' "$TRACKED_STAT" "$UNTRACKED_BLOCK" | shasum -a 1 | awk '{print $1}')
fi

REPO_KEY=""
STATE_FILE=""
if [[ -n "$HASH" ]]; then
  REPO_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -n "$REPO_TOPLEVEL" ]]; then
    REPO_KEY=$(printf '%s' "$REPO_TOPLEVEL" | shasum -a 1 | awk '{print $1}' | head -c 12)
    STATE_FILE="$HOME/.claude/.stop-verify-hashes/$REPO_KEY"
    LAST_HASH=$(cat "$STATE_FILE" 2>/dev/null || echo "")
    [[ "$HASH" == "$LAST_HASH" ]] && exit 0
  fi
fi

# (existing threshold check stays here, unchanged)

# After deciding to fire, write the hash:
if [[ -n "$HASH" && -n "$STATE_FILE" ]]; then
  mkdir -p "$HOME/.claude/.stop-verify-hashes" 2>/dev/null
  printf '%s\n' "$HASH" > "$STATE_FILE" 2>/dev/null || true
fi

# (existing jq emission stays here, unchanged)
```

The `UNTRACKED_BLOCK` build duplicates work the existing loop already does for `UNTRACKED_LINES`. The implementation plan can either refactor to compute both in one pass or accept the duplication for clarity. Either is acceptable.

---

## Testing

Bash hook tests don't exist in this codebase today. Two options:

1. **Add a minimal harness** at `~/.claude/hooks/__tests__/stop-verify.test.sh` covering:
   - Empty diff → no fire (existing behavior preserved)
   - Small diff below threshold → no fire (existing behavior preserved)
   - Large new diff, first invocation → fire + state file written
   - Large diff, second invocation, identical state → no fire (new dedup behavior)
   - Large diff, third invocation, state changed → fire + state file updated
   - `shasum` absent (mock by temporarily aliasing) → degrades to existing threshold-only behavior
2. **Skip tests** and verify manually in this session.

**Recommendation:** option 1 — bash tests for the hook are a one-time investment that pays off as the hook accrues edge-case handling. The harness file can live at `~/.claude/hooks/__tests__/` to keep with the existing hooks layout.

---

## Out of scope (v1)

Deliberate cuts:

- **Per-file size cap (Design C)** — defer until dedup proves insufficient. The two interact cleanly if added later.
- **Mtime freshness filter (Design B)** — defer; not needed if dedup works.
- **Cleanup of stale state files** — directory grows by ~40 bytes per unique repo. Not a real problem; can add a TTL sweep later if it ever matters.
- **Cross-platform hash command** — `shasum` covers macOS + most Linux. If the user adopts a system without it, fall back to existing threshold-only behavior (the `command -v` guard handles this).
- **Per-session reset of dedup** — could clear state on SessionStart. Defer; the persistent baseline is the desired behavior (a 861-line untracked file across sessions shouldn't nag every yield).
- **Hash includes file _content_ not just line count** — the line-count proxy is sufficient for the bug scenario. Adding content hashing inflates the hook's runtime; defer until we see a case where it matters.

---

## Verification

- **Manual smoke:** after editing the hook, yield from this session. The hook should NOT fire on the next turn (since the 861-line plan doc is unchanged from the last firing state — assuming the state file gets populated on the next fire).
- **Bash harness:** if implemented per option 1 above, all 6 cases pass.
- **No regression:** subsequent legitimate-change yields still produce the verify nag.
- **No state leak:** `ls ~/.claude/.stop-verify-hashes/` shows one entry per repo touched during testing.

---

## Success criteria

The spec succeeds when:

1. `~/.claude/hooks/stop-verify.sh` contains the hash computation, dedup check, and hash write logic per the function shape above.
2. The script preserves all existing behavior: anti-loop guard, escape hatch, git repo check, threshold logic, block-reason text.
3. `~/.claude/.stop-verify-hashes/` is created on first fire and contains a 40-char shasum.
4. In a live session, yielding twice in a row without any change between yields produces exactly one nag, not two.
5. (If option 1 chosen) the bash harness exists and all scenarios pass.

---

## Branch + commit + merge strategy

The implementation edits `~/.claude/hooks/stop-verify.sh` — a user-level file outside any repo. There is no feature branch and no PR for the script itself. However:

- **Spec doc** (this file) lives at `docs/superpowers/specs/2026-05-21-stop-verify-hash-dedup-design.md` and is committed to this repo on a feature branch.
- **Implementation plan** (next, via `writing-plans`) lives at `docs/superpowers/plans/2026-05-21-stop-verify-hash-dedup.md` and is committed alongside.
- Both can land in a single docs-only PR to `main`, since there's no source code in this repo to ship.
- **No CCE ticket required** — this is a tooling fix, not a feature on the CCE backlog. (Open one retroactively if the user wants the audit trail.)

**Branch name suggestion:** `docs/stop-verify-hash-dedup`.

---

## Self-review

- ✅ **Placeholder scan:** no TBDs. All flow steps, hash semantics, state file format, and edge cases specified concretely.
- ✅ **Internal consistency:** the "write hash only when firing" rule is consistent across detection flow, edge cases, and the function shape. Per-repo keying applied uniformly.
- ✅ **Scope check:** single subsystem (one bash script), one small change set, fits one plan. Out-of-scope list explicit.
- ✅ **Ambiguity check:** the `shasum`-absent fallback is explicit (degrade to existing behavior). The "write only when firing" rule is stated three times (detection flow step 9, edge case for committed-then-no-change, and the function shape comment).
