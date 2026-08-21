---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/198
synthesized_into: []
doc_kind: decision
---

# Memory & Context Management Execution scorer redesign (CCE-163)

Memory & Context Management has been sitting at **Platform 100 / Execution
33** — a Δ big enough to be the diagnostic case the dashboard exists to catch,
except this time the gap was in the scorer, not the user. CCE-163 is the
design record for why, and it lands on a fix: the Execution numerator now
counts _any_ deliberate context-management mechanism, not just two slash
commands.

## The old numerator, and what was wrong with it

The Execution half used to sum two session-coverage counters —
`clearCommandUses` and `compactCommandUses` — over the
`interactive_cli ∪ unknown` universe (`scripts/score.mjs:EXECUTION_SCORERS`).
70 session-coverage hits over 353 sessions is 19.83%, which normalizes against
the rubric's `target: 60` to land at 33.

The design spec identifies three defects, all instances of the same failure
mode as CCE-161's fenced-block-counting bug: measuring a countability proxy
instead of the property the dimension actually claims to score.

1. **Auto-compact configuration fights its own Execution score.** The
   `CLAUDE_CODE_AUTO_COMPACT_WINDOW` setting feeds Platform Setup and the
   config-progression milestone walker — but configuring it well means you
   type `/compact` _less_, which mechanically depresses the very Execution
   numerator the dimension is supposed to reward. The two halves of one
   dimension were pulling against each other.
2. **External memory tooling was invisible.** Neither claude-mem nor graphify
   appeared anywhere in the posture/volume command tables that
   `scanTranscriptInvocations` reads from — a user managing context through a
   knowledge-graph tool scored identically to one doing nothing at all.
3. **CCE-79 had already recalibrated the target once** (92 → 60) rather than
   fix the numerator — itself a tell that the design was shaky rather than
   just miscalibrated.

## Telemetry survey: don't grep, parse `tool_use`

Before proposing a fix, the spec surveyed 2,019 transcripts over a 30-day
window — the same "empirically verify before scoring" discipline used
elsewhere in this repo. The survey caught a trap worth keeping around for any
future MCP-based signal:

Naively grepping transcript text for `mcp__plugin_claude-mem` returned 1,513
matching sessions. That number is a mirage — it's the MCP tool _listing_
injected into every session's system prompt, not an actual invocation. The
tell was that five unrelated tool names all matched roughly the same count
(~3,393); real usage never distributes that evenly across distinct tools.
Parsing `message.content[].type === "tool_use"` and matching on `name` gave
the real counts:

| Signal               | Naive grep     | Real `tool_use` entries         |
| -------------------- | -------------- | ------------------------------- |
| claude-mem MCP calls | 1,513 sessions | 15 calls in 9 sessions          |
| graphify invocations | 15 sessions    | 752 invocations in 127 sessions |

Unfiltered session coverage (all 2,019 transcripts, before gating to the real
`interactive_cli ∪ unknown` denominator) came out to:

```
clear       54   2.7%
compact     32   1.6%
graphify   127   6.3%
claude-mem   9   0.4%
UNION      197   9.8%      (>=2 kinds: 19, 0.9% — overlap is small)
```

Two findings shaped the design:

- **graphify is the real uncounted signal** — 127 sessions, roughly 2.4× the
  `/clear` count, entirely absent from the old scorer.
- **claude-mem doesn't behave like active usage.** Its actual contribution is
  passive hook-driven capture at session start, which emits no tool calls.
  That's Platform posture, not Execution behavior — the spec explicitly
  rejects the premise that claude-mem adoption should lift this score.

## Per-field classification, before anything enters a numerator

Following the repo's per-field semantic rule (classify time window and
counter class before summing anything into a ratio), the spec ran every
candidate signal through that check:

| Signal                  | Time window       | Counter class        | Verdict                  |
| ----------------------- | ----------------- | -------------------- | ------------------------ |
| `clearCommandUses`      | 30-day windowed   | session-coverage     | numerator ✅             |
| `compactCommandUses`    | 30-day windowed   | session-coverage     | numerator ✅             |
| graphify invocations    | 30-day windowed   | raw invocation count | ❌ as-is                 |
| claude-mem `tool_use`   | 30-day windowed   | raw invocation count | ❌ as-is                 |
| `autoCompactWindow`     | config, no window | binary config        | ❌ not a count           |
| `cliBtwUseCountAllTime` | cumulative        | raw count            | evidence only, unchanged |

752 raw graphify invocations cannot be added to 70 session-coverage hits —
that's the identical CCE-78/CCE-79 defect of blending counter classes into
one sum.

## The fix: union session-coverage, not sum

The redesigned numerator converts the tooling signals to session-coverage and
unions them with the existing commands, instead of summing raw counts:

```
numerator   = | sessions showing ANY deliberate context management |
              where "any" = /clear ∪ /compact ∪ graphify ∪ claude-mem tool_use
denominator = interactiveOrUnknownSessionsAnalyzed
```

This keeps every numerator input in one class (session-coverage), one
window (30-day), and one denominator universe, and it makes the dimension
substitutable: a user who manages context via a knowledge graph now scores
the same as one who types `/clear`, which is the property the dimension is
supposed to be measuring. Because the measured mechanism overlap is small
(19 of 197 sessions used ≥2 kinds), the union tracks close to additive in
practice, but stays correct if that changes.

This has already landed in the scorer. `EXECUTION_SCORERS.memory` in
`scripts/score.mjs` now reads two new signals — `memoryToolSessionCount`
(session coverage of claude-mem + graphify `tool_use` entries) and
`memoryHygieneSessions` (the transcript-scanner's own union of
`/clear ∪ /compact ∪` memory-tool sessions) — and takes
`Math.max(observedUnion, clear, compact, memoryTools)` as the numerator. The
`Math.max` isn't a sum: it's the tightest defensible lower bound, because the
transcript-only union can't see `history.jsonl`-only slash-command
invocations that the MAX-merged `clear`/`compact` counters do see. Every
input stays session-coverage over the same universe, so the result still
can't exceed the denominator. Both new fields are documented in
`app/data/probe-catalog.json` under the `transcripts` source category, tagged
CCE-163. Coverage lives in
`scripts/__tests__/memory-customization-execution-scorers.test.mjs`, including
cases for the union floor, the observed-union-beats-every-part case, the cap
at exactly 100, and a session using all three mechanisms counting once.

Rejected alternatives, and why:

- **Additive sum of raw counts** — the exact CCE-79 defect: mixed counter
  class in one sum.
- **`max(config posture, behavioral ratio)`** — collapses Platform and
  Execution into one axis, and a single config flag would pin the score near
  ceiling regardless of actual behavior.
- **Retune the target again** — what CCE-79 already did; treats the symptom,
  not the numerator.

## Auto-compact: evidence only, not a target adjustment

Auto-compact configuration isn't a count, so it can't enter the ratio at all.
Two options were on the table:

- **(A) Evidence only** — surface
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=<n>` in the Execution evidence line, leave
  the ratio and target untouched.
- **(B) Expectation suppression** — lower the rubric target (e.g. 60 → 40)
  when auto-compact is configured, on the reasoning that a well-configured
  user genuinely needs fewer manual interventions.

**Resolved: (A).** Option B was rejected because a config-dependent target
makes scores incomparable across setups — two users with identical behavior
would score differently depending on an unrelated config flag. The "good
config depresses the score" tension is addressed instead by broadening
mechanism coverage: a user with automated context management now scores
through the tooling arm of the union rather than needing the target lowered
out from under them. `scripts/__tests__/memory-customization-execution-scorers.test.mjs`
locks this in directly — configuring `autoCompactWindow` changes the evidence
text but never the score.

## Target: held at 60, not rescaled

The redesigned numerator, measured over the real gated denominator, comes out
to:

```
Deliberate context management: 79 of 353 interactive_cli∪unknown sessions (22.38%)
  /clear 47 · /compact 23 · memory tools 25   (union, not sum — overlap 16)
```

!!! note "The 353 denominator was itself wrong, and was fixed afterwards"

    That figure is the measurement as it stood when CCE-163 was designed.
    [CCE-164](https://github.com/theoju/claude-code-self-assessment/pull/199)
    landed after it and found the denominator inflated roughly 3.8× — 353
    against a true 93 — because `classifySessionKind` failed *open*, letting
    unrecognized entrypoints degrade to `unknown` and enter the
    `interactive_cli ∪ unknown` posture universe. Read the ratio above as a
    record of the design-time numerator work, not as the dimension's current
    score. The numerator redesign described here and the denominator fix are
    independent; both were needed.

The rubric target (`app/data/rubric.json`, dimension id `memory`) stays at 60
rather than being scaled up in proportion to the broadened numerator
(79/70 ≈ 1.13, which would suggest ~68). The spec's reasoning: the target
answers a behavioral question — in what fraction of interactive sessions
_should_ a user deliberately manage context — not a measurement question. It
was never calibrated to the old numerator's observed ceiling, so correcting
an undercount should raise this user's score (33 → 37), not be cancelled out
by scaling the target to hold it flat. `scripts/__tests__/memory-customization-execution-scorers.test.mjs`
asserts the target directly against the rubric file so this stays pinned.
The spec is explicit that 60 is one machine's judgment, not a distribution,
and that revising it defensibly needs coverage data across several users'
telemetry this repo doesn't have.

## A defect this surfaced along the way

Implementing the redesign caught a pre-existing bug from CCE-79: the `/btw`
cumulative-evidence sentence read
`s.signalsSummary?.cliBtwUseCountAllTime` inside the scorer, but scorers only
ever receive the raw `signals` object — `signalsSummary` is assembled
afterwards, in `scripts/run-assessment.mjs`. That expression was always
`undefined`, so the sentence never rendered even though the underlying
counter (97) was correct the whole time. The fix reads
`s.settings?.cliBtwUseCount` — the same source
`buildSignalsSummary` uses. Worth remembering: the first CCE-163
implementation attempt reproduced the identical mistake for the _new_ fields,
and was only caught because the evidence line printed `memory tools 0`
against a `signalsSummary` that showed 25.

## Status

The union-based numerator, the auto-compact evidence-only decision, and the
held-at-60 target are all implemented and covered by tests as described
above. `app/data/probe-catalog.json` carries exactly 50 entries, and the
tracker's own header (`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`)
declares "50 probes" — so the two new CCE-163 entries
(`memoryToolSessionCount`, `memoryHygieneSessions`) are already counted in
the machine-enforced header, and that half of the probe-tracker sync
obligation is satisfied.

One loose end: the tracker's header narrative gives CCE-164 its own callout
sentence ("**CCE-164** (2026-08-20) fixed `classifySessionKind`…") the way
it did for every earlier probe-adding change (CCE-29, CCE-25, #94, #96/#97),
but has no equivalent sentence for CCE-163's two new entries. The counts are
correct; the changelog prose that explains *why* the count is 50 isn't. Add
that sentence before folding this page into permanent architecture
documentation.
