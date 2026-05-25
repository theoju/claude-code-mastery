# Probe Closure & Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift measurable-tip coverage from 28/87 (32%) → ~42/87 (48%) by auditing 4 suspicious existing probes and adding 14 new probes, with validation agents gating every change.

**Architecture:** Three sequential PRs. PR-V1 audits and fixes existing probes that look like false negatives. PR-P1 adds 5 easy slash-command probes (same pattern as `/rewind` shipped in PR #44). PR-P2+P6 adds 4 settings-flag probes and 2 project-local-config probes, with a Schema-Sampling Agent gating each one.

**Tech Stack:** Node.js (ES modules), Vitest for tests, existing helpers in `scripts/signals.mjs` and `scripts/_usage-data.mjs`. Validation agents dispatched via the Agent tool with subagent_types `Explore`, `general-purpose`, and `pr-review-toolkit:code-reviewer`.

**Spec:** `docs/superpowers/specs/2026-05-10-probe-closure-and-validation-design.md`

---

## File Structure

| File                                                     | Role                                                             | PR             |
| -------------------------------------------------------- | ---------------------------------------------------------------- | -------------- |
| `scripts/signals.mjs`                                    | Config-side readers (settings, agents, plugins, shell aliases)   | V1, P2, P6     |
| `scripts/_usage-data.mjs`                                | Transcript scanners (TARGET_COMMANDS, scanTranscriptInvocations) | V1, P1         |
| `scripts/run-assessment.mjs`                             | `buildSignalsSummary` flat-key forwarding                        | V1, P1, P2, P6 |
| `app/data/rubric.json`                                   | Predicates + dimension `borisTips` references                    | V1, P1, P2, P6 |
| `scripts/__tests__/scan-transcript-invocations.test.mjs` | Transcript-scanner unit tests                                    | V1, P1         |
| `scripts/__tests__/build-signals-summary.test.mjs`       | Aggregation tests + inline snapshot + expectedKeys               | All            |
| `scripts/__tests__/_fixtures.mjs`                        | Score-test fixture                                               | All            |
| `app/lib/__tests__/rubric-predicates.test.ts`            | `ALL_SATISFIED_SIGNALS` sweep                                    | All            |
| `package.json`                                           | Version bump 0.9.0 → 0.10.0 (after PR-V1+P1 land)                | end            |

Each PR follows the same lifecycle:

1. Branch off `main`.
2. Per task: failing test → implement → unit-test green → adversarial reviewer agent → commit.
3. After all tasks: full `npx vitest run` → real-env `npm run assess` smoke check → squash-merge → tag.

---

# PR-V1: Existing-probe audits

Four tasks, one per suspicious probe. Each task has a discovery phase (Probe-Logic Challenger agent) followed by a TDD fix phase.

**Branch:** `feat/probe-validation-v1`

## Task V1.1: Audit + fix `worktreeAliasCount` (tip 1)

**Files:**

- Modify: `scripts/signals.mjs` (the `gatherShellAliases` function)
- Modify: `scripts/__tests__/_fixtures.mjs` (if probe shape changes)
- Test: `scripts/__tests__/gather-shell-aliases.test.mjs` (create if missing; otherwise extend `signals.test.mjs`)

- [ ] **Step 1: Dispatch Probe-Logic Challenger**

Use the Agent tool with `subagent_type: "general-purpose"`. Prompt:

```
I have a probe that's reading worktreeAliasCount=0 in production, but the user
demonstrably uses git worktrees daily (multiple worktrees in this session alone).
The probe is in scripts/signals.mjs in the gatherShellAliases function.

Investigate:
1. Read the current gatherShellAliases implementation.
2. Check the user's actual ~/.zshrc, ~/.bashrc, and any other shell-config files
   for worktree-related aliases.
3. Determine why the probe reads 0 when worktrees ARE being used.
4. Propose a fix.

Report under 200 words: root cause + recommended fix + adversarial cases.
```

- [ ] **Step 2: Read the current probe**

Run: `grep -n "gatherShellAliases\|worktreeAliasCount" scripts/signals.mjs`
Expected: locate the function definition.

- [ ] **Step 3: Synthesize the agent's finding into a failing test**

Open `scripts/__tests__/gather-shell-aliases.test.mjs` (or create it). Add a test that uses the user's actual alias-format pattern as a fixture string. Example shape (the engineer adapts to whatever the agent reported):

```js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherShellAliases } from "../signals.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shell-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

it("counts worktree aliases declared in ~/.zshrc with single-quoted RHS", async () => {
  // Realistic alias shape the agent confirmed — replace with whatever the agent
  // observed in the user's actual .zshrc.
  writeFileSync(
    join(dir, ".zshrc"),
    `
alias za='cd ~/.worktrees/a && claude'
alias zb='cd ~/.worktrees/b && claude'
alias zc='cd ~/.worktrees/c && claude'
`,
  );
  const result = await gatherShellAliases({ home: dir });
  expect(result.worktreeAliasCount).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run scripts/__tests__/gather-shell-aliases.test.mjs -- --reporter verbose`
Expected: FAIL — current implementation doesn't detect the alias pattern.

- [ ] **Step 5: Implement the fix**

Update `gatherShellAliases` in `scripts/signals.mjs` based on the agent's recommended fix. Common fixes are likely to be:

- Broaden the regex to accept single-quoted RHS, double-quoted RHS, and unquoted RHS.
- Add `~/.bashrc` and `~/.config/fish/config.fish` as additional input files.
- Match alias names matching `/^[a-z][a-z0-9_-]{0,3}$/` and RHS containing `worktree` or `cd ~/.worktrees`.

The exact regex depends on the agent's findings. Replace the existing detection logic with the broadened version.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run scripts/__tests__/gather-shell-aliases.test.mjs`
Expected: PASS.

- [ ] **Step 7: Run the full suite to verify no regressions**

Run: `npx vitest run`
Expected: 410 → 411+ passing (one or more new tests added).

- [ ] **Step 8: Live-environment sanity check**

Run: `npm run assess -- --include-transcripts --insights-lookback 30 2>&1 | grep worktreeAliasCount; jq '.signalsSummary.worktreeAliasCount' app/data/assessment.json`
Expected: count ≥ 3 (real-env confirms the fix).

- [ ] **Step 9: Adversarial reviewer agent**

Use the Agent tool with `subagent_type: "pr-review-toolkit:code-reviewer"`. Prompt:

```
Review my fix to gatherShellAliases in scripts/signals.mjs (last commit on this
branch). I extended detection to handle [the cases the agent identified]. Propose
3 adversarial cases that should fail OR confirm my test covers them. Report
under 150 words.
```

If the reviewer flags missing coverage, add tests + fix accordingly. Re-dispatch until pass.

- [ ] **Step 10: Commit**

```bash
git add scripts/signals.mjs scripts/__tests__/gather-shell-aliases.test.mjs
git commit -m "$(cat <<'EOF'
fix(probe): broaden worktreeAliasCount detection (tip 1)

Probe was reading 0 in production despite active worktree usage. Root cause
identified by Probe-Logic Challenger agent: [insert summary]. Broadened
detection to [insert summary]. Adversarial reviewer confirmed coverage of
[insert N cases].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task V1.2: Audit + fix `hasVerifyAgent` (tip 14)

**Files:**

- Modify: `scripts/signals.mjs` (the `detectVerifyAgent` or equivalent function)
- Modify: `scripts/run-assessment.mjs` (if `buildSignalsSummary` needs updating)
- Test: `scripts/__tests__/detect-verify-agent.test.mjs` (create if missing)

- [ ] **Step 1: Dispatch Probe-Logic Challenger**

Use the Agent tool with `subagent_type: "general-purpose"`. Prompt:

```
The hasVerifyAgent probe reads false in my environment, but I use the /ship skill
which DOES include verification (verify-agent stage 2 runs the user's project
verify suite). The probe is in scripts/signals.mjs (detectVerifyAgent or similar)
and uses regex /^verify/i against agent filenames in ~/.claude/agents/.

Investigate:
1. Find the probe and read it.
2. Check ~/.claude/agents/ AND ~/.claude/skills/ for files that perform
   verification (not just files starting with "verify").
3. Determine if the regex should be broadened (e.g. match "ship", any file
   with "verify" anywhere in the name, or file CONTENT containing "verify").
4. Propose a fix.

Report under 200 words: root cause + recommended fix + adversarial cases.
```

- [ ] **Step 2: Read the current probe**

Run: `grep -n "hasVerifyAgent\|detectVerifyAgent" scripts/signals.mjs scripts/run-assessment.mjs`
Expected: locate the regex and forwarding.

- [ ] **Step 3: Write the failing test**

Add a test in `scripts/__tests__/detect-verify-agent.test.mjs` that exercises the broadened detection. Example shape (engineer adapts to agent's findings):

```js
import { describe, it, expect } from "vitest";
import { detectVerifyAgent } from "../signals.mjs";

it("counts ship.md as a verify agent (it runs verify-agent stage 2)", () => {
  const personalAgents = [];
  const personalSkills = ["ship", "self-assessment"];
  const result = detectVerifyAgent({ personalAgents, personalSkills });
  expect(result).toBe(true);
});

it("counts pr-review-toolkit's code-reviewer as verifying", () => {
  const personalAgents = [];
  const plugins = ["pr-review-toolkit"];
  const result = detectVerifyAgent({ personalAgents, plugins });
  expect(result).toBe(true);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/detect-verify-agent.test.mjs`
Expected: FAIL — current narrow regex doesn't match.

- [ ] **Step 5: Implement the fix**

Broaden the detector. Most likely shape:

```js
export function detectVerifyAgent({
  personalAgents = [],
  personalSkills = [],
  plugins = [],
}) {
  const VERIFY_TOKENS = /(verify|ship|review|check)/i;
  if (personalAgents.some((f) => VERIFY_TOKENS.test(f))) return true;
  if (personalSkills.some((s) => VERIFY_TOKENS.test(s))) return true;
  if (plugins.some((p) => /(pr-review-toolkit|code-reviewer)/i.test(p)))
    return true;
  return false;
}
```

Adapt to agent findings. Update the call site in the gatherer accordingly.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/detect-verify-agent.test.mjs`
Expected: PASS.

- [ ] **Step 7: Adversarial reviewer agent**

Same template as Task V1.1 step 9. Verify the reviewer accepts. Address any gaps.

- [ ] **Step 8: Commit**

```bash
git add scripts/signals.mjs scripts/__tests__/detect-verify-agent.test.mjs
git commit -m "fix(probe): broaden hasVerifyAgent to count ship/review skills + plugins (tip 14)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task V1.3: Audit + fix `hasIsolatedAgent` (tip 28)

**Files:**

- Modify: `scripts/signals.mjs` (find where `hasIsolatedAgent` flag is set)
- Test: `scripts/__tests__/detect-isolated-agent.test.mjs` (create if missing)

- [ ] **Step 1: Dispatch Probe-Logic Challenger**

Same prompt template as V1.1, but for `hasIsolatedAgent`. Add: "I run agents in worktrees daily but the flag reads false. Find where the flag is set and what it actually checks."

- [ ] **Step 2: Read the current probe**

Run: `grep -rn "hasIsolatedAgent" scripts/`
Expected: locate the gather logic AND the buildSignalsSummary forward.

- [ ] **Step 3: Write the failing test**

Most-likely shape — probe needs to scan agent file CONTENT for `isolation: worktree`:

```js
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectIsolatedAgent } from "../signals.mjs";

it("returns true when an agent file contains 'isolation: worktree'", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agents-"));
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(
    join(dir, "agents", "my-agent.md"),
    `---
name: my-agent
isolation: worktree
---
Body
`,
  );
  const result = await detectIsolatedAgent({ agentsDir: join(dir, "agents") });
  expect(result).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/detect-isolated-agent.test.mjs`
Expected: FAIL.

- [ ] **Step 5: Implement the fix**

Add (or modify) `detectIsolatedAgent` to read each agent file's frontmatter and look for `isolation: worktree`. Wire it into the gatherer so `signals.settings.hasIsolatedAgent` reflects it.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/detect-isolated-agent.test.mjs`
Expected: PASS.

- [ ] **Step 7: Adversarial reviewer**

Same template. Cover edge cases: agent file with no frontmatter, frontmatter with `isolation: shared`, malformed YAML, missing file.

- [ ] **Step 8: Commit**

```bash
git add scripts/signals.mjs scripts/__tests__/detect-isolated-agent.test.mjs
git commit -m "fix(probe): scan agent frontmatter for isolation:worktree (tip 28)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task V1.4: Audit + relax `babysitLoopUses` (tip 31)

**Files:**

- Modify: `scripts/_usage-data.mjs` (the `babysitLoopUses` increment logic in `scanTranscriptInvocations`)
- Modify: `app/data/rubric.json` (split into two predicates if needed)
- Test: `scripts/__tests__/scan-transcript-invocations.test.mjs`

- [ ] **Step 1: Dispatch Probe-Logic Challenger**

Prompt:

```
The babysitLoopUses probe in scripts/_usage-data.mjs requires BOTH /loop AND
/babysit in the same session. It reads 0 even though I do use /loop.

Investigate:
1. Read the current logic at the bottom of the per-session loop in
   scanTranscriptInvocations.
2. Check whether real /loop usage in transcripts is typically paired with
   explicit /babysit, or whether /loop alone is the dominant pattern.
3. Recommend: relax to /loop alone? Split into two counters? Keep strict?

Report under 200 words.
```

- [ ] **Step 2: Read the current logic**

Run: `grep -n "sessionHasLoop\|sessionHasBabysit\|babysitLoopUses" scripts/_usage-data.mjs`
Expected: locate the per-session decision at the end of the file scanning.

- [ ] **Step 3: Write the failing test**

```js
it("counts /loop sessions even without /babysit (relaxed semantics)", async () => {
  writeSession("s1", [userText("/loop 30m run the tests")]);
  const r = await scanTranscriptInvocations({
    projectsRoot,
    now: new Date("2026-05-10T00:00:00Z"),
    lookbackDays: 30,
  });
  expect(r.loopCommandUses).toBe(1);
  expect(r.babysitLoopUses).toBe(0); // strict pairing remains 0
});
```

Add `loopCommandUses` as a new explicit counter alongside the existing `babysitLoopUses`.

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/scan-transcript-invocations.test.mjs`
Expected: FAIL — `loopCommandUses` is undefined on the result.

- [ ] **Step 5: Implement the fix**

In `scripts/_usage-data.mjs`:

1. Add `loopCommandUses: 0` to the `counts` object.
2. Increment `counts.loopCommandUses` whenever a session has `sessionHasLoop` (regardless of `sessionHasBabysit`).
3. Keep `babysitLoopUses` as the strict pairing counter — both metrics surface, and the rubric can predicate on whichever is appropriate.

- [ ] **Step 6: Run tests to verify**

Run: `npx vitest run scripts/__tests__/scan-transcript-invocations.test.mjs`
Expected: PASS.

- [ ] **Step 7: Wire the new signal through**

Add `loopCommandUses` to:

- `scripts/run-assessment.mjs` `buildSignalsSummary`.
- `scripts/__tests__/build-signals-summary.test.mjs` `expectedKeys` and inline snapshot.
- `scripts/__tests__/_fixtures.mjs` `makeSignals` defaults.
- `app/lib/__tests__/rubric-predicates.test.ts` `ALL_SATISFIED_SIGNALS`.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Update rubric**

Add a new next-action under `dimensions[scheduled].nextActions` (or update the existing one) that predicates on `loopCommandUses>=1` instead of `babysitLoopUses>=1`. Keep `babysitLoopUses` for an "advanced cadence" action.

- [ ] **Step 9: Adversarial reviewer**

Same template. Verify the reviewer doesn't object to the dual-counter design.

- [ ] **Step 10: Commit**

```bash
git add scripts/_usage-data.mjs scripts/run-assessment.mjs scripts/__tests__/ app/lib/__tests__/rubric-predicates.test.ts app/data/rubric.json
git commit -m "fix(probe): split loopCommandUses from strict babysitLoopUses pairing (tip 31)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## V1 PR finalization

- [ ] **Step V1.PR.1: Run full suite**

Run: `npx vitest run`
Expected: 410+N passing, 0 failed.

- [ ] **Step V1.PR.2: Live smoke check**

Run: `npm run assess -- --include-transcripts --insights-lookback 30`
Expected: at least 2 of the 4 V1 probes flip Missed→Passed; nothing regresses.

- [ ] **Step V1.PR.3: Open PR**

```bash
git push -u origin feat/probe-validation-v1
gh pr create --base main --title "fix(self-assessment): audit + fix 4 false-negative probes (V1)" --body "$(cat <<'EOF'
## Summary
- Tip 1 worktreeAliasCount — broadened detection scope.
- Tip 14 hasVerifyAgent — broadened to count ship/review skills + plugins.
- Tip 28 hasIsolatedAgent — scans agent frontmatter for isolation:worktree.
- Tip 31 babysitLoopUses — split off loopCommandUses for non-strict /loop usage.

Each fix went through Probe-Logic Challenger + Adversarial code-reviewer agents.

## Test plan
- [x] Full vitest suite green
- [x] Live `npm run assess` confirms 2+ probes flip Missed→Passed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step V1.PR.4: Squash-merge**

After CI green: `gh pr merge <num> --squash --delete-branch`. Then `git checkout main && git pull --ff-only`.

---

# PR-P1: Slash-command extensions

Five tasks, one per slash command (or pair). Same pattern as `/rewind` shipped in PR #44.

**Branch:** `feat/probe-p1-slash-commands` (cut from `main` after PR-V1 lands).

## Task P1.1: Add `/simplify` (tip 29)

**Files:**

- Modify: `scripts/_usage-data.mjs`
- Modify: `scripts/run-assessment.mjs`
- Modify: `scripts/__tests__/scan-transcript-invocations.test.mjs`
- Modify: `scripts/__tests__/build-signals-summary.test.mjs`
- Modify: `scripts/__tests__/_fixtures.mjs`
- Modify: `app/lib/__tests__/rubric-predicates.test.ts`
- Modify: `app/data/rubric.json`

- [ ] **Step 1: Write failing test**

In `scripts/__tests__/scan-transcript-invocations.test.mjs`:

```js
it("counts /simplify invocations (markup + start-of-line)", async () => {
  writeSession("s1", [
    userMarkup("/simplify"),
    userText("/simplify the validation logic"),
    userText("we should /simplify this"), // mid-sentence — does NOT count
  ]);
  const r = await scanTranscriptInvocations({
    projectsRoot,
    now: new Date("2026-05-10T00:00:00Z"),
    lookbackDays: 30,
  });
  expect(r.simplifyCommandUses).toBe(2);
});
```

Also extend the "returns zeros when projectsRoot is empty" test to include `simplifyCommandUses: 0`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/scan-transcript-invocations.test.mjs`
Expected: FAIL — `simplifyCommandUses` is undefined.

- [ ] **Step 3: Implement**

In `scripts/_usage-data.mjs`:

1. Add `"simplify"` to the `TARGET_COMMANDS` Set.
2. Add `simplify: /^\/simplify(?![\w-])/` to the `SLASH_RE` map.
3. Add `simplifyCommandUses: 0` to the `counts` object in `scanTranscriptInvocations`.
4. Add `if (found.has("simplify")) counts.simplifyCommandUses++;` to the per-message branch.

- [ ] **Step 4: Run tests to verify**

Run: `npx vitest run scripts/__tests__/scan-transcript-invocations.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire through `buildSignalsSummary`**

In `scripts/run-assessment.mjs#buildSignalsSummary`, add:

```js
simplifyCommandUses: signals.transcriptInvocations?.simplifyCommandUses ?? 0,
```

- [ ] **Step 6: Update test fixtures**

In `scripts/__tests__/build-signals-summary.test.mjs`:

- Add `simplifyCommandUses: 4` to the `transcriptInvocations` fixture.
- Add `"simplifyCommandUses"` to the `expectedKeys` array.
- Add `"simplifyCommandUses"` to the inline-snapshot sorted keys list (alphabetical position).
- Add an assertion `expect(r.simplifyCommandUses).toBe(4);` to the "forwards transcript invocation counts" test.

In `scripts/__tests__/_fixtures.mjs`:

- Add `simplifyCommandUses: 0` to the `makeSignals` base.

In `app/lib/__tests__/rubric-predicates.test.ts`:

- Add `simplifyCommandUses: 1` to `ALL_SATISFIED_SIGNALS`.

- [ ] **Step 7: Add rubric next-action + predicate**

In `app/data/rubric.json` under `dimensions.automation.nextActions` (or wherever fits — confirm via dimension lookup):

```json
{
  "id": "simplify-after-changes",
  "action": "Append /simplify to your prompt after non-trivial changes — Boris tip 29",
  "effort": "5min",
  "satisfiedWhen": "simplifyCommandUses>=1"
}
```

- [ ] **Step 8: Run full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9: Adversarial reviewer agent**

Use `pr-review-toolkit:code-reviewer`. Verify the predicate-vs-action wording fits, and that the test covers markup form, start-of-line form, mid-sentence rejection, and the URL/path negative-lookbehind.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(probe): /simplify usage detection (tip 29)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Task P1.2: Add `/btw` (tips 33 + 54)

**Files:** same as P1.1.

Repeat the P1.1 pattern with `btw` in place of `simplify`. Notes:

- The `/btw` predicate covers tips 33 AND 54 (the deep-dive). One predicate, one signal — wire to whichever next-action exists, or add a new one under `dimensions.parallel` (since /btw is about side-chain conversations during parallel work).

- [ ] **Step 1: Write failing test** (same shape as P1.1, with `btw`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Add `"btw"` to `TARGET_COMMANDS`, `SLASH_RE.btw`, counter.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Wire `btwCommandUses` through `buildSignalsSummary`.**
- [ ] **Step 6: Update fixtures + ALL_SATISFIED_SIGNALS + expectedKeys + inline snapshot.**
- [ ] **Step 7: Add rubric action + predicate `btwCommandUses>=1`.**
- [ ] **Step 8: Full suite, expect green.**
- [ ] **Step 9: Adversarial reviewer.**
- [ ] **Step 10: Commit:** `feat(probe): /btw usage detection (tips 33, 54)`.

## Task P1.3: Add `/voice` (tip 60)

Same shape as P1.1. Signal name `voiceCommandUses`. Predicate `voiceCommandUses>=1` under `dimensions.customization` (or wherever Boris tip 60 lives in the rubric — confirm the `borisTips` field of each dimension).

- [ ] **Steps 1-10:** identical pattern to P1.2 with `voice` in place of `btw`.

## Task P1.4: Add `/clear` and `/compact` (tip 63)

This task adds **two** commands at once because tip 63 is "/compact vs /clear" — a paired-decision habit.

- [ ] **Step 1: Write failing test**

```js
it("counts /clear and /compact independently", async () => {
  writeSession("s1", [
    userMarkup("/clear"),
    userText("/compact"),
    userMarkup("/clear"),
  ]);
  const r = await scanTranscriptInvocations({
    projectsRoot,
    now: new Date("2026-05-10T00:00:00Z"),
    lookbackDays: 30,
  });
  expect(r.clearCommandUses).toBe(2);
  expect(r.compactCommandUses).toBe(1);
});
```

- [ ] **Step 2-10:** Same as P1.1 but adding both `clear` and `compact` simultaneously. The rubric predicate is `clearCommandUses>=1 & compactCommandUses>=1` (the user demonstrates _both_ habits — informed memory hygiene).

## Task P1.5: Add `/fewer-permission-prompts` (tip 69)

The slash command name has hyphens. Test that the regex handles them.

- [ ] **Step 1: Write failing test**

```js
it("counts /fewer-permission-prompts (hyphenated slash command)", async () => {
  writeSession("s1", [
    userMarkup("/fewer-permission-prompts"),
    userText("/fewer-permission-prompts"),
  ]);
  const r = await scanTranscriptInvocations({
    projectsRoot,
    now: new Date("2026-05-10T00:00:00Z"),
    lookbackDays: 30,
  });
  expect(r.fewerPermsCommandUses).toBe(2);
});
```

- [ ] **Steps 2-10:** Same as P1.1. Note: the existing `SLASH_RE` regex uses `(?![\w-])` as the negative lookahead, which correctly rejects further word chars OR hyphens — for this command, the FULL name including hyphens must be in the regex. The signal name is `fewerPermsCommandUses` (camelCase abbreviated for sanity).

## P1 PR finalization

- [ ] **Step P1.PR.1: Full suite + smoke check + open PR + merge.** Same shape as V1.PR.

---

# PR-P2 + P6: Settings flags + project-local configs

Six tasks. Each P2 task starts with a Schema-Sampling Agent dispatch to confirm the field exists before coding the probe.

**Branch:** `feat/probe-p2-p6-config-readers` (cut from `main` after PR-P1 lands).

## Task P2.0: Schema-sample `~/.claude/settings.json`

**Files:** none modified yet — this is reconnaissance.

- [ ] **Step 1: Dispatch Schema-Sampling Agent**

Use the Agent tool with `subagent_type: "Explore"`. Prompt:

```
Sample ~/.claude/settings.json. Report whether each of these top-level fields
exists, and if so its value type and observed value:
1. sandboxing (or sandbox, or anything sandbox-related)
2. outputStyle (or output_style)
3. autoDream (or auto_dream, or anything dream-related)
4. hooks.PostCompact (or any PostCompact entry under hooks)

For each: respond with field-name + value-or-absent + recommendation:
"build the probe" / "field absent, accept-as-coaching" / "field exists but
unreliable, accept-as-coaching with note".

Report under 150 words.
```

- [ ] **Step 2: Capture findings to a scratch file**

Write the agent's report to `/tmp/p2-schema-findings.txt`. Each subsequent P2 task gates on this report.

- [ ] **Step 3: Decide per-tip path**

For each of 21, 26, 41, 45: if the agent says "build", proceed to the corresponding task below. If "accept-as-coaching", append a row to `docs/superpowers/specs/2026-05-09-bucket-c-decision.md` and skip the task.

## Task P2.1: Add sandboxing probe (tip 21) — IF confirmed

**Files:**

- Modify: `scripts/signals.mjs`
- Modify: `scripts/run-assessment.mjs`
- Modify: `scripts/__tests__/build-signals-summary.test.mjs`, `_fixtures.mjs`, `rubric-predicates.test.ts`
- Modify: `app/data/rubric.json`

- [ ] **Step 1: Write failing test**

```js
import { detectSandboxing } from "../signals.mjs";

it("detects sandboxing enabled in settings.json", () => {
  expect(detectSandboxing({ sandboxing: { enabled: true } })).toBe(true);
  expect(detectSandboxing({})).toBe(false);
  expect(detectSandboxing({ sandboxing: { enabled: false } })).toBe(false);
});
```

(Adapt the field shape to match the agent's findings.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```js
export function detectSandboxing(settings) {
  return settings?.sandboxing?.enabled === true;
}
```

Wire into the gatherer so `signals.settings.hasSandboxing` is set.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Wire through `buildSignalsSummary` as `hasSandboxing: !!signals.settings.hasSandboxing`.**

- [ ] **Step 6: Update fixtures + tests + rubric next-action `satisfiedWhen: "hasSandboxing"`.**

- [ ] **Step 7: Adversarial reviewer.**

- [ ] **Step 8: Commit:** `feat(probe): hasSandboxing detection (tip 21)`.

## Task P2.2: Add output-style probe (tip 26) — IF confirmed

Same pattern as P2.1, with `outputStyle` field. Signal name `hasOutputStyle` or `outputStyle` (match the field shape; if it's an enum value like `"explanatory"` rather than a boolean, prefer `outputStyle: <value>` and predicate as `outputStyle=explanatory|verbose|...`).

## Task P2.3: Add PostCompact hook probe (tip 41)

**This one likely doesn't need a schema sample** — the existing `hookEvents` array already captures hook event names. Just check `hookEvents.includes("PostCompact")`.

- [ ] **Step 1: Write failing test**

```js
it("hasPostCompactHook reflects hookEvents membership", () => {
  const r1 = buildSignalsSummary(
    makeSignals({
      settings: { ...makeSignals().settings, hookEvents: ["PostCompact"] },
    }),
  );
  expect(r1.hasPostCompactHook).toBe(true);
  const r2 = buildSignalsSummary(makeSignals());
  expect(r2.hasPostCompactHook).toBe(false);
});
```

- [ ] **Step 2-8:** Add `hasPostCompactHook: hookEvents.includes("PostCompact")` to `buildSignalsSummary`. Update fixtures + rubric predicate.

## Task P2.4: Add auto-dream probe (tip 45) — IF confirmed

Same pattern as P2.1. **Likely deferred per Bucket C analysis** — the agent's recon will probably report no field exists. If so, append "auto-dream remains accept-as-coaching" to `docs/superpowers/specs/2026-05-09-bucket-c-decision.md` and skip.

## Task P6.1: Add code-review plugin detection (tip 32)

**Files:** same template as P2.1.

- [ ] **Step 1: Write failing test**

```js
import { buildSignalsSummary } from "../run-assessment.mjs";

it("hasPrReviewToolkit detects pr-review-toolkit plugin", () => {
  const r = buildSignalsSummary(
    makeSignals({ plugins: ["pr-review-toolkit", "other"] }),
  );
  expect(r.hasPrReviewToolkit).toBe(true);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** in `buildSignalsSummary`:

```js
hasPrReviewToolkit: signals.plugins.some((p) => /pr-review-toolkit/i.test(p)),
```

- [ ] **Step 4-8:** Update fixtures + rubric next-action `satisfiedWhen: "hasPrReviewToolkit"`. Commit.

## Task P6.2: Schema-sample `projects/*/settings.local.json` for color

- [ ] **Step 1: Dispatch Schema-Sampling Agent**

Use `subagent_type: "Explore"`. Prompt:

```
Sample ~/.claude/projects/*/settings.local.json across at least 5 projects.
Report whether any of them contains a "color" or "colorScheme" field at the
top level. If so, report the value and recommendation: build the probe / defer.

Report under 100 words.
```

- [ ] **Step 2: Capture findings.** If "build", proceed to P6.3. If "defer", append to Bucket C spec and skip.

## Task P6.3: Add per-worktree `/color` probe (tip 40) — IF confirmed

If the schema-sampling agent confirms a color field exists:

- [ ] **Step 1: Write failing test**

```js
import { detectColorPerWorktree } from "../signals.mjs";

it("counts projects with a per-worktree color set", () => {
  const projectsConfig = [
    { project: "a", settings: { color: "blue" } },
    { project: "b", settings: {} },
    { project: "c", settings: { color: "green" } },
  ];
  const result = detectColorPerWorktree(projectsConfig);
  expect(result).toBe(2);
});
```

- [ ] **Steps 2-8:** Implement `detectColorPerWorktree` aggregator. Wire into the gatherer. Add `colorPerWorktreeCount` to `buildSignalsSummary`. Update fixtures + ALL_SATISFIED_SIGNALS. Add rubric predicate `colorPerWorktreeCount>=1`. Commit.

## P2+P6 PR finalization

- [ ] **Step P2.PR.1: Full suite + smoke check + open PR + merge.**

---

# Post-merge: tag + release notes

After all 3 PRs land:

- [ ] **Step Final.1: Bump version**

```bash
sed -i.bak 's/"version": "0.9.0"/"version": "0.10.0"/' package.json && rm package.json.bak
```

- [ ] **Step Final.2: Tag and push**

```bash
git checkout main && git pull --ff-only
git tag v0.10.0
git push origin v0.10.0
```

- [ ] **Step Final.3: Create GitHub release**

```bash
gh release create v0.10.0 --title "v0.10.0 — Probe closure & validation" --notes "..."
```

- [ ] **Step Final.4: Re-generate the v3 classification doc**

```bash
node /tmp/build-v2.mjs
```

The doc at `docs/tip-classification-2026-05-10.md` should now show 14 fewer "No probe yet" rows and ~14 more "Passed" or "Missed" rows. Optionally commit the regenerated doc.

---

## Self-Review

**1. Spec coverage** — every section of the design spec maps to a task:

- V1 (4 tips) → 4 tasks (V1.1–V1.4) ✓
- P1 (5 grouped commands) → 5 tasks (P1.1–P1.5) ✓
- P2 (4 settings flags + 1 schema-sample) → 5 tasks (P2.0–P2.4) ✓
- P6 (2 project-local) → 2 tasks (P6.1, P6.2 + P6.3) ✓
- Validation-agent pattern (3 agents) — used in V1.1 (Probe-Logic Challenger), P2.0 + P6.2 (Schema-Sampling), and at the end of every implementation task (Adversarial Reviewer) ✓
- Test strategy — TDD-first in every task; fixtures + ALL_SATISFIED_SIGNALS + inline snapshot updates called out explicitly ✓
- Risks — V1 tasks accept rubric-fix as alternative resolution; P2 tasks gate on schema-sampling agent ✓
- Delivery shape — 3 sequential PRs with explicit branch names + finalization steps ✓

**2. Placeholder scan** — V1 tasks include "depends on the agent's findings" branches, but each step still provides concrete starting code that the engineer adapts. No bare "TBD" / "TODO" / "implement later". P1 tasks have full code blocks. P2/P6 tasks have IF-branches gated on the Schema-Sampling Agent's output, with explicit "skip and append to Bucket C" alternative.

**3. Type consistency** — All new signal names follow the camelCase convention: `simplifyCommandUses`, `btwCommandUses`, `voiceCommandUses`, `clearCommandUses`, `compactCommandUses`, `fewerPermsCommandUses`, `loopCommandUses`, `hasSandboxing`, `outputStyle` (or `hasOutputStyle`), `hasPostCompactHook`, `hasPrReviewToolkit`, `colorPerWorktreeCount`. The fork-events signal (originally Tip 53 in P1) was deferred since detection mechanism is non-obvious; will be revisited in a future brainstorm.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-probe-closure-and-validation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration. Best fit because each task has natural agent-dispatch points already (Probe-Logic Challenger for V1, Schema-Sampling for P2/P6, Adversarial Reviewer for all).

2. **Inline Execution** — execute tasks in this session using executing-plans. Simpler but holds a long context.

Which approach?
