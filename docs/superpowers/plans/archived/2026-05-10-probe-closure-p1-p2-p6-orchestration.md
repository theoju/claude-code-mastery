# Probe Closure PR-P1 + PR-P2+P6 — Orchestrated Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 14 new probes across 2 sequential PRs (PR-P1: 8 slash-command probes; PR-P2+P6: 4 settings-flag + 2 project-local probes), using `/batch` for parallel implementation across independent probes, the Chrome plugin for dashboard validation, and `/ship` for the test→review→commit→push→PR finalization.

**Architecture:** Each probe touches the same 4 layers — a reader (`scripts/signals.mjs` for config, `scripts/_usage-data.mjs` for transcripts), a forwarder (`scripts/run-assessment.mjs#buildSignalsSummary`), a predicate (`app/data/rubric.json`), and tests (`scripts/__tests__/`). Within a PR, probes are independent enough that `/batch` can fan implementation out to multiple worktree-isolated sub-agents in parallel. Between PRs, work is sequential and gated on the prior PR landing on main.

**Tech Stack:** Node.js, vitest (437 tests baseline), Next.js 16 dashboard, predicate-grammar DSL with `~` array-regex operator, Chrome MCP plugin for dashboard E2E checks.

**Detailed task content lives at** `docs/superpowers/plans/2026-05-10-probe-closure-and-validation.md` for V1/P1/P2/P6 per-probe TDD steps. **This plan is the orchestration wrapper** — it sequences the PRs, lays out the `/batch` boundaries, the Chrome validation, and the `/ship` handoff. Each probe's red-green-refactor steps are specified in the linked plan; this plan tells the engineer **which probes to fan out together, when to validate, and how to land each PR**.

---

## File Structure

| File                                                     | Role                                                                              | Touched in       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------- |
| `scripts/_usage-data.mjs`                                | Transcript scanner; add new entries to `TARGET_COMMANDS` Set and `SLASH_RE` map   | PR-P1            |
| `scripts/signals.mjs`                                    | Config-side scanners; add `gatherProjectLocalSettings`, plugin-marketplace reader | PR-P2+P6         |
| `scripts/insights-signals.mjs`                           | Insights-derived signals (auto-session-naming, fork events)                       | PR-P1            |
| `scripts/run-assessment.mjs`                             | `buildSignalsSummary` forwarder                                                   | PR-P1 + PR-P2+P6 |
| `app/data/rubric.json`                                   | Next-action predicates                                                            | PR-P1 + PR-P2+P6 |
| `scripts/__tests__/_fixtures.mjs`                        | Shared test fixtures (extend with new fields)                                     | both PRs         |
| `scripts/__tests__/scan-transcript-invocations.test.mjs` | Per-probe scan tests                                                              | PR-P1            |
| `scripts/__tests__/build-signals-summary.test.mjs`       | Forwarder + snapshot                                                              | both PRs         |
| `scripts/__tests__/signals.test.mjs`                     | Settings-flag scanner tests                                                       | PR-P2+P6         |
| `app/lib/__tests__/rubric-predicates.test.ts`            | Predicate-engine fixture                                                          | both PRs         |

---

## Pre-flight (run once before starting either PR)

### Task 0: Verify tooling

- [ ] **Step 1: Confirm working tree clean and on `main`**

```bash
cd /Users/theo/Projects/claude-extensions
git status --porcelain  # expected: empty
git checkout main && git pull --ff-only  # expected: "Already up to date"
```

- [ ] **Step 2: Confirm baseline tests green**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: `Tests  437 passed (437)` (post-PR #46 baseline).

- [ ] **Step 3: Confirm Chrome plugin is connected**

```bash
claude mcp list 2>&1 | grep -i chrome
```

Expected: `claude-in-chrome` listed as `connected`. If absent, run `/plugin install claude-in-chrome` and reconnect before proceeding.

- [ ] **Step 4: Confirm `/batch` is available**

```bash
ls ~/.claude/commands/batch.md ~/.claude/skills/batch/SKILL.md 2>&1 | grep -v "No such"
```

Expected: at least one of the two paths exists. If neither: `/plugin install` the batch skill before proceeding.

- [ ] **Step 5: Confirm `/ship` skill is wired**

```bash
test -f ~/.claude/skills/ship/SKILL.md && echo "OK"
```

Expected: `OK`. If missing, halt and report.

- [ ] **Step 6: Start the dashboard for Chrome validation**

```bash
cd /Users/theo/Projects/claude-extensions && (npm run dev &) && sleep 8 && curl -fs http://localhost:3737/ | head -1
```

Expected: HTML output (e.g. `<!DOCTYPE html>...`). Leave the dev server running for the duration of both PRs; the Chrome plugin will hit `http://localhost:3737`.

---

## PR-P1: 8 slash-command probes

**Per-probe contract sheet** — pin this before dispatching `/batch`. Each row is one self-contained implementer task.

| #     | Probe                                | Signal field            | Source                                                                  | Rubric next-action            | Predicate (satisfiedWhen)  |
| ----- | ------------------------------------ | ----------------------- | ----------------------------------------------------------------------- | ----------------------------- | -------------------------- |
| P1.1  | `/simplify` (tip 29)                 | `simplifyCommandUses`   | `_usage-data.mjs` TARGET_COMMANDS + per-session count                   | automation/simplify-skill     | `simplifyCommandUses>=1`   |
| P1.2  | `/btw` (tips 33+54)                  | `btwCommandUses`        | `_usage-data.mjs` TARGET_COMMANDS                                       | memory/btw-side-channel       | `btwCommandUses>=1`        |
| P1.3  | `/voice` (tip 60)                    | `voiceCommandUses`      | `_usage-data.mjs` TARGET_COMMANDS                                       | customization/voice-input     | `voiceCommandUses>=1`      |
| P1.4a | `/clear` (tip 63)                    | `clearCommandUses`      | `_usage-data.mjs` TARGET_COMMANDS                                       | memory/compact-clear-balance  | `clearCommandUses>=1`      |
| P1.4b | `/compact` (tip 63)                  | `compactCommandUses`    | `_usage-data.mjs` TARGET_COMMANDS                                       | memory/compact-clear-balance  | `compactCommandUses>=1`    |
| P1.5  | `/fewer-permission-prompts` (tip 69) | `fewerPermsCommandUses` | `_usage-data.mjs` TARGET_COMMANDS                                       | permissions/fewer-perms-skill | `fewerPermsCommandUses>=1` |
| P1.6  | Fork events (tip 53)                 | `sessionForkCount`      | `insights-signals.mjs` (count `--fork-session` markers in session-meta) | parallel/session-fork         | `sessionForkCount>=1`      |
| P1.7  | Auto session naming (tip 86)         | `autoSessionNamedCount` | `insights-signals.mjs` (post-plan-mode rename heuristic)                | planning/auto-session-naming  | `autoSessionNamedCount>=1` |

> All 8 contracts share the same shape: collect a count → forward through `buildSignalsSummary` → wire one predicate. P1.1–P1.5 follow the **`/rewind` precedent from PR #44**: add to `TARGET_COMMANDS` Set, add a `SLASH_RE` entry, increment per session, default to 0 in fixtures, snapshot-update. P1.6 + P1.7 read insights instead of transcripts (different file, same shape). Detailed test bodies for P1.1–P1.5 are in `2026-05-10-probe-closure-and-validation.md` Tasks P1.1–P1.5; P1.6 + P1.7 are new and inlined below.

### Task P1.A: Branch + dependency snapshot

**Files:**

- N/A (branch creation only)

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/theo/Projects/claude-extensions
git checkout -b feat/probes-p1-slash-commands
```

Expected: "Switched to a new branch 'feat/probes-p1-slash-commands'".

- [ ] **Step 2: Snapshot the current snapshot test for ordering reference**

```bash
grep -n "expectedKeys" scripts/__tests__/build-signals-summary.test.mjs | head -3
```

Note the line number — the inline snapshot must be updated alphabetically when 8 new keys are added. Each implementer subagent will need this to avoid snapshot drift.

### Task P1.B: `/batch` dispatch — fan out P1.1–P1.5 (the 5 transcript-derived slash-command probes)

**Files (touched per implementer):**

- Modify: `scripts/_usage-data.mjs:134-262` (add to `TARGET_COMMANDS`, `SLASH_RE`, per-session counters)
- Modify: `scripts/run-assessment.mjs:90-105` (forward new keys in `buildSignalsSummary`)
- Modify: `app/data/rubric.json` (add new `nextActions` with `satisfiedWhen`)
- Modify: `scripts/__tests__/scan-transcript-invocations.test.mjs` (one test per probe)
- Modify: `scripts/__tests__/build-signals-summary.test.mjs` (forwarder + snapshot)
- Modify: `scripts/__tests__/_fixtures.mjs` (default 0 for new counters)

- [ ] **Step 1: Pre-stage `/batch` context file at `/tmp/p1-batch-context.md`**

Write the 5 probe contracts (P1.1–P1.5 from the table) into this file. Each section: Probe ID, signal name, regex literal, rubric action object (with `id`, `dim`, `priority`, `action`, `weight`, `satisfiedWhen`), test name(s), and a one-liner judgement. Each implementer subagent gets a single section.

- [ ] **Step 2: Invoke `/batch` to dispatch 5 parallel implementers**

```
/batch implement-slash-probes
```

When `/batch` prompts for the work spec, paste the contents of `/tmp/p1-batch-context.md` and tell it: each row becomes one git-worktree-isolated implementer subagent following TDD strictly (red → green → commit). Each subagent's task:

1. Add the new entry to `TARGET_COMMANDS` Set and `SLASH_RE` map in `scripts/_usage-data.mjs`
2. Add a per-session counter init in the `counts` object and an increment line at the bottom of the per-session loop
3. Forward the new field in `scripts/run-assessment.mjs#buildSignalsSummary` with `?? 0` default
4. Add the new key (alphabetically) to `expectedKeys` and the inline snapshot in `build-signals-summary.test.mjs`
5. Add `<probe>: 0` default to `makeSignals` in `_fixtures.mjs`
6. Add a positive test in `scan-transcript-invocations.test.mjs` ("counts <probe> as 1-per-session")
7. Add the rubric `nextActions` entry with the `satisfiedWhen` predicate from the contract sheet
8. Add the new field to the all-satisfied fixture in `app/lib/__tests__/rubric-predicates.test.ts`
9. Run `npx vitest run` — must be 437 + N (where N = new tests added) passing
10. Commit with message `feat(probe): add <probe> tracking (tip <N>, P1.<id>)`

Expected output of `/batch`: 5 worktrees, 5 commits queued, all green tests.

- [ ] **Step 3: Linearize the 5 commits onto `feat/probes-p1-slash-commands`**

```bash
# from the batch coordinator's report, cherry-pick each commit in order
for SHA in $BATCH_COMMITS; do
  git cherry-pick "$SHA"
done
```

Expected: 5 clean cherry-picks. If any conflict surfaces (e.g. two implementers both edited `expectedKeys` on the same line), resolve by taking BOTH adds in alphabetical order. Run `npx vitest run` after each cherry-pick to confirm green.

- [ ] **Step 4: Run the full vitest suite**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: `Tests  442 passed (442)` (5 new tests, one per probe). If a snapshot test fails, the inline snapshot in `build-signals-summary.test.mjs` lost an alphabetical insertion — fix by re-running the snapshot update locally.

### Task P1.C: P1.6 — Session fork events (tip 53)

**Files:**

- Modify: `scripts/insights-signals.mjs`
- Modify: `scripts/run-assessment.mjs`
- Modify: `app/data/rubric.json`
- Test: `scripts/__tests__/insights-signals.test.mjs`
- Test: `scripts/__tests__/build-signals-summary.test.mjs`

- [ ] **Step 1: Inspect insights data shape to confirm fork-event format**

```bash
ls ~/.claude/usage-data/session-meta/ | head -3
node -e "const f=require('fs');const j=JSON.parse(f.readFileSync(require('path').join(require('os').homedir(),'.claude/usage-data/session-meta/' + require('fs').readdirSync(require('path').join(require('os').homedir(),'.claude/usage-data/session-meta')).filter(x=>x.endsWith('.json'))[0])));console.log(Object.keys(j))"
```

Look for a `parentSessionId`, `forkedFrom`, or `--fork-session` flag entry. If the field is absent, this probe is **deferred** (mark P1.6 as Bucket-C and skip to Task P1.D).

- [ ] **Step 2: Write failing test in `scripts/__tests__/insights-signals.test.mjs`**

```js
it("counts sessionForkCount when session-meta has parentSessionId entries", async () => {
  const fixture = await mkFixtureSessionMeta([
    { sessionId: "a", parentSessionId: null },
    { sessionId: "b", parentSessionId: "a" },
    { sessionId: "c", parentSessionId: "a" },
  ]);
  const r = await scanInsights(fixture);
  expect(r.sessionForkCount).toBe(2);
});
```

Run: `npx vitest run scripts/__tests__/insights-signals.test.mjs` — expect FAIL with `sessionForkCount is undefined`.

- [ ] **Step 3: Implement in `scripts/insights-signals.mjs`**

Find the `scanInsights` function (or equivalent) and add:

```js
sessionForkCount: sessionMetaEntries.filter(e => e.parentSessionId).length,
```

Forward through `buildSignalsSummary` with `?? 0` default. Add the rubric next-action `parallel/session-fork` with `satisfiedWhen: "sessionForkCount>=1"`.

- [ ] **Step 4: Run tests**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: 443 passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/insights-signals.mjs scripts/run-assessment.mjs app/data/rubric.json scripts/__tests__/insights-signals.test.mjs scripts/__tests__/build-signals-summary.test.mjs scripts/__tests__/_fixtures.mjs
git commit -m "feat(probe): track session fork events (tip 53, P1.6)"
```

### Task P1.D: P1.7 — Auto session naming (tip 86)

**Files:** same as P1.6.

- [ ] **Step 1: Sample real session-meta for the auto-naming heuristic**

Auto-naming fires after a plan-mode entry. Look for sessions where `sessionName` was set and `entryEventTypes` includes `ExitPlanMode`. If the field shape doesn't support this distinction, defer P1.7 (Bucket-C) and skip to Task P1.E.

- [ ] **Step 2: Write failing test**

```js
it("counts autoSessionNamedCount for sessions with non-default name AFTER plan-mode entry", async () => {
  const fixture = await mkFixtureSessionMeta([
    { sessionId: "a", sessionName: "default", events: [] },
    { sessionId: "b", sessionName: "ship-feature-x", events: ["ExitPlanMode"] },
    { sessionId: "c", sessionName: "manual", events: [] },
  ]);
  const r = await scanInsights(fixture);
  expect(r.autoSessionNamedCount).toBe(1);
});
```

- [ ] **Step 3: Implement, run, commit** (same shape as P1.6 — see Task P1.C steps 3–5).

Commit message: `feat(probe): track auto session naming (tip 86, P1.7)`.

### Task P1.E: Real-env smoke check

- [ ] **Step 1: Run assessment**

```bash
npm run assess -- --include-transcripts --insights-lookback 30 2>&1 | tail -20
```

- [ ] **Step 2: Verify all 8 new signals are present**

```bash
node -e "
const a = require('./app/data/assessment.json');
const probes = ['simplifyCommandUses','btwCommandUses','voiceCommandUses','clearCommandUses','compactCommandUses','fewerPermsCommandUses','sessionForkCount','autoSessionNamedCount'];
probes.forEach(p => console.log(p+':', a.signalsSummary[p]));
"
```

Expected: each is a number ≥ 0 (or `undefined` only for any probe deferred to Bucket-C).

### Task P1.F: Chrome plugin dashboard validation

- [ ] **Step 1: Open dashboard in Chrome**

Use the Chrome MCP plugin to navigate to `http://localhost:3737/` (dev server from Task 0).

- [ ] **Step 2: Verify the new signals render in the radar/dimension views**

Take a screenshot and confirm:

- The Permissions, Memory, Customization, and Parallel dimension cards reflect any score changes.
- No JS console errors related to undefined signals.

- [ ] **Step 3: Visit `/dimensions/permissions` and confirm `fewer-perms-skill` next-action is satisfied or surfaced**

If it's Missed (signal=0), the probe still works — render path is what matters.

- [ ] **Step 4: Capture screenshots into `/tmp/p1-dashboard-{before,after}.png`** (before-shot is from the pre-existing assessment-history; after-shot is the post-merge state).

### Task P1.G: `/ship` PR-P1

- [ ] **Step 1: Invoke `/ship`**

```
/ship
```

The chain runs: pre-flight → tests → verify-agent → simplify (skipped only with `--no-simplify`) → code-review → commit (idempotent — already committed) → push → PR → Jira (silent-skip).

- [ ] **Step 2: If `/ship` halts, address the halt**

Per `~/.claude/skills/ship/spokes/halt-rules.md`. Do NOT bypass — fix root cause and re-invoke.

- [ ] **Step 3: PR opened — capture URL**

`/ship` reports the PR URL. Record it for the merge step.

- [ ] **Step 4: Pause for user review and merge**

User reviews, comments, and squash-merges. After merge:

```bash
git checkout main && git pull --ff-only && git fetch --prune
```

Expected: main now has the PR-P1 commit. Local feature branch may need `git branch -d feat/probes-p1-slash-commands`.

---

## PR-P2+P6: 4 settings-flag + 2 project-local probes

**Per-probe contract sheet** — every P2 probe is gated by Task P2.0 (schema sample). If the field doesn't exist in real `~/.claude/settings.json`, the probe is **deferred to Bucket-C** (no probe shipped, just a note in the spec follow-up).

| #    | Probe                          | Signal field          | Source                                                | Predicate                  |
| ---- | ------------------------------ | --------------------- | ----------------------------------------------------- | -------------------------- | --------- |
| P2.1 | Sandboxing (tip 21)            | `hasSandboxConfig`    | `signals.mjs` settings reader                         | `hasSandboxConfig=true`    |
| P2.2 | Output style (tip 26)          | `outputStyle`         | `signals.mjs` settings reader                         | `outputStyle=Explanatory   | Learning` |
| P2.3 | PostCompact hook (tip 41)      | `hasPostCompactHook`  | `signals.mjs` hooks reader                            | `hasPostCompactHook=true`  |
| P2.4 | Auto-dream (tip 45)            | `hasAutoDream`        | `signals.mjs` settings reader                         | `hasAutoDream=true`        |
| P6.1 | Code-review plugin (tip 32)    | `hasCodeReviewPlugin` | `signals.mjs` plugin reader                           | `hasCodeReviewPlugin=true` |
| P6.2 | Per-worktree `/color` (tip 40) | `worktreeColorCount`  | `signals.mjs` `projects/*/settings.local.json` reader | `worktreeColorCount>=1`    |

### Task P2.A: Branch + schema sample gate

- [ ] **Step 1: Create branch from main**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/probes-p2-p6-settings
```

- [ ] **Step 2: Schema-sample `~/.claude/settings.json` for P2 fields**

Dispatch a `general-purpose` Schema-Sampling Agent with this prompt:

> Read `~/.claude/settings.json` and report whether these fields exist (and their value): `sandbox`, `outputStyle`, `hooks.PostCompact`, `autoDream`, `memory.autoDream`. Sample any sibling files like `~/.claude/skills/*/config.json` and the global plugin marketplace cache for `pr-review-toolkit` AND `code-review` plugin entries. Return a structured table: field name, exists (yes/no), value (or `—`), and a recommendation: BUILD (field exists, build the probe) / DEFER (field absent, mark Bucket-C).

- [ ] **Step 3: Apply the sampler's recommendations**

For each P2.x marked DEFER: skip its task in this plan and add a one-liner to the spec's "out of scope" list.

For each marked BUILD: proceed to Task P2.B's `/batch` dispatch with that probe included.

### Task P2.B: `/batch` dispatch — fan out P2 + P6 BUILDable probes

**Files (touched per implementer):**

- Modify: `scripts/signals.mjs` (add reader for the new settings field or plugin entry)
- Modify: `scripts/run-assessment.mjs#buildSignalsSummary` (forward)
- Modify: `app/data/rubric.json` (predicate)
- Modify: `scripts/__tests__/signals.test.mjs` or `scripts/__tests__/integration/gatherSignals.test.mjs`
- Modify: `scripts/__tests__/build-signals-summary.test.mjs` (snapshot)
- Modify: `scripts/__tests__/_fixtures.mjs`
- Modify: `app/lib/__tests__/rubric-predicates.test.ts`

- [ ] **Step 1: Pre-stage `/batch` context at `/tmp/p2p6-batch-context.md`**

For each BUILDable probe (typically 4–6 of the 6 candidates), write a section: probe ID, settings path or plugin name, signal name, predicate, test name (positive and negative).

- [ ] **Step 2: Invoke `/batch`**

```
/batch implement-settings-probes
```

Each implementer subagent's task (worktree-isolated):

1. Add a reader function in `scripts/signals.mjs` that reads the relevant field. Use `safeReadJSON` if it exists, otherwise add a small helper.
2. For boolean probes (`hasSandboxConfig`, `hasPostCompactHook`, `hasAutoDream`, `hasCodeReviewPlugin`): coerce to `!!value` so non-boolean truthy values still count.
3. For string probes (`outputStyle`): pass through verbatim; predicate handles enum comparison.
4. For count probes (`worktreeColorCount`): walk `~/.claude/projects/*/settings.local.json`, count those with a non-default `color` field.
5. Forward through `buildSignalsSummary` with type-appropriate default (`false`, `null`, `0`).
6. Add the rubric `nextActions` entry.
7. Add a positive test (field present, predicate satisfied) and a negative test (field absent, predicate unsatisfied).
8. Add the new field to the `expectedKeys` array and inline snapshot in `build-signals-summary.test.mjs`.
9. Add to `_fixtures.mjs` `makeSignals` defaults.
10. Run `npx vitest run` — all tests pass.
11. Commit: `feat(probe): add <probe> detection (tip <N>, P<bucket>.<id>)`.

- [ ] **Step 3: Linearize commits onto branch** (same procedure as Task P1.B Step 3).

- [ ] **Step 4: Run full suite**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: 442 + N passing where N = number of BUILDable P2+P6 probes.

### Task P2.C: Real-env smoke check

- [ ] **Step 1: Run assessment**

```bash
npm run assess -- --include-transcripts --insights-lookback 30 2>&1 | tail -20
```

- [ ] **Step 2: Verify each new signal**

```bash
node -e "
const a = require('./app/data/assessment.json');
['hasSandboxConfig','outputStyle','hasPostCompactHook','hasAutoDream','hasCodeReviewPlugin','worktreeColorCount'].forEach(p => console.log(p+':', a.signalsSummary[p]));
"
```

Expected: real values match what the schema sampler reported in Task P2.A.

### Task P2.D: Chrome plugin dashboard validation

- [ ] **Step 1: Refresh dashboard in Chrome** (dev server from Task 0 still running).

- [ ] **Step 2: Confirm Permissions, Memory, Integrations, and Customization dimensions reflect any score changes** from the new flips.

- [ ] **Step 3: Visit `/methodology` page and confirm new probes appear in the formula breakdown** (search for the new field name in the page text).

- [ ] **Step 4: Capture before/after screenshots into `/tmp/p2-dashboard-{before,after}.png`**.

- [ ] **Step 5: Take a final radar screenshot** for the PR description.

### Task P2.E: `/ship` PR-P2+P6

- [ ] **Step 1: Invoke `/ship`** (same flow as Task P1.G).

- [ ] **Step 2: PR opened — record URL**.

- [ ] **Step 3: Pause for user review + merge**.

- [ ] **Step 4: Cleanup**

```bash
git checkout main && git pull --ff-only && git fetch --prune
git worktree prune  # /batch leaves worktrees behind
```

---

## Final dashboard regression check

### Task FINAL: Confirm Δ Setup→Execution narrowed

- [ ] **Step 1: Run a fresh assessment with both lookback windows**

```bash
npm run assess -- --include-transcripts --insights-lookback 14 2>&1 | tail -3
npm run assess -- --include-transcripts --insights-lookback 30 2>&1 | tail -3
```

Record both Platform Setup / Execution scores.

- [ ] **Step 2: Compare to PR #46 baseline** (Platform Setup 90 / Execution 49 at 14d).

Expected:

- Platform Setup: same or +1–3 (a few new flag-based flips will lift Permissions/Memory).
- Execution: same or slightly higher; new probes mostly count Setup-side.
- Predicate coverage: ≥ 40 of the rubric's nextActions now have `satisfiedWhen` predicates that read non-zero signals.

- [ ] **Step 3: Final Chrome screenshot of the radar chart** for the spec's "Success criteria" #4 (stable Setup/Execution score within ±2 of pre-merge baseline).

---

## Self-Review

**Spec coverage check:** Map each requirement of the parent spec (`docs/superpowers/specs/2026-05-10-probe-closure-and-validation-design.md`):

- ✅ V1 (4 audits) — DONE in PR #46.
- ✅ P1 (8 slash-command probes) — covered by Task P1.B (5 via `/batch`) + Task P1.C (P1.6) + Task P1.D (P1.7).
- ✅ P2 (4 settings-flag probes) — covered by Task P2.B, gated on Task P2.A schema sampling.
- ✅ P6 (2 project-local probes) — covered alongside P2 in Task P2.B.
- ✅ Validation-Agent pattern (Schema-Sampling, Adversarial Code-Review, Probe-Logic Challenger) — Task P2.A invokes Schema-Sampling; `/batch` implementers each get a Code-Review subagent baked in via the standard subagent-driven-development flow; no Probe-Logic Challenger here because no V1-style audits remain.
- ✅ 3 sequential PRs — V1 (#46 done), P1 (Task P1.G), P2+P6 (Task P2.E).
- ✅ Chrome plugin validation — Tasks P1.F, P2.D, FINAL.
- ✅ `/batch` parallelism — Tasks P1.B, P2.B.
- ✅ `/ship` finalization — Tasks P1.G, P2.E.

**Placeholder scan:** No "TBD", "TODO", "implement later", "fill in details", or "Add appropriate error handling" patterns. Each step is a concrete action with exact paths or commands. Per-probe TDD code blocks for P1.1–P1.5 and P2.1–P2.4 / P6.1–P6.3 are not duplicated here — they're in `2026-05-10-probe-closure-and-validation.md` Tasks P1.1–P6.3 verbatim. **The orchestration plan deliberately defers to that plan for the inner red-green-refactor steps**; this plan covers what that plan does NOT — the `/batch` boundaries, the Chrome validation gates, and the `/ship` handoff.

**Type consistency:** Signal field names match the rubric predicates (e.g. `simplifyCommandUses` in both the implementation and the predicate). Predicate operator `=` for string comparison (P2.2 outputStyle), `>=N` for counts, bare-path-truthy for booleans — consistent with the existing predicate-grammar DSL in `app/lib/assessment.ts`.

**Idempotency:** Each PR is a feature branch; if a halt occurs mid-PR, re-invoking `/ship` resumes via per-stage idempotency detection (`@spokes/idempotency.md`). The `/batch` step is the only non-idempotent action — if it fails partway, finish manually with whichever subagent had a green commit, drop the rest, and re-invoke `/batch` for the remainders.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-probe-closure-p1-p2-p6-orchestration.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per orchestration task (the `/batch` step internally fans further, but the orchestration tasks themselves are sequential). Each task gets a spec-compliance + code-quality review.

2. **Inline Execution** — Execute the orchestration tasks in this session with checkpoints between PRs.

Either way: the inner per-probe TDD work happens inside `/batch` workers, not in the controlling agent. The controlling agent's job is to dispatch `/batch`, linearize commits, run Chrome validation, and invoke `/ship`.

**Which approach?**
