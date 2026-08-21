---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/199
synthesized_into: []
doc_kind: decision
---

# Session classifier: fail closed, not open (CCE-164)

Memory Execution scored **37/100** on a machine that, it turned out, had
`/clear`, `/compact`, and memory tooling in active rotation across 83% of
its interactive sessions. The number was wrong, and it was wrong because
the classifier that decides which sessions count toward posture scoring
was failing **open**: an unrecognized transcript entrypoint fell through to
`unknown`, and `unknown` is admitted into the `interactive_or_unknown`
universe that Memory and Terminal & Customization Execution scoring divide
by. Fixed, the same machine scores **100/100** on Memory Execution and
Execution overall moves 60 → 68.

## What was actually happening

`classifySessionKind` in `scripts/_usage-data.mjs` reads the first
`entrypoint` row of a session transcript and buckets the session into
`interactive_cli`, `observer`, `sdk_orchestrated`, `subagent`, or
`unknown`. Only `interactive_cli` and `unknown` are supposed to represent
sessions where a human's own settings and habits are in play — everything
else runs under the SDK's defaults and shouldn't dilute a posture ratio.

The shipped version enumerated the entrypoints it recognized —
`ep === "cli"`, `ep === "claude-desktop"`, `ep === "sdk-cli"` — and let
anything else fall through the loop to a final `return "unknown"`. That
looked like a reasonable default until Anthropic's corpus started
including a `sdk-py` entrypoint the classifier had never seen. Two
independent defects then compounded:

- **Unhandled entrypoint.** `sdk-py` matched none of the known cases, so
  every one of those sessions — 226 of them, all automated agent runs with
  `first_prompt` text like "Review this change for security
  vulnerabilities" — resolved to `unknown` instead of `sdk_orchestrated`.
- **Undersized scan window.** The original scan bound stopped after 5
  lines. Modern transcripts commonly lead with `queue-operation` and
  `attachment` rows before the `entrypoint` row appears, and a corpus
  census found the deepest first-`entrypoint` row sitting at line 83. The
  5-line bound truncated that tail and left 39 further sessions
  unclassified regardless of the `sdk-py` fix.

Combined, 265 of 612 in-window sessions (43%) landed in `unknown` — and
because `unknown` sits inside `interactive_or_unknown`, all 265 entered the
Memory Execution denominator as if they were user-driven. The true
interactive-or-unknown population was 93; the diluted one was 353, a
3.8x inflation. The numerator barely moved (the misclassified sessions
contributed 3 hits), so the ratio collapsed: 82.80% became 21.81%, and
`normalize()` turned that into a 37.

## The fix: invert to an allow-list

The shipped classifier enumerated the machine-driven entrypoints it knew
about and treated everything else as ambiguous. The fix inverts that:
enumerate the small, stable set of entrypoints a human actually drives —
`INTERACTIVE_ENTRYPOINTS = {"cli", "claude-desktop"}` — and treat every
other value as machine-driven, resolving to `observer` or
`sdk_orchestrated` rather than `unknown`. A future `sdk-rb` or `sdk-go`
now fails closed by default instead of silently entering the posture
universe.

```
if (INTERACTIVE_ENTRYPOINTS.has(ep)) return "interactive_cli";
return path.includes("observer-sessions") ? "observer" : "sdk_orchestrated";
```

The scan bound moved from 5 to `ENTRYPOINT_SCAN_BOUND = 200`, comfortably
past the corpus's observed max of 83. The loop still breaks on the first
row carrying `entrypoint` (median depth is line 3), so the common case is
unchanged; the bound only matters for the pathological tail.

After the fix, `unknown` means exactly one thing: no `entrypoint` row was
found at all — a missing transcript, an unreadable file, or a shape that
genuinely lacks the field. On the corpus this incident was measured
against, that was zero sessions out of 639.

## Regression coverage

The fail-closed behavior is asserted directly, not just described. The
`classifySessionKind` describe block in `scripts/__tests__/_usage-data.test.mjs`
covers `sdk-py` by name ("classifies entrypoint=sdk-py as sdk_orchestrated,
not unknown") and, separately, the defect *class* rather than the one
instance: "classifies an unrecognized future entrypoint as sdk_orchestrated
(fails closed)" feeds a made-up `sdk-rb-not-yet-invented` value through the
classifier and asserts it still resolves to `sdk_orchestrated`. That second
test is the one that matters going forward — it's the guard that stops the
next unseen SDK entrypoint from repeating this incident. A third test,
"finds an entrypoint row preceded by queue-operation and attachment rows,"
covers the scan-bound fix by reproducing the actual leading-row shape (`queue-operation`,
`attachment`, `ai-title`) that pushed real transcripts past the old 5-line
bound.

## Why this direction, not the other one

Under-counting a posture denominator is conservative — a genuinely
interactive entrypoint that isn't yet in the allow-list resolves to
`sdk_orchestrated` and simply doesn't count, which understates coverage
but never overstates it. Over-counting, which is what shipped, silently
lets automated agent volume masquerade as user behavior and drags every
posture ratio toward zero as the SDK-driven share of a corpus grows. A
fail-closed classifier degrades gracefully; a fail-open one degrades
invisibly, because nothing errors — the score just gets quietly worse
every time Anthropic ships a new entrypoint string.

## What this did — and didn't — change

The Memory Execution rubric target (60, set by CCE-79 against the diluted
denominator) was deliberately held rather than re-tuned to the newly
observed 82.80% ratio. Raising a target to sit just under one machine's
observed rate is curve-fitting to a sample of one; the number that was
wrong was the denominator, and fixing the denominator is what this change
does. A user who clears the 60% bar now scores 100 on Memory Execution,
and that's the target doing its job, not a sign it needs to move.

`customization` Execution — which shares the same
`interactive_or_unknown` denominator — stayed at 0 through the fix. That's
correct: its numerator (`/color`, `/voice`, `/focus` usage) was genuinely
zero on the measured corpus, not a diluted ratio in disguise.

No scoring formula changed. No universe assignment changed — `memory` and
`customization` still score against `interactive_or_unknown`; the fix
makes that universe mean what it always claimed to mean.

## Diagnostic pattern for next time

If a posture-axis Execution score looks implausibly low, the reflex is to
print `sessionsByKind` before touching the scorer itself. A large
`unknown` bucket is a classifier defect, not a true account of user
behavior — after this fix, `unknown` should be at or near zero on any
corpus where every transcript carries an `entrypoint` row.
