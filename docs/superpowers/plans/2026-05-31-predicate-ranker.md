# Predicate evaluator + ranked next-actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "model re-implements the DSL" bug class by (PR 1) documenting the `satisfiedWhen` DSL grammar inside the self-assessment skill, then (PR 2) extracting `evaluatePredicate` to `scripts/predicate.mjs`, baking a filtered + ranked `rankedNextActions[10]` into `assessment.json`, and turning the skill into a trivial reader.

**Architecture:** PR 1 is a single additive edit to `.claude/skills/self-assessment/SKILL.md`. PR 2 introduces `scripts/predicate.mjs` as the canonical DSL evaluator (TypeScript `app/lib/assessment.ts` becomes a 1-line passthrough re-export), adds a `rankNextActions(rubric, scoreMap, signalsSummary, limit)` helper in `scripts/run-assessment.mjs`, and writes the ranked list to `app/data/assessment.json`. SKILL.md is then simplified to read the pre-computed field, and the PR 1 grammar block is deleted as obsolete.

**Tech Stack:** Node 22+ ESM, TypeScript (re-export only), Vitest, no new runtime dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`.

---

## Pre-flight (do once before Task 1)

- [ ] **Confirm current branch is `feat/skill-dsl-grammar`** (spec already committed at `fee92e5`).

```bash
git branch --show-current
# Expected: feat/skill-dsl-grammar

git log -1 --oneline
# Expected: fee92e5 docs(spec): predicate evaluator + ranked next-actions design
```

- [ ] **Confirm baseline tests pass.**

```bash
npx vitest run
# Expected: Test Files <N> passed (<N>), Tests <N> passed (<N>)
# Record the pre-change counts; PR 1 adds 0 tests, PR 2 adds 25+.
```

---

## PR 1 — Tactical SKILL.md DSL grammar

### Task 1: Add the `satisfiedWhen` DSL grammar block to the self-assessment skill

**Files:**

- Modify: `.claude/skills/self-assessment/SKILL.md`

- [ ] **Step 1: Read the file to locate the insertion point.**

```bash
grep -n "Top 3 priority actions" .claude/skills/self-assessment/SKILL.md
# Expected: a single hit on the bullet that starts "- Top 3 priority actions, noting which axis..."
```

The new block goes immediately AFTER that bullet's existing single line, indented as a sub-paragraph of the same bullet.

- [ ] **Step 2: Insert the grammar block.**

Use the Edit tool. Locate the unique anchor:

```
Unpredicated actions stay in the pool — they're behavioral coaching that can't be auto-detected.
```

Replace with:

```
Unpredicated actions stay in the pool — they're behavioral coaching that can't be auto-detected.

  **`satisfiedWhen` DSL grammar** (string predicates evaluated against `signalsSummary`):
  - `path` — truthy (non-null, non-zero, non-empty)
  - `!path` — falsy
  - `path>=N` / `<=N` / `>N` / `<N` — numeric comparison
  - `path=v` or `path=v|w|x` — equals (or equals one of)
  - `path!=v` — not equals
  - `path~regex` — array-of-strings element matches regex (case-insensitive)
  - `A & B` — AND of two or more atoms

  Canonical implementation: `app/lib/assessment.ts:evaluatePredicate`. Example: `loopCommandUses>=1` with `signalsSummary.loopCommandUses=14` evaluates to **true** → filter the action out, do not surface as a TODO.
```

- [ ] **Step 3: Run the full test suite.**

```bash
npx vitest run
# Expected: same Test Files / Tests counts as the baseline (this is a docs-only change).
```

- [ ] **Step 4: Commit.**

```bash
git add .claude/skills/self-assessment/SKILL.md
git commit -m "$(cat <<'EOF'
docs(skill): add satisfiedWhen DSL grammar to /self-assessment

Tactical fix for the recurring "model re-implements the DSL filter"
bug class. The skill instructs models to "first filter, then rank"
next-actions, but the DSL grammar lived only in
app/lib/assessment.ts. A model running the skill in 2026-05-31
hand-wrote a filter that expected an object shape and skipped string
predicates, surfacing the already-satisfied babysit-loop action as a
top-3 priority despite loopCommandUses=14.

This stopgap inlines the grammar reference so a careful model can
evaluate correctly until PR 2 ships the structural fix (extract
evaluator + bake rankedNextActions into assessment.json), at which
point this block will be deleted.

See docs/superpowers/specs/2026-05-31-predicate-ranker-design.md.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Run `/ship` (full chain: test → verify → simplify → review → push → PR → Jira).**

```
/ship
```

Expected: PR opened against `main`, CI passes, squash-merged, local main fast-forwarded.

**After PR 1 merges:** sync local main, then start PR 2 from a fresh branch.

```bash
git checkout main && git pull --ff-only
git checkout -b feat/predicate-ranker-structural
```

---

## PR 2 — Structural extract + bake `rankedNextActions`

### Task 2: Create `scripts/predicate.mjs` (TDD — failing test first)

**Files:**

- Create: `scripts/__tests__/predicate.test.mjs`
- Create: `scripts/predicate.mjs`

- [ ] **Step 1: Write the failing test file.** This covers every operator class and includes the rubric integration test (parse every production `satisfiedWhen` without throwing).

Create `scripts/__tests__/predicate.test.mjs`:

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

  it("missing numeric signal treated as 0", () => {
    expect(evaluatePredicate("x>=1", {})).toBe(false);
    expect(evaluatePredicate("x<=0", {})).toBe(true);
  });

  it("= : exact equality (string and numeric)", () => {
    expect(evaluatePredicate("x=foo", { x: "foo" })).toBe(true);
    expect(evaluatePredicate("x=foo", { x: "bar" })).toBe(false);
    expect(evaluatePredicate("x=5", { x: 5 })).toBe(true);
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
    expect(evaluatePredicate("x>0 & y>0 & z>0", { x: 1, y: 1, z: 1 })).toBe(
      true,
    );
    expect(evaluatePredicate("x>0 & y>0 & z>0", { x: 1, y: 1, z: 0 })).toBe(
      false,
    );
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

- [ ] **Step 2: Run the test — confirm it fails because `predicate.mjs` doesn't exist.**

```bash
npx vitest run scripts/__tests__/predicate.test.mjs
# Expected: FAIL — "Cannot find module ../predicate.mjs"
```

- [ ] **Step 3: Create `scripts/predicate.mjs` (port from `app/lib/assessment.ts:165–259`).**

```javascript
// Pure-ESM port of the satisfiedWhen DSL evaluator. Canonical implementation
// shared between scripts/run-assessment.mjs and the Next.js dashboard
// (app/lib/assessment.ts re-exports from here as a 1-line passthrough).
//
// Grammar (mirrors app/data/rubric.json $schema comment):
//   path                — truthy (non-null, non-zero, non-empty)
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
      case ">":
        return num > rhsNum;
      case ">=":
        return num >= rhsNum;
      case "<":
        return num < rhsNum;
      case "<=":
        return num <= rhsNum;
      default:
        return false;
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

- [ ] **Step 4: Run the test — confirm it passes.**

```bash
npx vitest run scripts/__tests__/predicate.test.mjs
# Expected: PASS — 18+ tests pass
```

- [ ] **Step 5: Run the full suite to confirm nothing else broke.**

```bash
npx vitest run
# Expected: all green; new tests show as +18 vs baseline
```

- [ ] **Step 6: Commit.**

```bash
git add scripts/predicate.mjs scripts/__tests__/predicate.test.mjs
git commit -m "$(cat <<'EOF'
feat(scripts): extract evaluatePredicate to predicate.mjs

Port the satisfiedWhen DSL evaluator from app/lib/assessment.ts to a
pure-ESM module so Node-side callers (run-assessment.mjs, future
Slack post, console output) can share the canonical implementation.

The TS file's evaluatePredicate is unchanged in this commit — it
becomes a 1-line passthrough re-export in the next task. This commit
just adds the new module + 18 operator-coverage tests + a rubric
integration test that parses every production satisfiedWhen without
throwing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Re-export from TypeScript + add equivalence test

**Files:**

- Create: `app/lib/__tests__/predicate-passthrough.test.ts`
- Modify: `app/lib/assessment.ts` (replace lines 165–259 with re-export)

- [ ] **Step 1: Write the failing equivalence test.**

Create `app/lib/__tests__/predicate-passthrough.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
// @ts-expect-error — .mjs has no type declarations; this is intentional
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

describe("evaluatePredicate — TS/MJS passthrough", () => {
  it("TS export is reference-equal to the MJS source", () => {
    expect(fromTs).toBe(fromMjs);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails because TS still has its own definition.**

```bash
npx vitest run app/lib/__tests__/predicate-passthrough.test.ts
# Expected: FAIL — expected [Function fromTs] to be [Function fromMjs]
```

- [ ] **Step 3: Replace the local implementation in `app/lib/assessment.ts`.**

Find these blocks (currently at lines 161–259):

```typescript
// ---------------------------------------------------------------------------
// Predicate engine — satisfiedWhen DSL
// ---------------------------------------------------------------------------

function readPath(obj: unknown, path: string): unknown {
  // ... 10+ lines ...
}

function isTruthy(v: unknown): boolean {
  // ... 10+ lines ...
}

function evaluateAtomic(
  expr: string,
  signals: Record<string, unknown>,
): boolean {
  // ... 50+ lines ...
}

export function evaluatePredicate(
  expr: string,
  signals: Record<string, unknown>,
): boolean {
  if (!expr || !expr.trim()) return false;
  const atoms = expr
    .split("&")
    .map((s) => s.trim())
    .filter(Boolean);
  if (atoms.length === 0) return false;
  return atoms.every((atom) => evaluateAtomic(atom, signals));
}
```

Replace ALL of that with a single comment + re-export:

```typescript
// ---------------------------------------------------------------------------
// Predicate engine — satisfiedWhen DSL
// ---------------------------------------------------------------------------
// Canonical implementation lives in scripts/predicate.mjs so Node-side
// callers (run-assessment.mjs, etc.) and the Next.js dashboard share one
// source of truth. Do not duplicate — see app/lib/__tests__/predicate-passthrough.test.ts.
export { evaluatePredicate } from "../../scripts/predicate.mjs";
```

- [ ] **Step 4: Run the equivalence test — confirm it passes.**

```bash
npx vitest run app/lib/__tests__/predicate-passthrough.test.ts
# Expected: PASS — 1 test passes
```

- [ ] **Step 5: Run the full suite to confirm no dashboard render regressions.**

```bash
npx vitest run
# Expected: all green. Existing methodology/probes and dimensions/[id] tests
# continue to pass because evaluatePredicate's signature and behavior are
# identical (same function, just re-exported).
```

- [ ] **Step 6: Confirm the Next.js production build still type-checks and bundles.**

```bash
npm run build
# Expected: ✓ Compiled successfully — no TS errors, no module resolution errors.
```

- [ ] **Step 7: Commit.**

```bash
git add app/lib/assessment.ts app/lib/__tests__/predicate-passthrough.test.ts
git commit -m "$(cat <<'EOF'
refactor(lib): re-export evaluatePredicate from scripts/predicate.mjs

Collapse app/lib/assessment.ts's local DSL evaluator into a 1-line
passthrough re-export. A new equivalence test asserts the TS and MJS
exports are reference-equal — a future contributor who copies the
implementation instead of re-exporting fails CI.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Implement `rankNextActions` with TDD

**Files:**

- Create: `scripts/__tests__/rank-next-actions.test.mjs`
- Create: `scripts/rank-next-actions.mjs`

- [ ] **Step 1: Write the failing test file.**

Create `scripts/__tests__/rank-next-actions.test.mjs`:

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
          // no satisfiedWhen → unpredicated coaching, axis defaults to "either"
        },
        {
          id: "missing-action-text",
          // no action field → malformed, must be skipped
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
      loopCommandUses: 0, // babysit-loop NOT satisfied
      scheduleCommandUses: 0, // promote-routine NOT satisfied
      hasFormatterHook: false, // formatter-hook NOT satisfied
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
    expect(
      rankNextActions(fixtureRubric, makeScoreMap(), signals, 2),
    ).toHaveLength(2);
    expect(
      rankNextActions(fixtureRubric, makeScoreMap(), signals, 0),
    ).toHaveLength(0);
  });

  it("tie-breaking is deterministic: rank → axis → weight → dimId → actionId", () => {
    const signals = {};
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    // Both scheduled actions have rank=50, axis=platform, weight=2.
    // Tie-break falls to dimId then actionId — both share dimId=scheduled,
    // so actionId ascending: babysit-loop < promote-routine.
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
    // Only automation actions appear (scheduled and remote skipped).
    expect(result.every((a) => a.dimId === "automation")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails because the module doesn't exist.**

```bash
npx vitest run scripts/__tests__/rank-next-actions.test.mjs
# Expected: FAIL — "Cannot find module ../rank-next-actions.mjs"
```

- [ ] **Step 3: Implement `scripts/rank-next-actions.mjs`.**

Create the file:

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

- [ ] **Step 4: Run the test — confirm it passes.**

```bash
npx vitest run scripts/__tests__/rank-next-actions.test.mjs
# Expected: PASS — 9 tests pass
```

- [ ] **Step 5: Run the full suite.**

```bash
npx vitest run
# Expected: all green; +9 tests vs prior step.
```

- [ ] **Step 6: Commit.**

```bash
git add scripts/rank-next-actions.mjs scripts/__tests__/rank-next-actions.test.mjs
git commit -m "$(cat <<'EOF'
feat(scripts): add rankNextActions for filtered+sorted top-N list

New scripts/rank-next-actions.mjs filters out satisfied actions and
sorts the remainder by weight × deficit, with deterministic
tie-breaking (rank → axis → weight → dimId → actionId).

Test suite includes a named regression for the 2026-05-31 bug:
loopCommandUses=14 must exclude the babysit-loop action whose
satisfiedWhen is "loopCommandUses>=1".

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire `rankNextActions` into `run-assessment.mjs`

**Files:**

- Modify: `scripts/run-assessment.mjs` (add import + add field to assessment object)
- Modify: `scripts/__tests__/run-assessment.test.mjs` (or create if absent — see Step 1)

- [ ] **Step 1: Locate the existing run-assessment test file and add the assertion.**

```bash
ls scripts/__tests__/run-assessment*.test.mjs 2>&1
```

If a test exists, ADD this test block to it. If not, CREATE `scripts/__tests__/run-assessment-ranking.test.mjs`:

```javascript
import { describe, it, expect } from "vitest";
import { makeSignals, makeRubric } from "./_fixtures.mjs";
import { scoreAll } from "../score.mjs";
import { rankNextActions } from "../rank-next-actions.mjs";

describe("rankNextActions integration with scoreAll output", () => {
  it("produces ≤10 ranked entries from a real scored result", () => {
    const rubric = makeRubric();
    const signals = makeSignals();
    const scored = scoreAll(rubric, signals);
    const scoreMap = new Map(scored.scores.map((s) => [s.id, s]));
    const ranked = rankNextActions(rubric, scoreMap, signals, 10);
    expect(Array.isArray(ranked)).toBe(true);
    expect(ranked.length).toBeLessThanOrEqual(10);
    if (ranked.length > 0) {
      expect(ranked[0]).toMatchObject({
        dimId: expect.any(String),
        actionId: expect.any(String),
        rank: expect.any(Number),
      });
    }
  });

  it("ranking is stable across two identical runs (determinism)", () => {
    const rubric = makeRubric();
    const signals = makeSignals();
    const scored = scoreAll(rubric, signals);
    const scoreMap = new Map(scored.scores.map((s) => [s.id, s]));
    const a = rankNextActions(rubric, scoreMap, signals, 10);
    const b = rankNextActions(rubric, scoreMap, signals, 10);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run the new test — confirm it fails or passes per current state.**

```bash
npx vitest run scripts/__tests__/run-assessment-ranking.test.mjs
# Expected: PASS — rankNextActions is already callable; this just locks in
# the integration shape against the real fixture rubric.
```

If makeRubric / scoreAll fixture shape rejects rankNextActions usage, fix the fixture (don't weaken the assertion).

- [ ] **Step 3: Modify `scripts/run-assessment.mjs` — add the import.**

Near the top of the file, alongside other imports from `./score.mjs` / `./signals.mjs`:

```javascript
import { rankNextActions } from "./rank-next-actions.mjs";
```

- [ ] **Step 4: Modify the assessment object assembly (around line 325).**

Locate this block:

```javascript
const assessment = {
  ...scored,
  trends,
  signalsSummary: buildSignalsSummary(signals),
  insights: signals.insights,
  claudeMd: claudeMdRuns.length
    ? {
        mode: "report-only",
        auditedAt: new Date().toISOString(),
        summary: summarize(claudeMdRuns),
        runs: claudeMdRuns,
      }
    : null,
  user: config?.user?.displayName || null,
};
```

Add `rankedNextActions` immediately after `signalsSummary`:

```javascript
const signalsSummary = buildSignalsSummary(signals);
const scoreMap = new Map(scored.scores.map((s) => [s.id, s]));
const assessment = {
  ...scored,
  trends,
  signalsSummary,
  rankedNextActions: rankNextActions(rubric, scoreMap, signalsSummary, 10),
  insights: signals.insights,
  claudeMd: claudeMdRuns.length
    ? {
        mode: "report-only",
        auditedAt: new Date().toISOString(),
        summary: summarize(claudeMdRuns),
        runs: claudeMdRuns,
      }
    : null,
  user: config?.user?.displayName || null,
};
```

(The change extracts `signalsSummary` to a local variable so both consumers reference it; computes a `scoreMap` from `scored.scores`; inserts the new field.)

- [ ] **Step 5: Run the assessment with `--no-write` to confirm it composes correctly.**

```bash
node scripts/run-assessment.mjs --include-transcripts --insights-lookback 30 --no-write 2>&1 | head -5
# Expected: prints the same header as before — Platform/Execution scores — no crash.
```

- [ ] **Step 6: Run the full assessment once for real and inspect the output.**

```bash
npm run assess -- --include-transcripts --insights-lookback 30
node -e "const a = require('./app/data/assessment.json'); console.log('length:', a.rankedNextActions.length); console.log('top:', a.rankedNextActions[0]);"
# Expected: length: <=10, top entry has dimId/actionId/rank/action/etc.
```

- [ ] **Step 7: Run the full test suite — all green.**

```bash
npx vitest run
# Expected: all green; new run-assessment integration tests pass.
```

- [ ] **Step 8: Commit.**

```bash
git add scripts/run-assessment.mjs scripts/__tests__/run-assessment-ranking.test.mjs
git commit -m "$(cat <<'EOF'
feat(assess): write rankedNextActions[10] to assessment.json

Pre-compute the filtered + ranked top-10 next-actions once per run
and attach to the written assessment. Skill, dashboard, Slack post,
console — all consume the same field, eliminating per-consumer
re-implementation drift.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Simplify the self-assessment skill, update rubric and CLAUDE.md

**Files:**

- Modify: `.claude/skills/self-assessment/SKILL.md` (delete PR 1 grammar block, simplify the instruction)
- Modify: `app/data/rubric.json` (one phrase in `$schema` comment)
- Modify: `CLAUDE.md` (file map + new hard rule)

- [ ] **Step 1: Read the current SKILL.md to find the "Top 3 priority actions" bullet.**

```bash
grep -nA 12 "Top 3 priority actions" .claude/skills/self-assessment/SKILL.md
```

You should see the original sentence followed by the grammar block PR 1 added.

- [ ] **Step 2: Replace the entire bullet (sentence + grammar block) with the simpler version.**

Use the Edit tool. Locate the anchor text that begins with:

```
- Top 3 priority actions, noting which axis each falls on.
```

…and continues through the end of the grammar block (the line ending with `do not surface as a TODO.`).

Replace ALL of that with:

```
- Top 3 priority actions, noting which axis each falls on. Read `assessment.json.rankedNextActions[0..2]` — already filtered (satisfied actions dropped) and ranked by `weight × deficit` by `scripts/rank-next-actions.mjs`. Each entry carries `dimId`, `actionId`, `axis`, `weight`, `deficit`, `rank`, `action`, `effort`, `borisTip`, `satisfiedWhen`.
```

- [ ] **Step 3: Update `app/data/rubric.json` `$schema` comment.**

Find this phrase in the long `$schema` value:

```
satisfiedWhen is a predicate evaluated against signalsSummary at load time
```

Replace with:

```
satisfiedWhen is a predicate evaluated by scripts/predicate.mjs against signalsSummary
```

- [ ] **Step 4: Update `CLAUDE.md` file map.**

Find this anchor in the `## Where things live` block:

```
  score.mjs              # rules → scores, normalize() per dim
  progression.mjs        # telemetry milestone walker — self-dated from session start_time
```

Insert one line between them:

```
  score.mjs              # rules → scores, normalize() per dim
  predicate.mjs          # canonical satisfiedWhen DSL evaluator (TS re-exports from here)
  rank-next-actions.mjs  # filtered+sorted top-N next-actions; output goes into assessment.json
  progression.mjs        # telemetry milestone walker — self-dated from session start_time
```

- [ ] **Step 5: Add the new CLAUDE.md hard rule.**

Locate `## Hard rules` (the section header). Append at the END of the rules list:

```
- **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
  `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough
  re-export — never copy the implementation. Test
  `app/lib/__tests__/predicate-passthrough.test.ts` asserts the two are
  reference-equal; a duplicate fails CI. When the DSL grammar evolves, edit
  `scripts/predicate.mjs` and the rubric `$schema` comment — never the TS file.
- **Ranked next-actions live in `assessment.json.rankedNextActions`.** The
  self-assessment skill must NEVER hand-implement the satisfiedWhen filter
  or the weight×deficit ranking. Read the pre-computed top-10 from the
  written file. The 2026-05-31 cycle landed this contract; surfacing a
  satisfied action as a TODO again is a regression — fix the data layer,
  not the report.
```

- [ ] **Step 6: Run the full test suite.**

```bash
npx vitest run
# Expected: all green.
```

- [ ] **Step 7: Spot-check the dashboard renders.**

```bash
curl -sf -o /dev/null -w "%{http_code}\n" http://localhost:3737/methodology/probes
# Expected: 200 (dev server still running from earlier; if not, npm run dev)
```

- [ ] **Step 8: Commit.**

```bash
git add .claude/skills/self-assessment/SKILL.md app/data/rubric.json CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: simplify /self-assessment to read pre-computed rankedNextActions

PR 2 of 2 lands the structural fix. The skill no longer needs the
DSL grammar block (PR 1's stopgap) — it just reads
assessment.json.rankedNextActions[0..2] and reports.

Also adds CLAUDE.md hard rules pinning the new contract: predicate
evaluator has one source (scripts/predicate.mjs, TS re-exports),
ranked next-actions come from assessment.json, never re-implement.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `/ship` PR 2

- [ ] **Step 1: Confirm working tree is clean.**

```bash
git status --short
# Expected: empty (all changes committed across Tasks 2-6).
```

- [ ] **Step 2: Run `/ship`.**

```
/ship
```

Expected stages and outcomes:

- **Stage 1 (Test):** `npx vitest run` — all green (~25 new tests vs baseline).
- **Stage 2 (Verify-agent):** Confirms the named regression test exists, the equivalence test exists, and the rankedNextActions field appears in `assessment.json`.
- **Stage 3 (Simplify):** Reviews recent diffs for redundancy. Expected: no findings (we wrote tight, focused changes).
- **Stage 4 (Code review):** General-purpose reviewer subagent. Expected: no Critical or Important findings.
- **Stage 5 (Commit):** Already committed; skipped or no-op.
- **Stage 6 (Push + PR):** Pushes `feat/predicate-ranker-structural`, opens PR via `gh pr create --body-file` (heredoc bodies are blocked per CLAUDE.md).
- **Stage 7 (Jira):** No CCE ticket linked (the bug was discovered ad-hoc in a session). Silent-skip.

- [ ] **Step 3: After CI passes, squash-merge.**

```bash
gh pr merge <PR-number> --squash --delete-branch
gh pr view <PR-number> --json state,mergeCommit
# Expected: state: MERGED, mergeCommit.oid: <SHA>
```

- [ ] **Step 4: Sync local main + clean up worktree refs.**

```bash
git checkout main && git pull --ff-only
git fetch --prune
# Expected: main fast-forwards to the new squash commit.
```

- [ ] **Step 5: Final validation — run /self-assessment using the new contract.**

```bash
npm run assess -- --include-transcripts --insights-lookback 30
node -e "
const a = require('./app/data/assessment.json');
console.log('top 3 ranked next-actions:');
for (const x of a.rankedNextActions.slice(0, 3)) {
  console.log('  -', x.dimId + '/' + x.actionId, '(rank', x.rank + ',', x.axis + ')', '— satisfiedWhen:', x.satisfiedWhen);
}
"
# Expected: top 3 are the legitimate gaps. babysit-loop / stop-hook-notification
# do NOT appear (satisfiedWhen evaluates true for current signals).
```

If the legacy bug recurs — `babysit-loop` appears in top 3 despite `loopCommandUses >= 1` — STOP and re-open the spec. Otherwise: done.

---

## Acceptance criteria (whole plan)

- [ ] PR 1 merged: `.claude/skills/self-assessment/SKILL.md` contains the DSL grammar block.
- [ ] PR 2 merged with:
  - `scripts/predicate.mjs` created
  - `scripts/rank-next-actions.mjs` created
  - `app/lib/assessment.ts:evaluatePredicate` is a 1-line passthrough
  - `app/data/assessment.json` contains `rankedNextActions[]` (length ≤10)
  - `.claude/skills/self-assessment/SKILL.md` PR 1 grammar block removed; replaced with the read-the-pre-computed-field instruction
  - CLAUDE.md gains the two new hard rules
- [ ] Test suite up by ~25–30 tests vs baseline, all green.
- [ ] Named regression test (`loopCommandUses=14 excludes loopCommandUses>=1 action`) passes.
- [ ] TS↔MJS equivalence test passes.
- [ ] `npm run build` (Next.js production build) succeeds.
- [ ] Local `/self-assessment` invocation no longer surfaces satisfied actions in the top 3.
