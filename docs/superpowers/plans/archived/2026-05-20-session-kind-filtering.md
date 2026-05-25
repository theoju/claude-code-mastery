# Session-Kind Filtering for Execution Posture Scorers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop diluting Execution posture ratios (auto-mode, plan-mode, learning-mode, etc.) with SDK-spawned and observer sessions that mathematically cannot reflect user posture choices.

**Architecture:** Introduce a first-class `session_kind` taxonomy (`interactive_cli`, `sdk_orchestrated`, `subagent`, `observer`, `unknown`) computed once per assessment run from the transcript header. Insights signals emits `sessionsByKind` and a separate `interactiveSessionsAnalyzed` denominator. Posture scorers in `score.mjs` declare their universe via a new `withGates({ universe: "interactive_only" })` option. Volume scorers stay broad. The Probes page surfaces the breakdown so future drift is visible. A new CLAUDE.md hard rule prevents this regression class.

**Tech Stack:** Node.js ESM (`scripts/*.mjs`), Vitest, Next.js App Router (`app/*.tsx`), TypeScript for app layer.

**Jira:** CCE (Claude-Code-Extensions). New ticket to create at start of /ship: `CCE-N: Session-kind filtering for posture scorers`.

---

## File Structure

**Modify:**

- `scripts/_usage-data.mjs` — add `classifySessionKind()`, expose it; no signature change to `loadSessionMeta`
- `scripts/insights-signals.mjs` — classify in-window sessions; emit `sessionsByKind` and `interactiveSessionsAnalyzed`; restrict posture counts to interactive subset
- `scripts/score.mjs` — extend `withGates` with `universe`; route posture scorers to `interactiveSessionsAnalyzed`
- `scripts/__tests__/_fixtures.mjs` — extend `makeInsights` with new fields
- `scripts/__tests__/_usage-data.test.mjs` — classifier unit tests
- `scripts/__tests__/insights-signals.test.mjs` — kind-aware denominator tests
- `scripts/__tests__/score.test.mjs` — regression: SDK session does not dilute permissions score
- `app/methodology/probes/page.tsx` — session-kind census card
- `app/methodology/page.tsx` — per-dimension universe annotation
- `app/page.tsx` — cross-axis sanity hint (Setup says auto-on, Execution measures < 50)
- `app/lib/assessment.ts` — TypeScript shape additions
- `app/data/probe-catalog.json` — entry for the new session-kind probe
- `CLAUDE.md` — new hard rule about denominator semantics

**Create:**

- None (additive within existing files)

---

## Task 1: Failing test — `classifySessionKind` for subagent transcripts

**Files:**

- Test: `scripts/__tests__/_usage-data.test.mjs`

The subagent classification is purely path-based (subagent transcripts live under `<session-uuid>/subagents/agent-*.jsonl`), so it's the simplest case and a good starting wedge.

- [ ] **Step 1: Open the test file and append a new describe block at the end**

Append to `scripts/__tests__/_usage-data.test.mjs`:

```js
describe("classifySessionKind", () => {
  it("classifies a transcript under .../subagents/agent-*.jsonl as subagent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kind-"));
    const subDir = join(dir, "abc-session", "subagents");
    await mkdir(subDir, { recursive: true });
    const path = join(subDir, "agent-deadbeef.jsonl");
    await writeFile(path, "");
    expect(await classifySessionKind(path)).toBe("subagent");
  });
});
```

Also add to the import block at the top of the file:

```js
import { classifySessionKind } from "../_usage-data.mjs";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/_usage-data.test.mjs -t "classifySessionKind"`
Expected: FAIL with `classifySessionKind is not a function` (or similar export error).

- [ ] **Step 3: Implement `classifySessionKind` (path-only branch)**

Append to `scripts/_usage-data.mjs`, after the `scanTranscriptModes` export:

```js
// Classify a session by transcript-file inspection. Cheap: only reads the
// first ~5 lines until a recognized signal is found. Returns one of:
//   "interactive_cli"  — real user session (cli or claude-desktop entrypoint)
//   "sdk_orchestrated" — programmatic SDK invocation
//   "observer"         — claude-mem background observer (sdk-cli + observer dir)
//   "subagent"         — Agent-tool subagent transcript (path-keyed)
//   "unknown"          — no decisive signal in scanned header
//
// Posture scorers (permissions, plan, learning) must restrict their universe
// to "interactive_cli" — SDK/observer/subagent sessions don't honor user-level
// settings and would silently dilute the ratio.
export async function classifySessionKind(path) {
  if (path.includes("/subagents/agent-")) return "subagent";
  return "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/_usage-data.test.mjs -t "classifySessionKind"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/_usage-data.mjs scripts/__tests__/_usage-data.test.mjs
git commit -m "feat(usage-data): add classifySessionKind with subagent path detection — CCE-N"
```

---

## Task 2: Extend classifier for `observer`, `sdk_orchestrated`, `interactive_cli`

**Files:**

- Test: `scripts/__tests__/_usage-data.test.mjs`
- Modify: `scripts/_usage-data.mjs`

- [ ] **Step 1: Add four failing tests**

Append inside the `describe("classifySessionKind", …)` block:

```js
it("classifies a transcript with entrypoint=cli as interactive_cli", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kind-"));
  const path = join(dir, "session.jsonl");
  await writeFile(
    path,
    JSON.stringify({ type: "user", entrypoint: "cli", userType: "external" }) +
      "\n",
  );
  expect(await classifySessionKind(path)).toBe("interactive_cli");
});

it("classifies entrypoint=claude-desktop as interactive_cli", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kind-"));
  const path = join(dir, "session.jsonl");
  await writeFile(
    path,
    JSON.stringify({ type: "user", entrypoint: "claude-desktop" }) + "\n",
  );
  expect(await classifySessionKind(path)).toBe("interactive_cli");
});

it("classifies entrypoint=sdk-cli in observer-sessions dir as observer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kind-"));
  const projectDir = join(dir, "-Users-theo--claude-mem-observer-sessions");
  await mkdir(projectDir, { recursive: true });
  const path = join(projectDir, "session.jsonl");
  await writeFile(
    path,
    JSON.stringify({ type: "user", entrypoint: "sdk-cli" }) + "\n",
  );
  expect(await classifySessionKind(path)).toBe("observer");
});

it("classifies entrypoint=sdk-cli outside observer dir as sdk_orchestrated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kind-"));
  const projectDir = join(dir, "-Users-theo-Projects-engineering-docs-agent");
  await mkdir(projectDir, { recursive: true });
  const path = join(projectDir, "session.jsonl");
  await writeFile(
    path,
    JSON.stringify({ type: "user", entrypoint: "sdk-cli" }) + "\n",
  );
  expect(await classifySessionKind(path)).toBe("sdk_orchestrated");
});

it("returns 'unknown' when no entrypoint is found within first 5 lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kind-"));
  const path = join(dir, "session.jsonl");
  await writeFile(
    path,
    Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ type: "noise", n: i }),
    ).join("\n") + "\n",
  );
  expect(await classifySessionKind(path)).toBe("unknown");
});

it("returns 'unknown' for an empty file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kind-"));
  const path = join(dir, "session.jsonl");
  await writeFile(path, "");
  expect(await classifySessionKind(path)).toBe("unknown");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/__tests__/_usage-data.test.mjs -t "classifySessionKind"`
Expected: FAIL — all five new tests fail with classifier returning "unknown".

- [ ] **Step 3: Implement the full classifier**

Replace the body of `classifySessionKind` in `scripts/_usage-data.mjs`:

```js
export async function classifySessionKind(path) {
  if (path.includes("/subagents/agent-")) return "subagent";

  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
  });
  let scanned = 0;
  try {
    for await (const raw of rl) {
      if (++scanned > 5) break;
      if (!raw) continue;
      let entry;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      const ep = entry.entrypoint;
      if (typeof ep !== "string") continue;
      if (ep === "cli" || ep === "claude-desktop") return "interactive_cli";
      if (ep === "sdk-cli") {
        return path.includes("observer-sessions")
          ? "observer"
          : "sdk_orchestrated";
      }
    }
  } finally {
    rl.close();
  }
  return "unknown";
}
```

- [ ] **Step 4: Run all `_usage-data` tests to verify**

Run: `npx vitest run scripts/__tests__/_usage-data.test.mjs`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/_usage-data.mjs scripts/__tests__/_usage-data.test.mjs
git commit -m "feat(usage-data): classify interactive_cli, sdk_orchestrated, observer kinds"
```

---

## Task 3: Extend `makeInsights` fixture with kind fields

**Files:**

- Modify: `scripts/__tests__/_fixtures.mjs`

These fields cascade into NaN scores when missing (per CLAUDE.md fixture rule). Add them defensively before any scorer-side change.

- [ ] **Step 1: Add fields to the `makeInsights` base object**

In `scripts/__tests__/_fixtures.mjs`, edit the `base` object inside `makeInsights` (lines ~99-123) to add three fields after `sessionsAnalyzed: 100,`:

```js
sessionsAnalyzed: 100,
interactiveSessionsAnalyzed: 100,
sessionsByKind: {
  interactive_cli: 100,
  sdk_orchestrated: 0,
  observer: 0,
  subagent: 0,
  unknown: 0,
},
```

- [ ] **Step 2: Run the existing test suite to confirm no regressions**

Run: `npx vitest run`
Expected: All 494 tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/_fixtures.mjs
git commit -m "test(fixtures): seed interactiveSessionsAnalyzed and sessionsByKind"
```

---

## Task 4: Failing test — insights-signals emits `sessionsByKind`

**Files:**

- Test: `scripts/__tests__/insights-signals.test.mjs`

- [ ] **Step 1: Add a new test inside `describe("gatherInsightsSignals", …)`**

Append:

```js
it("classifies in-window sessions by kind and emits sessionsByKind", async () => {
  const claudeHome = await makeUsageDataFixture({
    sessions: [
      {
        id: "s-int-1",
        start_time: nowMinus(1),
        transcript: [
          { type: "user", entrypoint: "cli", permissionMode: "auto" },
        ],
      },
      {
        id: "s-sdk-1",
        projectDir: "-Users-x-Projects-routine",
        start_time: nowMinus(1),
        transcript: [
          { type: "user", entrypoint: "sdk-cli", permissionMode: "default" },
        ],
      },
      {
        id: "s-obs-1",
        projectDir: "-Users-x--claude-mem-observer-sessions",
        start_time: nowMinus(1),
        transcript: [
          { type: "user", entrypoint: "sdk-cli", permissionMode: "default" },
        ],
      },
    ],
  });
  const r = await gatherInsightsSignals({
    claudeHome,
    lookbackDays: 14,
    now: NOW_ISO,
    includeTranscripts: true,
  });
  expect(r.sessionsAnalyzed).toBe(3);
  expect(r.interactiveSessionsAnalyzed).toBe(1);
  expect(r.sessionsByKind).toEqual({
    interactive_cli: 1,
    sdk_orchestrated: 1,
    observer: 1,
    subagent: 0,
    unknown: 0,
  });
});
```

Note: this test assumes `makeUsageDataFixture` already supports `projectDir`. Check `scripts/__tests__/insights-signals.test.mjs` helper. If not, add a `projectDir` field to the helper as the first sub-step.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run scripts/__tests__/insights-signals.test.mjs -t "sessionsByKind"`
Expected: FAIL — `sessionsByKind is undefined`.

- [ ] **Step 3: Update `gatherInsightsSignals` to classify and emit**

In `scripts/insights-signals.mjs`, after `const inWindow = allMeta.filter(...)` (line ~89), add:

```js
const transcriptIndexForKind = await buildTranscriptIndex(claudeHome);
const sessionsByKind = {
  interactive_cli: 0,
  sdk_orchestrated: 0,
  observer: 0,
  subagent: 0,
  unknown: 0,
};
const interactiveSessionIds = new Set();
for (const m of inWindow) {
  const tpath = transcriptIndexForKind.get(m.session_id);
  const kind = tpath ? await classifySessionKind(tpath) : "unknown";
  m._kind = kind;
  sessionsByKind[kind] += 1;
  if (kind === "interactive_cli") interactiveSessionIds.add(m.session_id);
}
const interactiveSessionsAnalyzed = sessionsByKind.interactive_cli;
```

Import `classifySessionKind` at the top:

```js
import {
  buildTranscriptIndex,
  classifySessionKind,
  cutoffFromLookback,
  loadFacetsMap,
  loadSessionMeta,
  scanTranscriptModes,
  withinWindow,
} from "./_usage-data.mjs";
```

Add to the `result` object (lines ~138-164):

```js
sessionsByKind,
interactiveSessionsAnalyzed,
```

- [ ] **Step 4: Run insights-signals test suite**

Run: `npx vitest run scripts/__tests__/insights-signals.test.mjs`
Expected: All tests PASS. The new `sessionsByKind` assertion passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/insights-signals.mjs scripts/__tests__/insights-signals.test.mjs
git commit -m "feat(insights): emit sessionsByKind and interactiveSessionsAnalyzed"
```

---

## Task 5: Restrict posture counts to the interactive subset

**Files:**

- Modify: `scripts/insights-signals.mjs`
- Test: `scripts/__tests__/insights-signals.test.mjs`

Currently `autoModeSessionCount`, `bypassPermissionsSessionCount`, `planModeSessionCount`, `worktreeUsageSessionCount`, and `learningModeSessionCount` count across all in-window sessions. They should only count within interactive sessions.

- [ ] **Step 1: Add failing test asserting SDK sessions don't bump autoModeSessionCount**

Append to `insights-signals.test.mjs`:

```js
it("autoModeSessionCount excludes sdk-cli sessions even if their transcript contains permissionMode auto", async () => {
  const claudeHome = await makeUsageDataFixture({
    sessions: [
      {
        id: "s-int-1",
        start_time: nowMinus(1),
        transcript: [
          { type: "user", entrypoint: "cli", permissionMode: "auto" },
        ],
      },
      {
        id: "s-sdk-1",
        projectDir: "-Users-x-Projects-routine",
        start_time: nowMinus(1),
        transcript: [
          { type: "user", entrypoint: "sdk-cli", permissionMode: "auto" },
        ],
      },
    ],
  });
  const r = await gatherInsightsSignals({
    claudeHome,
    lookbackDays: 14,
    now: NOW_ISO,
    includeTranscripts: true,
  });
  expect(r.interactiveSessionsAnalyzed).toBe(1);
  expect(r.autoModeSessionCount).toBe(1);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run scripts/__tests__/insights-signals.test.mjs -t "excludes sdk-cli"`
Expected: FAIL — count is 2 (current behavior counts both).

- [ ] **Step 3: Update the transcript scan loop to skip non-interactive sessions for posture counts**

In `scripts/insights-signals.mjs`, modify the loop inside `if (includeTranscripts) { ... for (const m of inWindow) { ... } }` (line ~174) to skip non-interactive sessions for posture counters but still scan for worktree and learning markers if they should remain broad. For this plan: posture-only fields go behind the interactive gate.

Replace the body of the loop with:

```js
for (const m of inWindow) {
  const path = transcriptIndex.get(m.session_id);
  if (!path) continue;
  const { modes, hasWorktreeState, learningModeMatches } =
    await scanTranscriptModes(path);
  const isInteractive = m._kind === "interactive_cli";
  if (isInteractive) {
    if (modes.has("auto")) autoModeSessionCount += 1;
    if (modes.has("bypassPermissions")) bypassPermissionsSessionCount += 1;
    if (modes.has("plan")) planModeSessionCount += 1;
    if (hasWorktreeState) worktreeUsageSessionCount += 1;
    if (learningModeMatches > 0 || modes.has("learning"))
      learningModeSessionCount += 1;
  }
  learningModeMatchesTotal += learningModeMatches;
}
```

Rationale: `learningModeMatchesTotal` is a banner-count metric, not a session-adoption metric, so it stays broad. The five session-adoption counters become interactive-only.

- [ ] **Step 4: Run insights-signals tests**

Run: `npx vitest run scripts/__tests__/insights-signals.test.mjs`
Expected: All tests PASS. The "excludes sdk-cli" test now succeeds.

- [ ] **Step 5: Commit**

```bash
git add scripts/insights-signals.mjs scripts/__tests__/insights-signals.test.mjs
git commit -m "feat(insights): restrict posture counts to interactive sessions"
```

---

## Task 6: Failing regression test — permissions scorer denominator

**Files:**

- Test: `scripts/__tests__/score.test.mjs`

- [ ] **Step 1: Add a regression test inside the permissions describe block**

Find the existing test `"rewards high auto-mode ratio, punishes bypass usage"` (line ~311) and add a sibling test after it:

```js
it("denominator excludes sdk-orchestrated sessions (regression: observer dilution)", () => {
  const insights = makeInsights({
    transcriptsScanned: true,
    sessionsAnalyzed: 400,
    interactiveSessionsAnalyzed: 50,
    sessionsByKind: {
      interactive_cli: 50,
      sdk_orchestrated: 0,
      observer: 350,
      subagent: 0,
      unknown: 0,
    },
    autoModeSessionCount: 45,
    bypassPermissionsSessionCount: 0,
  });
  const result = EXECUTION_SCORERS.permissions({ insights });
  // 45/50 = 90% → high score, NOT 45/400 = 11% → near-zero score
  expect(result.score).toBeGreaterThan(80);
  expect(result.evidence[0]).toMatch(/45\/50/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "denominator excludes"`
Expected: FAIL — score is 11 (45/400 weighted), evidence says `45/400`.

- [ ] **Step 3: Update the permissions scorer to use the interactive denominator**

In `scripts/score.mjs`, lines 552-582, replace the permissions scorer:

```js
permissions: withGates({ transcripts: true, universe: "interactive_only" }, (s) => {
  const {
    autoModeSessionCount,
    bypassPermissionsSessionCount,
    interactiveSessionsAnalyzed,
  } = s.insights;
  if (autoModeSessionCount == null || bypassPermissionsSessionCount == null) {
    return unavailable(GAP_REASONS.NO_TRANSCRIPTS);
  }
  if (!interactiveSessionsAnalyzed) {
    return unavailable(GAP_REASONS.NO_SESSIONS);
  }
  const autoRatio = autoModeSessionCount / interactiveSessionsAnalyzed;
  const bypassRatio = bypassPermissionsSessionCount / interactiveSessionsAnalyzed;
  const score = clamp(
    Math.round(
      autoRatio * COEFFS.permissionsAutoWeight -
        bypassRatio * COEFFS.permissionsBypassPenalty,
    ),
  );
  const evidence = [
    `Auto mode: ${autoModeSessionCount}/${interactiveSessionsAnalyzed} interactive sessions (${pct(autoRatio * 100)}%)`,
  ];
  const gaps = [];
  if (bypassPermissionsSessionCount > 0) {
    gaps.push(
      `bypassPermissions: ${bypassPermissionsSessionCount}/${interactiveSessionsAnalyzed} sessions — auto mode preferred`,
    );
  }
  return { score, evidence, gaps, gapReason: null };
}),
```

(The `universe` opt is purely documentary on `withGates` for now — the runtime guard lives in the scorer body via `interactiveSessionsAnalyzed`. Wiring it into `withGates` is Task 7.)

- [ ] **Step 4: Run the new regression test**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "denominator excludes"`
Expected: PASS — score > 80, evidence reads `45/50 interactive sessions`.

- [ ] **Step 5: Run full test suite to catch fixture cascades**

Run: `npx vitest run`
Expected: All tests PASS. If pre-existing permissions tests fail, they relied on `sessionsAnalyzed` as the denominator — update them to pass both `interactiveSessionsAnalyzed` and `sessionsAnalyzed` via `makeInsights`.

- [ ] **Step 6: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "fix(score): permissions denominator uses interactive sessions only"
```

---

## Task 7: Wire `universe` into `withGates` as a declarative guard

**Files:**

- Modify: `scripts/score.mjs`
- Test: `scripts/__tests__/score.test.mjs`

The `universe` option in Task 6 was documentary. Make it enforceable so every future scorer must declare its universe explicitly.

- [ ] **Step 1: Add a failing test for `withGates` universe option**

Append inside the existing `describe("EXECUTION_SCORERS", …)` block in `score.test.mjs`:

```js
it("scorers must declare a universe option (interactive_only or all_sessions)", () => {
  for (const [name, scorer] of Object.entries(EXECUTION_SCORERS)) {
    expect(scorer.__universe, `${name} must declare universe`).toMatch(
      /^(interactive_only|all_sessions)$/,
    );
  }
});
```

- [ ] **Step 2: Run test, watch it fail**

Run: `npx vitest run scripts/__tests__/score.test.mjs -t "must declare a universe"`
Expected: FAIL — `__universe` is undefined.

- [ ] **Step 3: Update `withGates` to record universe and validate**

In `scripts/score.mjs`, replace `withGates` (lines 511-…):

```js
function withGates(opts, fn) {
  const universe = opts.universe;
  if (universe !== "interactive_only" && universe !== "all_sessions") {
    throw new Error(
      `withGates: universe must be 'interactive_only' or 'all_sessions', got ${universe}`,
    );
  }
  const wrapped = (s) => {
    if (!s.insights) return unavailable(GAP_REASONS.NO_INSIGHTS);
    if (opts.transcripts && !s.insights.transcriptsScanned) {
      return unavailable(GAP_REASONS.NO_TRANSCRIPTS);
    }
    const denom =
      universe === "interactive_only"
        ? s.insights.interactiveSessionsAnalyzed
        : s.insights.sessionsAnalyzed;
    if (opts.requireSessions !== false && !denom) {
      return unavailable(GAP_REASONS.NO_SESSIONS);
    }
    return fn(s);
  };
  wrapped.__universe = universe;
  return wrapped;
}
```

- [ ] **Step 4: Add `universe` to every scorer**

In `scripts/score.mjs`, update each entry in `EXECUTION_SCORERS`:

| Scorer         | Universe           | Rationale                                    |
| -------------- | ------------------ | -------------------------------------------- |
| `permissions`  | `interactive_only` | Posture — already done in Task 6             |
| `verification` | `all_sessions`     | Friction occurs in any session               |
| `parallel`     | `interactive_only` | Subagent/worktree decisions are user choices |
| `planning`     | `interactive_only` | Plan-mode adoption per user session          |
| `automation`   | `interactive_only` | Hook fires per interactive session           |
| `integrations` | `all_sessions`     | Volume metric                                |
| `scheduled`    | `all_sessions`     | Volume metric                                |
| `remote`       | `all_sessions`     | Volume metric                                |
| `learning`     | `interactive_only` | Posture                                      |

Example:

```js
verification: withGates({ universe: "all_sessions" }, (s) => { … }),
parallel: withGates({ universe: "interactive_only" }, (s) => { … }),
```

For scorers whose body still references `s.insights.sessionsAnalyzed` as their denominator (e.g. `verification`), keep the existing denominator — it's correct for `all_sessions`. For scorers that should now divide by interactive count (e.g. `planning`, `learning`, `automation`, `parallel`), update them to use `interactiveSessionsAnalyzed`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: All tests PASS. The universe-declaration test now passes.

- [ ] **Step 6: Commit**

```bash
git add scripts/score.mjs scripts/__tests__/score.test.mjs
git commit -m "feat(score): declarative universe gate on every execution scorer"
```

---

## Task 8: Surface the session-kind census on the Probes page

**Files:**

- Modify: `app/methodology/probes/page.tsx`
- Modify: `app/data/probe-catalog.json`
- Modify: `app/lib/assessment.ts` (TypeScript shape)

Drift becomes visible: the user can see at a glance that 350 of 400 sessions are observer noise.

- [ ] **Step 1: Extend `assessment.ts` types**

In `app/lib/assessment.ts`, add to the `Insights` interface (find it via grep for `interface Insights` or `type Insights`):

```ts
sessionsByKind?: {
  interactive_cli: number;
  sdk_orchestrated: number;
  observer: number;
  subagent: number;
  unknown: number;
};
interactiveSessionsAnalyzed?: number;
```

- [ ] **Step 2: Add catalog entry**

In `app/data/probe-catalog.json`, append a new entry to the top-level object (alphabetical-ish; place near the transcripts group):

```json
"sessionsByKind": {
  "source": "transcripts",
  "path": "~/.claude/projects/**/*.jsonl → first 5 lines, entrypoint field",
  "description": "Classifies in-window sessions as interactive_cli, sdk_orchestrated, observer, or subagent. Posture scorers (auto mode, plan mode, learning) divide by interactive_cli only — SDK and observer sessions don't honor user-level settings and would dilute the ratio."
}
```

- [ ] **Step 3: Add a Session Kinds card on the probes page**

In `app/methodology/probes/page.tsx`, add a card rendering the breakdown. Pseudocode location: alongside the existing "transcripts" group:

```tsx
{
  insights?.sessionsByKind && (
    <section aria-labelledby="kinds-heading" className="rounded-lg border ...">
      <h2 id="kinds-heading">Session kinds in window</h2>
      <p className="text-sm text-muted-foreground">
        Posture scorers divide by <code>interactive_cli</code> only. Volume
        scorers (integrations, scheduled, remote) divide by all sessions.
      </p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Object.entries(insights.sessionsByKind).map(([kind, count]) => (
          <div key={kind}>
            <dt className="font-mono text-xs">{kind}</dt>
            <dd className="text-2xl">{count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 4: Visual smoke test**

Run: `npm run dev` and visit `http://localhost:3000/methodology/probes`. Confirm the new card renders with non-zero counts. Hit it with a real assessment in `app/data/assessment.json` (run `npm run assess` first if needed — but do NOT run `/insights`).

- [ ] **Step 5: Commit**

```bash
git add app/methodology/probes/page.tsx app/data/probe-catalog.json app/lib/assessment.ts
git commit -m "feat(probes): show session-kind census on probes page"
```

---

## /batch checkpoint — Tasks 9 and 10 can run in parallel

Both tasks are documentation-only edits to different files (methodology page text vs CLAUDE.md). They're independent and parallelizable. Dispatch them in one `/batch` round via subagents, then sync.

---

## Task 9: Annotate each dimension on the Methodology page with its universe

**Files:**

- Modify: `app/methodology/page.tsx`

- [ ] **Step 1: Add a "universe" sub-line to each Execution dim**

For each `<strong>Permissions & Safety</strong>`, `<strong>Plan & Spec Mode</strong>`, etc., append a line after the formula:

```tsx
<p className="text-xs text-muted-foreground">
  Universe: interactive sessions only (excludes SDK and observer sessions).
</p>
```

For `Verification`, `Integrations`, `Scheduled`, `Remote`:

```tsx
<p className="text-xs text-muted-foreground">
  Universe: all in-window sessions (volume metric).
</p>
```

- [ ] **Step 2: Visual check**

Visit `http://localhost:3000/methodology`. Confirm each dimension shows its universe annotation.

- [ ] **Step 3: Commit**

```bash
git add app/methodology/page.tsx
git commit -m "docs(methodology): annotate each dim with its session universe"
```

---

## Task 10: Add the CLAUDE.md hard rule

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Insert a new bullet into the "Hard rules" block**

In `CLAUDE.md`, find the `## Hard rules` section. Insert after the "Empirically verify telemetry fields" bullet:

```markdown
- **Verify denominator semantics for every ratio scorer.** A scorer
  measuring user posture (permissions, plan mode, learning) must restrict
  its denominator to sessions whose posture is actually settable by the
  user — `interactive_cli`. Don't count `sdk_orchestrated`, `observer`, or
  `subagent` sessions in posture ratios; they run with the SDK's defaults
  and silently dilute the numerator. Volume scorers (integrations,
  scheduled, remote) can use the broad `all_sessions` universe. Universe
  is declared on `withGates({ universe: … })` in `scripts/score.mjs` and
  enforced at construction time.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): add hard rule on denominator semantics"
```

---

## Task 11: Cross-axis sanity hint on the dashboard

**Files:**

- Modify: `app/page.tsx`

Diagnostic only — never used in scoring. Stays consistent with the "never collapse the two axes" rule.

- [ ] **Step 1: Add a hint banner near the Execution permissions tile**

Insert into `app/page.tsx` where the Execution permissions dimension is rendered. Logic in pseudocode:

```tsx
{
  platform.permissions.defaultMode === "auto" &&
    execution.permissions.score < 50 && (
      <p className="rounded-md border border-amber-200/40 bg-amber-50/5 p-3 text-xs">
        Setup says auto mode is configured, but Execution measures{" "}
        {execution.permissions.score} / 100. Check the{" "}
        <Link href="/methodology/probes#kinds-heading" className="underline">
          session-kind census
        </Link>{" "}
        — if most sessions are <code>sdk_orchestrated</code> or{" "}
        <code>observer</code>, the interactive-only denominator already filters
        them. Otherwise, your interactive sessions may not be in auto mode.
      </p>
    );
}
```

(Adjust the exact data plumbing to match `app/page.tsx` — read the platform value from the assessment shape.)

- [ ] **Step 2: Visual check**

Run `npm run dev` and confirm:

- When your real config has auto-mode on and after the new fix the score is high → banner does not render.
- Force a low score by editing `app/data/assessment.json` (then revert) → banner renders.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat(dashboard): cross-axis sanity hint when posture seems inconsistent"
```

---

## Task 12: Run /simplify on the changed surface

**Files:**

- All files modified across Tasks 1-11

The /simplify skill reviews changed code for reuse, quality, and efficiency. Common cleanups for this kind of work:

- Collapse near-duplicate kind-counter declarations
- Confirm `sessionsByKind` shape is a single source of truth
- Confirm no double-classification per session (classify once per assessment)

- [ ] **Step 1: Invoke the skill**

Run `/simplify` (skill name `simplify`). Pass the scope as "files changed on branch vs main."

- [ ] **Step 2: Apply any agreed simplifications**

Make changes inline, run full tests, commit per change.

- [ ] **Step 3: Commit per applied simplification**

```bash
git add <files>
git commit -m "refactor: <one-line summary> (/simplify)"
```

---

## Task 13: Request code review via /requesting-code-review

**Files:**

- All files modified

- [ ] **Step 1: Invoke `superpowers:requesting-code-review`**

Use the Skill tool. Brief the review to focus on:

- Is `interactive_only` the right semantic on every scorer flagged in Task 7?
- Is the classifier defensive enough against malformed jsonl headers?
- Are the per-session `_kind` underscore-prefixed fields safe (don't accidentally serialize into assessment.json)?
- Does the cross-axis hint risk feeling judgmental to users with a deliberately-low score?

- [ ] **Step 2: Triage feedback per superpowers:receiving-code-review**

Apply each accepted suggestion as a separate commit. Push back on unclear or technically-questionable suggestions per the receiving-code-review skill.

- [ ] **Step 3: Commit per applied change**

---

## Task 14: /ship — open PR, create Jira ticket, follow personal shipping chain

**Files:**

- None new

- [ ] **Step 1: Verify clean state**

```bash
git status
npx vitest run
```

Expected: clean, all tests pass.

- [ ] **Step 2: Invoke /ship**

Run `/ship` (skill name `ship`). The chain will:

1. Pre-flight (branch state, sibling PRs, base branch)
2. Cost gate
3. Test verification (npx vitest run)
4. /verify-agent (manual UI check on `npm run dev`)
5. /simplify (already done — skill detects and skips)
6. /requesting-code-review (already done — skill detects and skips)
7. Commit + push + PR via `gh pr create`
8. Jira: create CCE-N ticket and link to PR

If /ship halts at Stage 0 because a PR already exists for the current branch, follow the CLAUDE.md workaround note — re-run Stages 2-4 manually.

- [ ] **Step 3: PR title and body**

PR title: `feat: session-kind filtering for execution posture scorers — CCE-N`

PR body (template handled by /ship, but content):

```markdown
## Summary

- Adds first-class `session_kind` classifier (interactive_cli, sdk_orchestrated, observer, subagent, unknown)
- Posture scorers (permissions, plan, learning, parallel, automation) now divide by `interactiveSessionsAnalyzed`, not the full session count diluted by SDK observer sessions
- Probes page shows the session-kind census so future drift is visible
- New CLAUDE.md hard rule + universe gate enforces the constraint at construction time

## Test plan

- [ ] `npx vitest run` — all tests pass (494 + ~12 new)
- [ ] `npm run dev` → `/methodology/probes` shows the kind census card
- [ ] `npm run dev` → `/` shows correct auto-mode score (high, not low)
- [ ] `npm run assess` produces a snapshot with `interactiveSessionsAnalyzed` and `sessionsByKind`
- [ ] Regression: force a fixture with 350 observer sessions; permissions scorer still scores ≈ 90, not ≈ 11
```

- [ ] **Step 4: Jira ticket content**

After /ship creates the ticket, ensure it includes:

- Project: CCE
- Summary: `Session-kind filtering for execution posture scorers`
- Description: links to the PR, a one-paragraph cause summary referencing the auto-mode mistery branch
- Component / label: `self-assessment-scoring` if it exists

- [ ] **Step 5: After merge — cleanup**

```bash
git fetch --prune
git switch main
git pull
git branch -D <feature-branch>      # local
# remote is already deleted by --delete-branch on gh pr merge
```

If still inside the worktree, follow the worktree-removal pattern from CLAUDE.md.

---

## Self-Review

Before handing this plan off, the writer ran the self-review checklist:

**Spec coverage:**

- ✅ Layer 1 (data model): Task 1, 2 — classifier
- ✅ Layer 2 (loader filtering): Task 4 — insights-signals emits kind census
- ✅ Layer 3 (scorer correctness): Tasks 5, 6, 7 — posture counts + permissions + every-scorer universe
- ✅ Layer 4 (visibility): Task 8 (probes page), Task 9 (methodology), Task 11 (cross-axis hint)
- ✅ Layer 5 (drift protection): Task 7 (universe enforced) + Task 10 (CLAUDE.md rule) + tests in Tasks 4-7
- ✅ Layer 6 (sanity hint): Task 11
- ✅ Migration: classifier reads transcripts on every run; no schema change to cooked JSON; `_kind` is in-memory only
- ✅ /simplify, /requesting-code-review, /ship + Jira: Tasks 12-14

**Placeholder scan:**

- All code blocks contain actual code, not "TBD" / "similar to above".
- All test names are concrete.
- All commands are runnable.

**Type consistency:**

- `classifySessionKind` returns the same five string literals everywhere.
- `interactiveSessionsAnalyzed` is the canonical field name (not `interactiveSessionCount` etc.) in fixtures, insights output, scorers, and types.
- `sessionsByKind` keys match in fixture, classifier, insights output, probes page, methodology page.

**Edge cases addressed:**

- Empty transcript file → `unknown`
- Malformed JSON lines → skipped, scan continues
- No `entrypoint` in first 5 lines → `unknown`
- Subagent transcripts → path-keyed, no transcript read needed

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-session-kind-filtering.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task (Tasks 1, 2, 3, 4, 5, 6, 7, 8, 11), batch the doc tasks (Tasks 9, 10) in a single /batch round, then I run Tasks 12-14 in this session.

2. **Inline Execution** — execute tasks sequentially in this session with checkpoints between Tasks 3, 7, and 11 for review.

Which approach?
