---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/104
synthesized_into: []
doc_kind: decision
---

# Decision: document the `satisfiedWhen` DSL grammar before extracting the evaluator

## The bug

On 2026-05-31, a `/self-assessment` run reported `Start with one loop: /loop 30m
/babysit` as a top-3 priority action — despite `signalsSummary.loopCommandUses`
already sitting at `14`, well past the action's own `satisfiedWhen` threshold
of `loopCommandUses>=1`. The action was satisfied. It should never have
surfaced.

Root cause: the model running the skill had to "first filter, then rank"
`nextActions` itself, evaluating each action's `satisfiedWhen` string against
`signalsSummary` by hand. The canonical evaluator
(`app/lib/assessment.ts:evaluatePredicate`) lived in TS, Next.js-coupled by
location, with no Node-side caller the skill could invoke. So the model
improvised — it hand-wrote a filter expecting an `{field, op, value}`
object shape and skipped string predicates like `"loopCommandUses>=1"`
entirely. Every predicate check silently evaluated to `null`/falsy, no
action was ever filtered out, and an already-satisfied item leaked into the
ranked list.

This is a recurring failure class: **the grammar wasn't documented anywhere
the model could see it in-context**, so it reached for a plausible-looking
but wrong shape instead.

## The fix, in two PRs

PR #104 is the tactical half. It does one thing: it writes the DSL grammar
directly into `.claude/skills/self-assessment/SKILL.md`, where the model
reads it before attempting any filter. No code changes — pure documentation,
additive only. It ships alongside a design spec and implementation plan for
the structural fix (below), so the second PR has an approved path to land
against.

The structural half — extracting `evaluatePredicate` into a Node-shareable
`scripts/predicate.mjs`, then pre-computing the filtered + ranked list once
in `run-assessment.mjs` and writing it to `assessment.json.rankedNextActions`
— has since landed. Once it did, the model's job stopped being "evaluate the
DSL yourself" and became "read a pre-computed field." The grammar block PR
#104 added to `SKILL.md` was deleted as obsolete in that follow-up, per the
design spec's own instruction (`docs/superpowers/specs/2026-05-31-predicate-ranker-design.md`
§PR 2, "Delete the PR 1 grammar block").

That's why `.claude/skills/self-assessment/SKILL.md` today reads, plainly:

> Read `assessment.json.rankedNextActions[0..2]` — already filtered
> (satisfied actions dropped) and ranked by `weight × deficit` by
> `scripts/rank-next-actions.mjs`.

and `CLAUDE.md`'s hard rules now say:

> **Ranked next-actions live in `assessment.json.rankedNextActions`.** The
> self-assessment skill must NEVER hand-implement the satisfiedWhen filter
> or the weight×deficit ranking. Read the pre-computed top-10 from the
> written file.

and:

> **DSL evaluator has one source.** `scripts/predicate.mjs` is canonical.
> `app/lib/assessment.ts:evaluatePredicate` must remain a 1-line passthrough
> re-export — never copy the implementation.

## The grammar, for reference

Even though the skill no longer needs to evaluate it directly, the DSL is
still the format every `satisfiedWhen` string in `app/data/rubric.json` is
written in, and it's still the contract `scripts/predicate.mjs` implements.
Worth keeping documented somewhere durable:

| Form | Meaning |
| --- | --- |
| `path` | truthy (non-null, non-zero, non-empty-string; the strings `"0"` and `"false"` are also treated as falsy) |
| `!path` | falsy |
| `path>=N` / `<=N` / `>N` / `<N` | numeric comparison |
| `path=v` or `path=v\|w\|x` | equals (or equals one of several alternatives) |
| `path!=v` | not equals |
| `path~regex` | array-of-strings element matches regex (case-insensitive) |
| `A & B` | AND of two or more atoms |

Example: `loopCommandUses>=1` against `signalsSummary.loopCommandUses=14`
evaluates to **true** — the action is satisfied and must be filtered out of
any next-actions list, never surfaced as a TODO.

Error handling is conservative by design: a parse error, unknown operator,
or missing signal field all evaluate to `false` (action kept, not hidden).
The rationale, per the design spec, is that a bad predicate should surface
extra coaching rather than silently swallow a real gap.

## Why this shape, not a schema validator

The design spec considered and rejected re-litigating the DSL itself — "No
DSL grammar changes... this is a pure extraction + caller migration." The
eight operator classes were already correct and already covered by
`app/data/rubric.json`'s existing predicates; the bug was never in the
grammar, it was in the grammar being invisible to the agent that needed to
apply it. Two structural guarantees now keep it that way:

1. **One evaluator.** `scripts/predicate.mjs` is canonical; the TS side
   (`app/lib/assessment.ts`) is a one-line passthrough re-export, pinned by
   a reference-equality test (`app/lib/__tests__/predicate-passthrough.test.ts`).
   A future contributor who copies the implementation instead of re-exporting
   it fails CI.
2. **One evaluation site.** Filtering and ranking happen once, in
   `scripts/run-assessment.mjs`, and get written to `assessment.json`. Every
   downstream consumer — the skill, the console printer, Slack — reads the
   same pre-computed `rankedNextActions` array instead of re-deriving it.

The dashboard's own render paths (`/methodology/probes`, `/dimensions/[id]`)
are the one deliberate exception: they still evaluate predicates fresh at
request time, because they need live ✓/✗ marks per action rather than a
cached top-10.

## Named regression

`scripts/__tests__/rank-next-actions.test.mjs` pins the original bug
directly: a fixture with `loopCommandUses=14` must exclude the
`loopCommandUses>=1` action from the ranked output, even though its
`weight × deficit` score would otherwise rank it highest. If this test ever
goes red, the leak has come back.
