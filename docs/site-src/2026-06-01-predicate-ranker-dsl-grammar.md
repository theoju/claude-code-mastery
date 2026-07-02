---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Predicate DSL grammar: a tactical fix, superseded by design

**Status: superseded.** The grammar block this page documents was inserted
into `SKILL.md` as a stopgap and deleted once PR 2 of the same design landed.
Read this page for the history and the bug it fixes; read
`scripts/predicate.mjs` for the live implementation.

## The bug

On 2026-05-31, `/self-assessment` reported `Start with one loop: /loop 30m
/babysit` as a top-3 priority action — despite
`signalsSummary.loopCommandUses = 14` clearly satisfying that action's
`satisfiedWhen` predicate (`loopCommandUses>=1`). The action should have been
filtered out.

Root cause: the skill's instructions told the model to "first filter, then
rank," but the canonical `satisfiedWhen` evaluator (`evaluatePredicate`) lived
only in `app/lib/assessment.ts` — TypeScript, Next.js-coupled by location,
with no Node-side caller the skill could invoke. The model running the skill
hand-wrote its own filter instead, and misread the string DSL
(`"loopCommandUses>=1"`) as an object shape. Its evaluator returned `null` for
every predicate, so nothing was filtered, and an already-satisfied action
surfaced as an unfinished TODO.

This is the exact failure class CCE-110 ("ground before you write," applied
here to code the skill runs rather than docs) exists to catch: a model
re-implementing a contract instead of reading the one source of truth for it.

## The two-PR sequence

The design (`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`)
deliberately split the fix into a tactical PR and a structural PR, because the
structural fix (extracting a shared evaluator, pre-computing ranked output)
was a bigger unit of work than the bug needed sitting unfixed:

1. **PR 1 (tactical, PR #104):** document the `satisfiedWhen` grammar inline
   in `SKILL.md` — a `> `-quoted block naming all seven operator classes and
   pointing at `app/lib/assessment.ts:evaluatePredicate` as canonical. Good
   enough for a careful model to hand-evaluate correctly; explicitly scoped as
   a stopgap.
2. **PR 2 (structural):** port `evaluatePredicate` and its helpers
   (`readPath`, `isTruthy`, `evaluateAtomic`) to a pure-ESM
   `scripts/predicate.mjs`, make `app/lib/assessment.ts` a one-line
   passthrough re-export of it, and pre-compute the filtered + ranked top-10
   list once in `scripts/run-assessment.mjs`, writing it to
   `assessment.json.rankedNextActions`. The skill stops evaluating predicates
   at all — it just reads `rankedNextActions[0..2]`. The PR 1 grammar block is
   deleted from `SKILL.md` as obsolete at that point.

Both PRs preserve the same public signature:
`evaluatePredicate(expr: string, signals: Record<string, unknown>): boolean`.

PR 2 has since landed. The current `.claude/skills/self-assessment/SKILL.md`
no longer carries a grammar block — it instructs the model to read
`assessment.json.rankedNextActions[0..2]` directly, already filtered and
sorted by `weight × deficit` by `scripts/rank-next-actions.mjs`. CLAUDE.md's
`## Hard rules` section carries the resulting rule: **"DSL evaluator has one
source"** — `scripts/predicate.mjs` is canonical, and
`app/lib/assessment.ts:evaluatePredicate` must stay a one-line passthrough,
enforced by `app/lib/__tests__/predicate-passthrough.test.ts` asserting
reference equality between the two exports.

## The grammar (historical reference)

For anyone who still needs to read a `satisfiedWhen` string by eye — for
example while editing `app/data/rubric.json` — these are the operator
classes `evaluatePredicate` supports, evaluated against `signalsSummary`:

| Form | Meaning |
| --- | --- |
| `path` | truthy (non-null, non-zero, non-empty-string; the strings `"0"` and `"false"` are also treated as falsy) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals (or equals one of an alternation) |
| `path!=v` | not equals |
| `path~regex` | array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Missing signal fields read as `0` / `false` (conservative: the action stays
visible rather than being silently hidden). Parse errors on any atom — an
unknown operator, an unparseable regex after `~` — return `false` for the
same reason.

Worked example, the one that triggered this whole design: `loopCommandUses>=1`
evaluated against `signalsSummary.loopCommandUses = 14` is `true`. A `true`
result means the action's precondition is met, so `rank-next-actions.mjs`
drops it from the ranked list — it should never render as a TODO.

## Where the real thing lives now

- `scripts/predicate.mjs` — canonical evaluator. Edit here, not in the TS file, when the DSL grammar changes.
- `scripts/rank-next-actions.mjs` — the filter (drop satisfied actions) + `weight × deficit` ranker that writes `assessment.json.rankedNextActions`.
- `app/lib/assessment.ts` — one-line re-export for dashboard render paths (`/methodology/probes`, `/dimensions/[id]`), which still evaluate predicates fresh per-request for ✓/✗ marks rather than reading the cached ranked list.
- `.claude/skills/self-assessment/SKILL.md` — the consuming skill; reads `assessment.json.rankedNextActions[0..2]` verbatim, no local evaluation.
