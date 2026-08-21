# Memory Execution scorer redesign

**Status:** design approved — decision resolved 2026-08-20 · **Ticket:** CCE-163 · **Date:** 2026-08-20

## Context

Memory & Context Management scores **Platform 100 / Execution 33**. The Execution
half is computed from two slash commands (`scripts/score.mjs:985-988`):

```js
const clear   = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
```

70 session-coverage hits / 353 `interactive_cli ∪ unknown` sessions = 19.83% →
`executionRawScore` 20 → normalized against rubric `target: 60` → **33**.

Three defects, all instances of measuring a countability proxy rather than the
named property — the same class as CCE-161's fenced-block counting:

1. **Auto-compact is credited on the wrong axis and depresses this one.**
   `settings.autoCompactWindow` feeds Platform (`score.mjs:140`) and the
   config milestone (`config-progression.mjs:92`). Configuring it well means
   rarely needing to type `/compact`, so good configuration mechanically lowers
   the Execution numerator. The two halves of one dimension oppose each other.
2. **External memory tooling is invisible.** `grep -rniE "claude-mem|graphify"
   scripts/*.mjs` returns nothing; neither is in `POSTURE_COMMANDS` or
   `VOLUME_COMMANDS`, so `scanTranscriptInvocations` never sees them.
3. **CCE-79 recalibrated the target (92 → 60) rather than fixing the
   numerator** — itself a signal the design was known-shaky.

## Telemetry survey

2,019 transcripts, 30-day window, measured before proposing to score anything
(per the "empirically verify telemetry fields" rule).

| Signal | Naive grep | Real `tool_use` entries |
| --- | --- | --- |
| claude-mem MCP calls | 1,513 sessions | **15 calls in 9 sessions** |
| graphify invocations | 15 sessions | **752 invocations in 127 sessions** |

**Trap — record this.** Grepping transcript text for `mcp__plugin_claude-mem`
matches the MCP tool *listing* injected into every session's system prompt, not
actual calls. The tell was near-identical counts (~3,393) across five different
tool names — real usage never distributes that evenly. Any scorer counting MCP
usage must parse `message.content[].type === "tool_use"` and match on `name`,
never raw string occurrence. Applies to every future MCP-based signal.

Per-signal session coverage, unfiltered by session kind:

```
clear       54   2.7%
compact     32   1.6%
graphify   127   6.3%
claude-mem   9   0.4%
UNION      197   9.8%      (>=2 kinds: 19, 0.9% — overlap is small)
```

**These are approximations.** They count all 2,019 session files; the scorer's
denominator is the 353 `interactive_cli ∪ unknown` sessions produced by
`classifySessionKind`. They establish the *shape* of the signal, not the target.
Exact figures must be re-derived through the real pipeline during implementation.

Two substantive findings:

- **graphify is the real uncounted signal** — 127 sessions, roughly 2.4× the
  `/clear` count, entirely absent from scoring.
- **claude-mem cannot be scored as active usage** — 9 sessions. Its actual
  contribution is passive hook-driven capture at session start, which emits no
  tool calls at all. That is Platform posture, not Execution behavior. Do not
  assume the user's premise that claude-mem usage should lift this score.

## Semantic classification

Required before any field enters a numerator (CLAUDE.md per-field rule):

| Signal | Time window | Counter class | Verdict |
| --- | --- | --- | --- |
| `clearCommandUses` | 30-day windowed | session-coverage | numerator ✅ |
| `compactCommandUses` | 30-day windowed | session-coverage | numerator ✅ |
| graphify invocations | 30-day windowed | **raw invocation count** | ❌ as-is |
| claude-mem `tool_use` | 30-day windowed | **raw invocation count** | ❌ as-is |
| `autoCompactWindow` | config, no window | **binary config** | ❌ not a count |
| `cliBtwUseCountAllTime` | **cumulative** | raw count | evidence only (unchanged) |

Raw invocation counts must not be summed into a session-coverage ratio — that is
precisely the CCE-78/CCE-79 defect. 752 graphify invocations added to 70
session-coverage hits would be meaningless.

## Recommended design — union session-coverage

Convert the tooling signals to session-coverage instead of summing raw counts,
which puts every numerator input in one class and permits a single ratio:

```
numerator   = | sessions showing ANY deliberate context management |
              where "any" = /clear ∪ /compact ∪ graphify ∪ claude-mem tool_use
denominator = interactiveOrUnknownSessionsAnalyzed
```

Properties:

- **One class, one window, one denominator.** No mixed-class sum.
- **Numerator ⊆ denominator universe.** Tooling sessions must be gated to
  `interactive_cli ∪ unknown` exactly as posture commands are, or the ratio can
  exceed 100% (the CCE-76 / PR #97 failure mode).
- **Substitutable mechanisms.** A user who manages context via a knowledge graph
  scores the same as one who types `/clear` — which is the property the
  dimension claims to measure.
- **Union, not sum.** A session using three mechanisms counts once. The measured
  overlap is small (19 sessions), so the union is close to additive in practice,
  but the semantics stay correct if that changes.

### Auto-compact

Not a count, so it cannot enter the numerator. Two options, decision required:

- **(A) Evidence only** — surface `CLAUDE_CODE_AUTO_COMPACT_WINDOW=<n>` in the
  Execution evidence line, leave the ratio untouched. Simple, honest, but leaves
  the "good config depresses the score" tension unresolved.
- **(B) Expectation suppression** — when configured, reduce the rubric target
  (e.g. 60 → 40), on the reasoning that a well-configured user genuinely needs
  fewer manual interventions. Resolves the tension, but makes the target
  machine-dependent, so two users with identical behavior score differently.

**Recommendation: (A).** Option B trades a defensible tension for a worse
property — a score that is no longer comparable across setups. Better to fix the
mechanism coverage (which the union does) and accept that config lives on the
Platform axis where it already is.

### Rejected alternatives

- **Additive sum of raw counts** — mixed counter class; the exact CCE-79 defect.
- **`max(config posture, behavioral ratio)`** — collapses two axes into one, and
  a single config flag would pin the score near ceiling regardless of behavior.
- **Retune the target again** — what CCE-79 did; treats the symptom.

## Target derivation

Do **not** carry over 60. Re-derive it after the numerator is implemented, from
a real pipeline run with proper session-kind gating. The unfiltered union
(9.8% of all sessions) is not the number to calibrate against — it must be
recomputed over the `interactive_cli ∪ unknown` denominator.

## Verification plan

- Source-level test in `gatherInsightsSignals` asserting the tooling numerator
  is gated to `interactive_cli ∪ unknown`, so a future gate-drop fails CI (the
  PR #97 lesson: fixture-fed scorer tests alone are insufficient).
- Assert numerator ⊆ denominator: a synthetic session set where every session
  uses a memory tool must score ≤ 100%.
- Assert union semantics: one session using `/clear`, graphify, and claude-mem
  contributes exactly 1, not 3.
- A test that a session recording only an MCP tool *listing* (no `tool_use`
  entry) contributes 0 — locking in the trap above.
- Probe-tracker sync: adding a `signalsSummary` field requires updating
  `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` in the same
  PR, and the five header counts are machine-enforced.

## Decision — resolved

**(A) Evidence only.** Confirmed by the user on 2026-08-20.

`CLAUDE_CODE_AUTO_COMPACT_WINDOW` is surfaced in the Execution evidence line
and does not alter the ratio or the target. Option B was rejected because a
config-dependent target makes scores incomparable across setups: two users with
identical behavior would score differently. The "good config depresses the
score" tension is addressed instead by broadening mechanism coverage — a user
who has automated context management still scores through the tooling arm of the
union.

Implementation plan: `docs/superpowers/plans/2026-08-20-cce163-memory-execution-redesign.md`
