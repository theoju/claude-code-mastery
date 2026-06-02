---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
---

# Memory & Customization Execution Scorers (CCE-76)

All twelve scoring dimensions now return numeric Execution scores. PR #116 replaced
the two remaining `noTelemetry()` stubs — **Memory & Context Management** and
**Terminal & Customization** — with real ratio-based scorers backed by
transcript posture-command coverage.

## What changed

Before this PR, both dimensions reported `gapReason: "no_telemetry"` and were
excluded from the Execution composite and from ranked next-actions. The radar
rendered them with italic labels and a footnote. Any posture-command usage gap
in those areas was invisible.

After this PR, both dimensions are scored from your actual transcript history
using the same posture-command counting approach as the other Execution scorers.

## How the scorers work

The new scorers use `withGates({ transcripts: true, universe: "interactive_or_unknown" })`.
The denominator is `interactiveOrUnknownSessionsAnalyzed` — the count of
sessions classified as `interactive_cli` **or** `unknown` (the conservative
fallback) in your `~/.claude/usage-data/` window. The numerator is the number
of those sessions in which you used a relevant posture command at least once.

| Dimension | Posture commands counted |
| --------- | ------------------------ |
| Memory & Context Management | `/btw`, `/compact`, `/simplify`, `/clear` |
| Terminal & Customization | `/color`, `/voice`, `/focus`, `/rewind`, `/fewer-permission-prompts` |

`focusCommandUses` and `rewindCommandUses` were switched from per-message to
per-session-coverage counting as part of this change, bringing them in line
with all other posture-command signals.

## The `interactive_or_unknown` universe

The denominator universe matters for correctness. Posture commands are only
meaningful in sessions where you control the posture — `interactive_cli` and
`unknown` sessions. Counting `sdk_orchestrated`, `observer`, or `subagent`
sessions in the denominator would dilute the ratio, because those session kinds
run under SDK defaults rather than your configured posture.

The `interactive_or_unknown` universe option was introduced specifically for
this scorer pair and satisfies the hard rule from PR #97: the numerator's gate
must be a strict subset of the denominator's universe.

## What scores look like

On the author's system at merge time, Memory scored **16 / 100** and
Customization scored **3 / 100**. Both are typical for setups where the
commands exist but aren't fired habitually — exactly the posture-command usage
gap the Execution axis is designed to surface.

If you run `npm run assess:print` after this change and see low numbers here,
that's the correct signal. The ranked next-actions list will now include Memory
and Customization entries if the weight × deficit calculation puts them in the
top 10.

## Seeing it in the dashboard

The radar no longer italicizes Memory or Customization. Both vertices carry
solid labels and a numeric Execution score. The `/methodology` page formula
breakdown was updated to show the posture-command coverage formula for both
dimensions.

If you're running the dashboard locally, run `npm run assess` to regenerate
`app/data/assessment.json` with the new scorer output, then reload
`http://localhost:3737`.

## Test suite

The full test suite grew from 647 to 666 passing tests. The new tests cover
the scorer contracts for both dimensions and assert the numerator–denominator
universe constraint. Run `npx vitest run` to verify.
