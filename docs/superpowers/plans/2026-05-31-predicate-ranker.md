---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
---

# Predicate evaluator + ranked next-actions — implementation plan (PR 2)

> **For agentic workers:** Use `superpowers:executing-plans` to work through this plan task-by-task. Each task is independently committable; commit after each task's tests pass before moving on. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "model re-implements the DSL" bug class. Extract `evaluatePredicate` from `app/lib/assessment.ts` into a Node-callable `scripts/predicate.mjs`, pre-compute the filtered + ranked top-N next-actions in `scripts/run-assessment.mjs`, and write them to `assessment.json.rankedNextActions`. The `/self-assessment` skill becomes a trivial reader; the PR 1 SKILL.md grammar block is deleted as obsolete.

**Design spec:** `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md` — read it first. This plan is the step-by-step execution of PR 2 (Structural) from that spec.

**Status at plan creation:** PR 1 (SKILL.md grammar block, spec doc, this plan) merged as PR #104 on 2026-05-31. PR 2 is the active work item.

**Prerequisites:** Working tree on a fresh branch off `main` post-PR #104 merge. `npx vitest run` green.

---

## File structure

| Action   | Path                                               | Purpose                                                                            |
| -------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Create   | `scripts/predicate.mjs`                            | Pure-ESM port of the DSL evaluator; exports `evaluatePredicate`                    |
| Create   | `scripts/__tests__/predicate.test.mjs`             | Operator-coverage suite + rubric integration test                                  |
| Create   | `scripts/rank-next-actions.mjs`                    | `rankNextActions(rubric, scoreMap, signals, limit=10)` + axisOrder helper          |
| Create   | `scripts/__tests__/rank-next-actions.test.mjs`     | Fixture-driven ranker tests, including named regression for `loopCommandUses=14`   |
| Modify   | `app/lib/assessment.ts`                            | Replace local evaluator (lines 165–259) with 1-line passthrough re-export          |
| Create   | `app/lib/__tests__/predicate-passthrough.test.ts`  | Asserts `fromTs === fromMjs` (reference equality)                                  |
| Modify   | `scripts/run-assessment.mjs`                       | Import `rankNextActions`; attach `rankedNextActions` to written `assessment.json`  |
| Modify   | `.claude/skills/self-assessment/SKILL.md`          | Delete grammar block; replace filter+rank instructions with reader of pre-baked field |
| Modify   | `CLAUDE.md`                                        | Add `predicate.mjs` to file map; add "DSL evaluator has one source" hard rule      |
| Modify   | `app/data/rubric.json`                             | Update `$schema` comment: canonical evaluator is now `scripts/predicate.mjs`       |

---

## Task 1: Create `scripts/predicate.mjs`

**Files:**

- Read: `app/lib/assessment.ts` (lines 165–259 contain the evaluator; copy logic, not the TS syntax)
- Create: `scripts/predicate.mjs`

The module is a pure-ESM port of `readPath`, `isTruthy`, `evaluateAtomic`, and `evaluatePredicate`. No external dependencies. The exported function signature is identical: `evaluatePredicate(expr: string, signals: Record<string, unknown>): boolean`.

Critical behavioral contracts to preserve (from the TS implementation):

- `"0"` and `"false"` are falsy strings — `isTruthy` treats them as false
- Missing numeric signal: `Number(undefined)` is `NaN`; the NaN guard makes numeric comparisons return `false` (not assume 0)
- `~` operator: non-array LHS → `false`; unparseable regex → `false`, never throws
- `&` splits on `&` (single character), trims each atom, requires ALL atoms true

- [ ] **Step 1: Create the file**

Write `scripts/predicate.mjs` with the following content:

```javascript
// Pure-ESM port of the satisfiedWhen DSL evaluator. Canonical implementation
// shared between scripts/run-assessment.mjs and the Next.js dashboard
// (app/lib/assessment.ts re-exports from here as a 1-line passthrough).
//
// Grammar (mirrors app/data/rubric.json $schema comment):
//   path                — truthy (non-null, non-zero, non-empty-string; "0"/"false" also falsy)
//   !path                — falsy
//   path>=N / <=N / >N / <N — numeric comparison
//   path=v / path=v|w|x  — equals (or equals one of)
//   path!=v              — not equals
//   path~regex           — array-of-strings element matches regex (i flag)
//   A & B                — AND of two or more atoms

function readPath(obj, path) {
  return path.split(".").reduce((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) return acc[key];
    return undefined;
  }, obj);
}

function isTruthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string")
    return v.length > 0 && v !== "0" && v.toLowerCase() !== "false";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function evaluateAtomic(expr, signals) {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("!"))
    return !evaluateAtomic(trimmed.slice(1), signals);
  // Array-regex (~): RHS is regex, matched case-insensitively against each
  // element of the (string-array) LHS. Returns false for non-array LHS or
  // unparseable regex — never throws.
  const arrMatch = trimmed.match(/^(.+?)~(.+)$/);
  if (arrMatch) {
    const path = arrMatch[1].trim();
    const rhs = arrMatch[2].trim();
    const value = readPath(signals, path);
    if (!Array.isArray(value)) return false;
    let re;
    try {
      re = new RegExp(rhs, "i");
    } catch {
      return false;
    }
    return value.some((el) => typeof el === "string" && re.test(el));
  }
  // Order matters: longer operators first so ">=" doesn't match as ">".
  const cmpMatch = trimmed.match(/^(.+?)(>=|<=|!=|=|>|<)(.+)$/);
  if (cmpMatch) {
    const path = cmpMatch[1].trim();
    const op = cmpMatch[2];
    const rhs = cmpMatch[3].trim();
    const value = readPath(signals, path);
    if (op === "=" || op === "!=") {
      const literals = rhs.split("|").map((s) => s.trim());
      const hit = literals.some((lit) => String(value) === lit);
      return op === "=" ? hit : !hit;
    }
    const num = typeof value === "number" ? value : Number(value);
    const rhsNum = Number(rhs);
    if (Number.isNaN(num) || Number.isNaN(rhsNum)) return false;
    switch (op) {
      case ">":  return num > rhsNum;
      case ">=": return num >= rhsNum;
      case "<":  return num < rhsNum;
      case "<=": return num <= rhsNum;
      default:   return false;
    }
  }
  // No operator → truthy check on the path.
  return isTruthy(readPath(signals, trimmed));
}

export function evaluatePredicate(expr, signals) {
  if (!expr || !expr.trim()) return false;
  const atoms = expr
    .split("&")
    .map((s) => s.trim())
    .filter(Boolean);
  if (atoms.length === 0) return false;
  return atoms.every((atom) => evaluateAtomic(atom, signals));
}
```

- [ ] **Step 2: Verify it's valid ESM (no syntax errors)**

Run:

```bash
node --input-type=module <<'EOF'
import { evaluatePredicate } from "./scripts/predicate.mjs";
console.assert(evaluatePredicate("x>=1", { x: 14 }) === true, ">=1 with 14");
console.assert(evaluatePredicate("x>=1", { x: 0 }) === false, ">=1 with 0");
console.assert(evaluatePredicate("loopCommandUses>=1", { loopCommandUses: 14 }) === true, "regression");
console.log("predicate.mjs sanity OK");
EOF
```

Expected: `predicate.mjs sanity OK` with no assertion errors.

- [ ] **Step 3: No commit yet** — wait for Task 2 tests to pass together.

---

## Task 2: Create `scripts/__tests__/predicate.test.mjs`

**Files:**

- Create: `scripts/__tests__/predicate.test.mjs`

One test per operator class. The rubric integration test (`every satisfiedWhen in production rubric parses without throwing`) is the canary that catches future rubric grammar drift.

- [ ] **Step 1: Write the test file**

```javascript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePredicate } from "../predicate.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("evaluatePredicate — operator coverage", () => {
  it(">= : true above and at boundary; false below", () => {
    expect(evaluatePredicate("x>=5", { x: 5 })).toBe(true);
    expect(evaluatePredicate("x>=5", { x: 14 })).toBe(true);
    expect(evaluatePredicate("x>=5", { x: 4 })).toBe(false);
  });

  it("> : strict — false at boundary", () => {
    expect(evaluatePredicate("x>5", { x: 5 })).toBe(false);
    expect(evaluatePredicate("x>5", { x: 6 })).toBe(true);
  });

  it("<= and <", () => {
    expect(evaluatePredicate("x<=5", { x: 5 })).toBe(true);
    expect(evaluatePredicate("x<5", { x: 5 })).toBe(false);
    expect(evaluatePredicate("x<5", { x: 4 })).toBe(true);
  });

  it("missing numeric signal: comparisons NaN-guard to false", () => {
    // Mirrors the canonical TS behavior — missing path → undefined → NaN →
    // guard trips → false. This diverges from the rubric $schema comment's
    // "missing → 0" wording; fixing that wording is rubric doc-work only.
    expect(evaluatePredicate("x>=1", {})).toBe(false);
    expect(evaluatePredicate("x<=0", {})).toBe(false);
  });

  it("= : exact equality (string and numeric, cross-type via String() coercion)", () => {
    expect(evaluatePredicate("x=foo", { x: "foo" })).toBe(true);
    expect(evaluatePredicate("x=foo", { x: "bar" })).toBe(false);
    expect(evaluatePredicate("x=5", { x: 5 })).toBe(true);
    expect(evaluatePredicate("x=5", { x: "5" })).toBe(true);
  });

  it("= : alternation with |", () => {
    expect(evaluatePredicate("x=foo|bar|baz", { x: "bar" })).toBe(true);
    expect(evaluatePredicate("x=foo|bar|baz", { x: "qux" })).toBe(false);
  });

  it("!= : not-equals", () => {
    expect(evaluatePredicate("x!=foo", { x: "bar" })).toBe(true);
    expect(evaluatePredicate("x!=foo", { x: "foo" })).toBe(false);
    expect(evaluatePredicate("x!=foo", {})).toBe(true);
  });

  it("~ : array-of-strings regex match (case-insensitive)", () => {
    expect(
      evaluatePredicate("skills~^ship$", { skills: ["ship", "verify"] }),
    ).toBe(true);
    expect(evaluatePredicate("skills~^SHIP$", { skills: ["ship"] })).toBe(true);
    expect(evaluatePredicate("skills~^xyz$", { skills: ["ship"] })).toBe(false);
  });

  it("~ : non-array LHS returns false", () => {
    expect(evaluatePredicate("skills~^ship$", { skills: "ship" })).toBe(false);
  });

  it("~ : unparseable regex returns false (never throws)", () => {
    expect(evaluatePredicate("skills~[", { skills: ["ship"] })).toBe(false);
  });

  it("! : negation of truthy and falsy paths", () => {
    expect(evaluatePredicate("!x", { x: 0 })).toBe(true);
    expect(evaluatePredicate("!x", { x: 5 })).toBe(false);
    expect(evaluatePredicate("!missing", {})).toBe(true);
  });

  it("& : AND across two atoms", () => {
    expect(evaluatePredicate("x>0 & y>0", { x: 5, y: 5 })).toBe(true);
    expect(evaluatePredicate("x>0 & y>0", { x: 5, y: 0 })).toBe(false);
  });

  it("& : AND across three atoms", () => {
    expect(
      evaluatePredicate("x>0 & y>0 & z>0", { x: 1, y: 1, z: 1 }),
    ).toBe(true);
    expect(
      evaluatePredicate("x>0 & y>0 & z>0", { x: 1, y: 1, z: 0 }),
    ).toBe(false);
  });

  it("bare path : truthy check", () => {
    expect(evaluatePredicate("flag", { flag: true })).toBe(true);
    expect(evaluatePredicate("count", { count: 14 })).toBe(true);
    expect(evaluatePredicate("count", { count: 0 })).toBe(false);
    expect(evaluatePredicate("name", { name: "" })).toBe(false);
    expect(evaluatePredicate("missing", {})).toBe(false);
  });

  it("nested path: a.b.c", () => {
    expect(evaluatePredicate("a.b.c=ok", { a: { b: { c: "ok" } } })).toBe(true);
    expect(evaluatePredicate("a.b.c", { a: { b: { c: 5 } } })).toBe(true);
    expect(evaluatePredicate("a.b.c", { a: {} })).toBe(false);
  });

  it("empty / whitespace expression returns false", () => {
    expect(evaluatePredicate("", {})).toBe(false);
    expect(evaluatePredicate("   ", {})).toBe(false);
  });

  it("named regression: loopCommandUses=14 satisfies loopCommandUses>=1", () => {
    expect(
      evaluatePredicate("loopCommandUses>=1", { loopCommandUses: 14 }),
    ).toBe(true);
  });
});

describe("evaluatePredicate — rubric integration", () => {
  it("every satisfiedWhen in production rubric parses without throwing", () => {
    const rubricPath = join(here, "..", "..", "app", "data", "rubric.json");
    const rubric = JSON.parse(readFileSync(rubricPath, "utf8"));
    for (const dim of rubric.dimensions || []) {
      for (const na of dim.nextActions || []) {
        if (na.satisfiedWhen) {
          expect(
            () => evaluatePredicate(na.satisfiedWhen, {}),
            `predicate "${na.satisfiedWhen}" on ${dim.id}/${na.id} threw`,
          ).not.toThrow();
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the predicate tests**

```bash
npx vitest run scripts/__tests__/predicate.test.mjs
```

Expected: all operator tests + rubric integration test pass. Fix any failures in `scripts/predicate.mjs` before continuing.

- [ ] **Step 3: Commit Task 1 + Task 2 together**

```bash
git add scripts/predicate.mjs scripts/__tests__/predicate.test.mjs
git commit -m "feat(predicate): extract evaluatePredicate to scripts/predicate.mjs

Port of app/lib/assessment.ts evaluator to pure-ESM module.
Operator-coverage suite + rubric integration test.
Regression: loopCommandUses=14 correctly satisfies >=1."
```

---

## Task 3: Create `scripts/rank-next-actions.mjs`

**Files:**

- Create: `scripts/rank-next-actions.mjs`

Implements `rankNextActions(rubric, scoreMap, signalsSummary, limit=10)`. The tie-breaking sort is deterministic across runs: `rank desc → axis (platform→execution→either) → weight desc → dimId asc → actionId asc`.

- [ ] **Step 1: Write the module**

```javascript
// rank-next-actions.mjs
// Filters and ranks rubric.nextActions for the /self-assessment skill,
// /methodology overview, and any future consumer that needs a top-N list.
// Called once by scripts/run-assessment.mjs; output is written to
// app/data/assessment.json under `rankedNextActions`.

import { evaluatePredicate } from "./predicate.mjs";

function axisOrder(a) {
  return a === "platform" ? 0 : a === "execution" ? 1 : 2;
}

/**
 * @param rubric         The parsed rubric object ({ dimensions: [...] }).
 * @param scoreMap       Map<dimId, { score, executionScore }>.
 * @param signalsSummary Flat object — passed verbatim to evaluatePredicate.
 * @param limit          Maximum entries to return (default 10).
 * @returns Array of ranked entries, sorted by tie-breaking rule.
 */
export function rankNextActions(rubric, scoreMap, signalsSummary, limit = 10) {
  const ranked = [];
  for (const dim of rubric.dimensions || []) {
    const scored = scoreMap.get(dim.id);
    if (!scored) continue;
    const weight = dim.weight ?? 1;
    const pDeficit = Math.max(0, 100 - scored.score);
    const xDeficit =
      scored.executionScore == null
        ? 0
        : Math.max(0, 100 - scored.executionScore);
    for (const na of dim.nextActions || []) {
      if (!na.action) continue; // malformed; skip silently
      if (
        na.satisfiedWhen &&
        evaluatePredicate(na.satisfiedWhen, signalsSummary)
      )
        continue;
      const axis = na.axis ?? (na.satisfiedWhen ? "platform" : "either");
      const deficit = axis === "execution" ? xDeficit : pDeficit;
      const rank = weight * deficit;
      ranked.push({
        dimId: dim.id,
        actionId: na.id,
        axis,
        weight,
        deficit,
        rank,
        action: na.action,
        effort: na.effort,
        borisTip: na.borisTip,
        satisfiedWhen: na.satisfiedWhen ?? null,
      });
    }
  }
  ranked.sort(
    (a, b) =>
      b.rank - a.rank ||
      axisOrder(a.axis) - axisOrder(b.axis) ||
      b.weight - a.weight ||
      a.dimId.localeCompare(b.dimId) ||
      a.actionId.localeCompare(b.actionId),
  );
  return ranked.slice(0, limit);
}
```

- [ ] **Step 2: Verify the module loads without errors**

```bash
node --input-type=module <<'EOF'
import { rankNextActions } from "./scripts/rank-next-actions.mjs";
console.assert(typeof rankNextActions === "function");
console.log("rank-next-actions.mjs OK");
EOF
```

Expected: `rank-next-actions.mjs OK`.

---

## Task 4: Create `scripts/__tests__/rank-next-actions.test.mjs`

**Files:**

- Create: `scripts/__tests__/rank-next-actions.test.mjs`

The named regression test (`NAMED REGRESSION: loopCommandUses=14 excludes babysit-loop action`) is the CI tripwire for the original bug. It must be the first test a reviewer reads.

- [ ] **Step 1: Write the test file**

```javascript
import { describe, it, expect } from "vitest";
import { rankNextActions } from "../rank-next-actions.mjs";

const fixtureRubric = {
  dimensions: [
    {
      id: "scheduled",
      weight: 2,
      nextActions: [
        {
          id: "babysit-loop",
          action: "Start with one loop — Boris tip 48",
          effort: "5min",
          borisTip: 48,
          satisfiedWhen: "loopCommandUses>=1",
        },
        {
          id: "promote-routine",
          action: "Promote repeating patterns to a Routine — Boris tip 61",
          effort: "30min",
          borisTip: 61,
          satisfiedWhen: "scheduleCommandUses>=1",
        },
      ],
    },
    {
      id: "automation",
      weight: 3,
      nextActions: [
        {
          id: "formatter-hook",
          action: "Add a PostToolUse formatter hook — Boris tip 7",
          effort: "15min",
          borisTip: 7,
          satisfiedWhen: "hasFormatterHook",
        },
      ],
    },
    {
      id: "remote",
      weight: 1,
      nextActions: [
        {
          id: "ios-task",
          action: "Try the iOS app — coaching",
          effort: "5min",
          // no satisfiedWhen → unpredicated, axis defaults to "either"
        },
        {
          id: "missing-action-text",
          // no action field → malformed; must be skipped silently
          effort: "5min",
        },
      ],
    },
  ],
};

const makeScoreMap = (overrides = {}) =>
  new Map([
    ["scheduled", { score: 75, executionScore: 100 }],
    ["automation", { score: 89, executionScore: null }],
    ["remote", { score: 87, executionScore: 100 }],
    ...Object.entries(overrides),
  ]);

describe("rankNextActions", () => {
  it("returns ranked list sorted by weight*deficit desc", () => {
    const signals = {
      loopCommandUses: 0,
      scheduleCommandUses: 0,
      hasFormatterHook: false,
    };
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    // ranks: scheduled actions = 2 * 25 = 50 each
    //        automation formatter-hook = 3 * 11 = 33
    //        remote ios-task = 1 * 13 = 13
    expect(result[0].rank).toBe(50);
    expect(result[1].rank).toBe(50);
    expect(result[2].rank).toBe(33);
    expect(result[3].rank).toBe(13);
    expect(result).toHaveLength(4);
  });

  it("NAMED REGRESSION: loopCommandUses=14 excludes babysit-loop action", () => {
    const signals = {
      loopCommandUses: 14, // SATISFIES "loopCommandUses>=1"
      scheduleCommandUses: 0,
      hasFormatterHook: false,
    };
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    const ids = result.map((a) => a.actionId);
    expect(ids).not.toContain("babysit-loop");
    expect(ids).toContain("promote-routine");
  });

  it("unpredicated action stays regardless of signals", () => {
    const signals = {
      loopCommandUses: 14,
      scheduleCommandUses: 14,
      hasFormatterHook: true,
    };
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    const ids = result.map((a) => a.actionId);
    expect(ids).toEqual(["ios-task"]);
  });

  it("malformed action (missing action text) is silently skipped", () => {
    const signals = {};
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    const ids = result.map((a) => a.actionId);
    expect(ids).not.toContain("missing-action-text");
  });

  it("respects limit slicing", () => {
    const signals = {};
    expect(rankNextActions(fixtureRubric, makeScoreMap(), signals, 2)).toHaveLength(2);
    expect(rankNextActions(fixtureRubric, makeScoreMap(), signals, 0)).toHaveLength(0);
  });

  it("tie-breaking is deterministic: rank → axis → weight → dimId → actionId", () => {
    const signals = {};
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    // Both scheduled actions have rank=50, axis=platform, weight=2, dimId=scheduled.
    // Final tiebreak: actionId ascending → babysit-loop before promote-routine.
    expect(result[0].actionId).toBe("babysit-loop");
    expect(result[1].actionId).toBe("promote-routine");
  });

  it("each entry carries required fields", () => {
    const signals = {};
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    for (const entry of result) {
      expect(entry).toMatchObject({
        dimId: expect.any(String),
        actionId: expect.any(String),
        axis: expect.any(String),
        weight: expect.any(Number),
        deficit: expect.any(Number),
        rank: expect.any(Number),
        action: expect.any(String),
        effort: expect.any(String),
      });
    }
  });

  it("axis defaults: predicated → platform; unpredicated → either", () => {
    const signals = {};
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    const formatter = result.find((a) => a.actionId === "formatter-hook");
    const ios = result.find((a) => a.actionId === "ios-task");
    expect(formatter.axis).toBe("platform");
    expect(ios.axis).toBe("either");
  });

  it("dim missing from scoreMap is skipped, not crashed", () => {
    const partialMap = new Map([
      ["automation", { score: 89, executionScore: null }],
    ]);
    const result = rankNextActions(fixtureRubric, partialMap, {}, 10);
    expect(result.every((a) => a.dimId === "automation")).toBe(true);
  });

  it("axis ordering: unknown axis values sort with 'either' (tier 2)", () => {
    const fixture = {
      dimensions: [
        {
          id: "a",
          weight: 1,
          nextActions: [
            { id: "platform-action", action: "p", axis: "platform" },
            { id: "unknown-action",  action: "u", axis: "novel-tier" },
          ],
        },
      ],
    };
    const scoreMap = new Map([["a", { score: 50, executionScore: 50 }]]);
    const result = rankNextActions(fixture, scoreMap, {}, 10);
    // Both rank=1*50=50; axis tiebreak: platform(0) before novel-tier(2).
    expect(result.map((r) => r.actionId)).toEqual(["platform-action", "unknown-action"]);
  });
});
```

- [ ] **Step 2: Run Tasks 3 + 4 tests**

```bash
npx vitest run scripts/__tests__/rank-next-actions.test.mjs
```

Expected: all 9 tests pass, including the NAMED REGRESSION.

- [ ] **Step 3: Commit Tasks 3 + 4 together**

```bash
git add scripts/rank-next-actions.mjs scripts/__tests__/rank-next-actions.test.mjs
git commit -m "feat(ranker): add rankNextActions — filters satisfied predicates, bakes top-10

Named regression: loopCommandUses=14 no longer surfaces >=1 action as TODO.
Tie-breaking: rank desc → axis(P/X/E) → weight → dimId → actionId."
```

---

## Task 5: Modify `app/lib/assessment.ts` — 1-line passthrough

**Files:**

- Read + Modify: `app/lib/assessment.ts`

Find the local `evaluatePredicate` implementation block (currently around lines 165–259 — the `readPath`, `isTruthy`, `evaluateAtomic`, `evaluatePredicate` functions). Replace the entire block with a single re-export from `scripts/predicate.mjs`.

**Exact replacement approach:**

- Locate the comment `// ---------------------------------------------------------------------------` that introduces the predicate engine section.
- Remove everything from that divider through the closing `evaluatePredicate` function body.
- Insert in its place:

```typescript
// ---------------------------------------------------------------------------
// Predicate engine — satisfiedWhen DSL
// ---------------------------------------------------------------------------
// Canonical implementation lives in scripts/predicate.mjs so Node-side
// callers (run-assessment.mjs, etc.) and the Next.js dashboard share one
// source of truth. Do not duplicate — see app/lib/__tests__/predicate-passthrough.test.ts.
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };

// ---------------------------------------------------------------------------
```

- [ ] **Step 1: Apply the edit** (use the Read tool to confirm line numbers before editing)

- [ ] **Step 2: Verify Next.js build still compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors related to `evaluatePredicate`. If Next.js 16 / Node 22+ rejects the `.mjs` import from `.ts`, add `// @ts-ignore` above the import line (the passthrough test pins correctness at runtime).

- [ ] **Step 3: Run the full test suite** (catches any dashboard regression)

```bash
npx vitest run
```

Expected: same pass count as before this task (no new failures).

---

## Task 6: Create `app/lib/__tests__/predicate-passthrough.test.ts`

**Files:**

- Create: `app/lib/__tests__/predicate-passthrough.test.ts`

This test asserts reference equality: `fromTs === fromMjs`. Any future contributor who copies the implementation instead of re-exporting fails CI immediately.

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
// @ts-expect-error — .mjs has no type declarations; intentional
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

describe("evaluatePredicate — TS/MJS passthrough", () => {
  it("TS export is reference-equal to the MJS source", () => {
    expect(fromTs).toBe(fromMjs);
  });
});
```

- [ ] **Step 2: Run the passthrough test**

```bash
npx vitest run app/lib/__tests__/predicate-passthrough.test.ts
```

Expected: 1 test passes. If it fails, the assessment.ts edit in Task 5 is not a true passthrough — fix before continuing.

- [ ] **Step 3: Commit Tasks 5 + 6**

```bash
git add app/lib/assessment.ts app/lib/__tests__/predicate-passthrough.test.ts
git commit -m "refactor(assessment): evaluatePredicate → 1-line passthrough from scripts/predicate.mjs

Passthrough test (reference equality) added as CI tripwire.
Removes ~95 lines of duplicated evaluator from app/lib/assessment.ts."
```

---

## Task 7: Modify `scripts/run-assessment.mjs` — attach `rankedNextActions`

**Files:**

- Read + Modify: `scripts/run-assessment.mjs`

Two changes:

1. **Import `rankNextActions`** at the top of the file, alongside the other script imports.
2. **Call it** after `scoreAll` and `buildSignalsSummary`, then attach the result to the assessment object before writing `assessment.json`.

- [ ] **Step 1: Add the import**

Find the block of local script imports (e.g. near `import { gatherSignals } from "./signals.mjs";`). Add:

```javascript
import { rankNextActions } from "./rank-next-actions.mjs";
```

- [ ] **Step 2: Locate where `assessment.json` is constructed**

Search for where the `assessment` object is built — it will have fields like `capturedAt`, `overall`, `dimensions`, `signalsSummary`. Find that construction point.

- [ ] **Step 3: Build the `scoreMap` and call `rankNextActions`**

Immediately before or after `signalsSummary` is derived (but before the assessment object is frozen/written), add:

```javascript
// Build scoreMap for the ranker: Map<dimId, { score, executionScore }>.
const scoreMap = new Map(
  scores.map((s) => [s.id, { score: s.score, executionScore: s.executionScore ?? null }]),
);
const rankedNextActions = rankNextActions(rubric, scoreMap, signalsSummary, 10);
```

(Adjust variable names to match what `scoreAll` actually returns in this file — `scores` may be named differently.)

- [ ] **Step 4: Attach to the assessment object**

In the assessment object literal, add:

```javascript
rankedNextActions,
```

The field appears at the top level, alongside `dimensions`, `signalsSummary`, etc.

- [ ] **Step 5: Verify the field is written**

```bash
npm run assess:print --no-slack 2>&1 | head -5
node -e "
  const a = JSON.parse(require('fs').readFileSync('app/data/assessment.json','utf8'));
  console.assert(Array.isArray(a.rankedNextActions), 'rankedNextActions must be an array');
  console.assert(a.rankedNextActions.length <= 10, 'limit enforced');
  console.log('rankedNextActions:', a.rankedNextActions.length, 'entries');
  if (a.rankedNextActions.length) {
    const first = a.rankedNextActions[0];
    console.log('top:', first.dimId, '/', first.actionId, 'rank', first.rank);
  }
"
```

Expected: array printed with ≤ 10 entries; top entry makes intuitive sense for your current Platform Setup score.

- [ ] **Step 6: Verify the original triggering bug is fixed**

```bash
node -e "
  const a = JSON.parse(require('fs').readFileSync('app/data/assessment.json','utf8'));
  const s = a.signalsSummary;
  const loops = s.loopCommandUses ?? 0;
  const inRanked = a.rankedNextActions.some(r => r.satisfiedWhen === 'loopCommandUses>=1');
  if (loops >= 1 && inRanked) {
    console.error('BUG: loopCommandUses=' + loops + ' but babysit-loop action still surfaces');
    process.exit(1);
  }
  console.log('loopCommandUses=' + loops + ', babysit-loop in ranked=' + inRanked + ' ✓');
"
```

Expected: no `BUG:` line. If `loopCommandUses < 1` the action will legitimately appear.

- [ ] **Step 7: Run the full test suite**

```bash
npx vitest run
```

Expected: green. Any `run-assessment` snapshot test that previously had no `rankedNextActions` field will need its fixture updated — do that now rather than deferring.

- [ ] **Step 8: Commit**

```bash
git add scripts/run-assessment.mjs
git commit -m "feat(run-assessment): bake rankedNextActions[10] into assessment.json

Calls rankNextActions after scoring; attaches pre-filtered + pre-sorted
top-10 to written assessment. Closes the bug where /self-assessment
re-implemented DSL filtering and missed string predicates."
```

---

## Task 8: Update `.claude/skills/self-assessment/SKILL.md`

**Files:**

- Read + Modify: `.claude/skills/self-assessment/SKILL.md`

Two changes in one edit:

1. **Delete the PR 1 grammar block** (`satisfiedWhen DSL grammar` sub-block under `Top 3 priority actions`). It is now obsolete — the evaluator runs before the skill is even invoked.
2. **Replace the "first filter, then rank" instruction** with a simpler reader instruction: "Read `assessment.json.rankedNextActions[0..2]` — already filtered (satisfied actions dropped) and sorted by `weight × deficit`."

- [ ] **Step 1: Read the current SKILL.md** to find the exact lines to change

- [ ] **Step 2: Apply the edits**

Find the existing instruction text around `Top 3 priority actions`. Replace the multi-step filter+rank instruction and the DSL grammar block with:

```markdown
**Top 3 priority actions:** Read `assessment.json` → `rankedNextActions[0]`, `[1]`, `[2]`.
These are already filtered (satisfied actions excluded) and ranked by `weight × deficit`.
Report each as: dimension · action text · effort · Boris tip (if present).
```

- [ ] **Step 3: Verify no grammar block remains**

```bash
grep -n "satisfiedWhen DSL grammar" .claude/skills/self-assessment/SKILL.md
```

Expected: no output. If the line appears, the grammar block was not fully removed.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/self-assessment/SKILL.md
git commit -m "chore(skill): replace filter+rank instruction with reader of pre-baked rankedNextActions

Deletes PR #104 DSL grammar block (now obsolete). Skill reads
assessment.json.rankedNextActions[0..2] directly — no DSL evaluation,
no hand-rolled filter logic."
```

---

## Task 9: Update `CLAUDE.md` — file map + hard rule

**Files:**

- Read + Modify: `CLAUDE.md`

Two changes:

1. **File map** (`## Where things live`): add `scripts/predicate.mjs` and `scripts/rank-next-actions.mjs` to the `scripts/` listing.
2. **Hard rules** (`## Hard rules`): add the "DSL evaluator has one source" rule and the "Ranked next-actions live in `assessment.json.rankedNextActions`" rule.

- [ ] **Step 1: Add to file map**

In the `scripts/` table, add after `score.mjs`:

```
  predicate.mjs          # canonical satisfiedWhen DSL evaluator (TS re-exports from here)
  rank-next-actions.mjs  # filtered+sorted top-N next-actions; output goes into assessment.json
```

- [ ] **Step 2: Add hard rules**

In `## Hard rules`, add two entries:

**Rule 1 — DSL evaluator source:**

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical. `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough re-export — never copy the implementation. Test `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.

**Rule 2 — Ranked next-actions:**

> **Ranked next-actions live in `assessment.json.rankedNextActions`.** The self-assessment skill must NEVER hand-implement the satisfiedWhen filter or the weight×deficit ranking. Read the pre-computed top-10 from the written file. The 2026-05-31 cycle landed this contract; surfacing a satisfied action as a TODO again is a regression — fix the data layer, not the report.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): add predicate.mjs + rank-next-actions.mjs to file map; add two hard rules"
```

---

## Task 10: Update `app/data/rubric.json` — `$schema` comment

**Files:**

- Read + Modify: `app/data/rubric.json`

Find the `$schema` comment at the top of the file (or inside the root object). It currently references `app/lib/assessment.ts` as the canonical evaluator. Update the one phrase to say `scripts/predicate.mjs`.

- [ ] **Step 1: Locate the comment**

```bash
grep -n "evaluatePredicate\|predicate\|satisfiedWhen" app/data/rubric.json | head -5
```

- [ ] **Step 2: Update the reference**

Change any occurrence of `app/lib/assessment.ts:evaluatePredicate` or `app/lib/assessment.ts` (in the context of the evaluator comment) to `scripts/predicate.mjs`.

- [ ] **Step 3: Commit**

```bash
git add app/data/rubric.json
git commit -m "chore(rubric): update \$schema comment — canonical evaluator is scripts/predicate.mjs"
```

---

## Task 11: Final gate — full test suite + fixture audit

- [ ] **Step 1: Run the full suite**

```bash
npx vitest run
```

Expected: green, count ≥ pre-PR count (net additions only — no tests removed). Record the final test count.

- [ ] **Step 2: Run `npm run assess:print` end-to-end**

```bash
npm run assess:print --no-slack
```

Expected: clean output; `rankedNextActions` printed or confirmed in the JSON. Top 3 priority actions match your intuition about your own Platform Setup state. No action that you know is already done appears in the top 3.

- [ ] **Step 3: Verify `loopCommandUses>=1` regression one final time against live data**

Run the node one-liner from Task 7 Step 6 again against the freshly-written `assessment.json`.

- [ ] **Step 4: Confirm no SKILL.md grammar block survives**

```bash
grep -c "satisfiedWhen DSL grammar" .claude/skills/self-assessment/SKILL.md
```

Expected: `0`.

- [ ] **Step 5: Create the PR**

```bash
git push -u origin <branch-name>
gh pr create \
  --title "feat(predicate): extract evaluatePredicate to scripts/predicate.mjs + bake rankedNextActions — CCE-N" \
  --base main \
  --body-file /tmp/pr-body.md
```

Write `/tmp/pr-body.md` first (block-destructive blocks heredocs with `rm -rf` in body; use `--body-file` pattern per CLAUDE.md conventions).

---

## Done when

- [ ] `scripts/predicate.mjs` exists and exports `evaluatePredicate`
- [ ] `scripts/rank-next-actions.mjs` exports `rankNextActions`
- [ ] `app/lib/assessment.ts:evaluatePredicate` is a 1-line passthrough; passthrough test is green
- [ ] `app/data/assessment.json.rankedNextActions` is an array of ≤ 10 entries after every `npm run assess`
- [ ] The named regression test (`NAMED REGRESSION: loopCommandUses=14`) is in the test suite and passes
- [ ] The PR 1 SKILL.md grammar block is deleted; SKILL.md reads `rankedNextActions[0..2]`
- [ ] CLAUDE.md carries both new hard rules
- [ ] Full `npx vitest run` is green
