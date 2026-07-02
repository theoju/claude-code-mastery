---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/128
synthesized_into: []
doc_kind: decision
---

# Decision: Memory Execution scorer redesign (CCE-79)

`scripts/score.mjs`'s `memory` Execution scorer used to sum four slash-command
counters into one numerator: `/btw`, `/clear`, `/compact`, `/rewind`. PR #128
narrows that numerator to `/clear + /compact`, moves `/btw` to evidence text,
drops `/rewind` from the ratio, and recalibrates the rubric target for the
Memory dimension from 92 to 60. This page records why, and what to expect if
you see a Memory Execution score jump on your next run.

## The problem: one sum, three counter classes

The original numerator treated four fields as fungible:

```js
const sum =
  btwCommandUses + clearCommandUses + compactCommandUses + rewindCommandUses;
const ratio = Math.min(sum / interactiveOrUnknownSessionsAnalyzed, 1);
```

They aren't fungible. Per the per-field semantic table in
[`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md):

| Field      | Source                          | Counter class                            | Reliability                                            |
| ---------- | -------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| `/clear`   | `history.jsonl` (per-session)    | session-coverage, 30-day windowed         | reliable                                                 |
| `/compact` | `history.jsonl` (per-session)    | session-coverage, 30-day windowed         | reliable                                                 |
| `/btw`     | `~/.claude.json#btwUseCount`     | **invocation count, cumulative all-time** | reliable for the count, wrong shape for a windowed ratio |
| `/rewind`  | `history.jsonl` / transcripts    | session-coverage, 30-day windowed         | almost always zero (Esc-Esc keyboard shortcut, rarely typed) |

`/btw` mixed a lifetime invocation count into a numerator whose denominator
(`interactiveOrUnknownSessionsAnalyzed`) is a 30-day window — the same class
of bug CCE-78 patched one layer down when it stopped `cliBtwUseCount` from
leaking into `btwCommandUses` directly. `/rewind` wasn't wrong-shaped, just
near-dead weight that diluted the signal from the two commands that actually
carry it. CCE-79 fixes both at the scorer-design level rather than patching
the symptom again.

## What changed

`scripts/score.mjs::memory` (Execution half) now reads:

```js
memory: withGates(
  { transcripts: true, universe: "interactive_or_unknown" },
  (s) => {
    const denom = s.insights.interactiveOrUnknownSessionsAnalyzed;
    // CCE-79: numerator restricted to session-coverage signals only.
    // /btw (cumulative all-time) shown as evidence text, not in ratio.
    // /rewind (keyboard-shortcut, near-zero signal) dropped from ratio;
    // kept as a binary next-action probe via rubric satisfiedWhen.
    const clear = maxProbe(s, "clearCommandUses");
    const compact = maxProbe(s, "compactCommandUses");
    const sum = clear + compact;
    const rawRatio = sum / denom;
    const ratio = Math.min(rawRatio, 1);
    const score = Math.round(ratio * 100);
    const btwAllTime = s.signalsSummary?.cliBtwUseCountAllTime ?? 0;
    const btwEvidence =
      btwAllTime > 0
        ? ` Plus ${btwAllTime} all-time /btw invocations (cumulative, not in ratio).`
        : "";
    // evidence + gaps assembled from sum, denom, capSuffix, btwEvidence
  },
);
```

Four pieces landed together:

1. **Numerator narrowed** to `clearCommandUses + compactCommandUses` —
   both session-coverage counters, both windowed over the same
   `interactive_cli ∪ unknown` universe as the denominator.
2. **`/btw` moved to evidence text.** `s.signalsSummary.cliBtwUseCountAllTime`
   (the cumulative all-time count, already exposed separately since CCE-78)
   is appended to the evidence string as `"Plus N all-time /btw invocations
   (cumulative, not in ratio)."` — the credit is still visible, it just no
   longer inflates a windowed percentage.
3. **`/rewind` dropped from the ratio, kept as a probe.** The
   `rewindCommandUses>=1` `satisfiedWhen` next-action in
   `app/data/rubric.json` (the `rewind-reflex` action under the `memory`
   dimension) is unchanged — you still get a next-action checkmark for
   using `/rewind` at least once, it just no longer feeds the percentage.
4. **Rubric target lowered 92 → 60.** `app/data/rubric.json`'s `memory`
   dimension `target` reflects the narrower, harder-per-hit numerator: two
   commands covering a session is a materially different bar than four.

The PLATFORM-half `/btw` credit (`scripts/score.mjs:810-820`, the
`automation` scorer's `adoptionBonus` using `cliBtwUseCount`) is untouched —
only the EXECUTION ratio had the mixed-counter-class bug.

## Expected side effect: your Memory Execution score may jump

Because normalization is `raw / target × 100`
(`scripts/score.mjs::normalize`), narrowing the numerator *and* lowering the
target at the same time can move the displayed radar vertex up for
unchanged raw posture. A user previously at raw Execution 55 against target
92 (`55/92 = 60` normalized) lands at `55/60 = 92` normalized post-redesign
if their raw `/clear + /compact` hit count happens to land near the old raw
score. This is the documented, intentional shape of the recalibration, not a
regression — the old target (92) was calibrated against a four-command
numerator that no longer exists. If your Memory vertex moves noticeably on
your next `npm run assess`, that's this change landing, not a data anomaly.

## Verification

- `scripts/__tests__/memory-customization-execution-scorers.test.mjs` covers:
  numerator excludes `/btw` and `/rewind`; `/btw` cumulative surfaces as
  evidence text; `/clear + /compact` regression cases; cap behavior at
  `rawRatio > 1` preserved.
- `app/data/rubric.json`'s `memory.target` is asserted at 60.
- Full suite: `npx vitest run` (564+ tests, per `CLAUDE.md`'s `## Tests`
  baseline).

## References

- Design spec: [`docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md)
- Plan: [`docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md`](https://github.com/theoju/claude-code-self-assessment/blob/main/docs/superpowers/plans/2026-06-04-cce79-memory-scorer-redesign-plan.md)
- Prior art: CCE-78 (the `/btw` blend asymmetry fix that first split
  `cliBtwUseCountAllTime` out of `cliBtwUseCount`), CCE-76 (original Memory
  Execution scorer, v0.9.18 / PR #116)
- `CLAUDE.md` — "Per-field semantic categorization before adding to any
  numerator" hard rule, which this PR is the reference case for.
