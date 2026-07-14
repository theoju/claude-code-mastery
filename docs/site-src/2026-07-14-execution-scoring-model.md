---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Execution scoring model

Every dimension in the rubric scores on two independent axes — **Platform
Setup** (is the tooling configured?) and **Execution** (are you actually
using it?). Platform Setup reads `~/.claude/settings.json`, `agents`,
`commands`, `skills`, `plans`, and per-project `MEMORY.md` files. Execution
reads cooked telemetry (`~/.claude/usage-data/{facets,session-meta}/*.json`)
and, where `includeTranscripts` is on, scans `~/.claude/projects/*/*.jsonl`
directly for the signals cooked telemetry doesn't carry. This page is the
architecture reference for the Execution axis: the session universes it
gates on, and how the last two `noTelemetry()` placeholders — Memory &
Context Management and Terminal & Customization — became real scorers
(CCE-76 / PR #116).

## Session universes

`withGates()` in `scripts/score.mjs` wraps every Execution scorer with a
shared insights/transcripts/sessions gate, so each scorer body only deals
with the math, not data availability. The gate is parameterized by
`universe`, which selects the denominator:

- **`interactive_only`** — `s.insights.interactiveSessionsAnalyzed`
  (`sessionsByKind.interactive_cli`). Used for scorers measuring settable
  user posture: permissions, planning, model/effort, learning, parallel.
- **`interactive_or_unknown`** — `s.insights.interactiveOrUnknownSessionsAnalyzed`
  (`interactive_cli + unknown`). New in CCE-76; used by memory and
  customization (see below).
- **`all_sessions`** — `s.insights.sessionsAnalyzed`. Used for volume
  scorers where autonomous/SDK-orchestrated traffic is still real signal:
  verification, integrations, scheduled, remote.

The CLAUDE.md hard rule this exists to satisfy: **a ratio's numerator must
be a subset of its denominator's universe**, or the ratio can exceed 100%
and silently mask the violation (the reference incident was the planning
scorer's 36/34 = 105.88% bug, PR #97). `interactive_only` and
`all_sessions` predate CCE-76; `interactive_or_unknown` was added because
neither existing universe matched the posture-command partition.

### Why `interactive_or_unknown` exists

`scanTranscriptInvocations` in `scripts/_usage-data.mjs` classifies every
posture command (`/color`, `/voice`, `/focus`, `/btw`, `/clear`,
`/compact`, `/simplify`, `/rewind`, `/fewer-permission-prompts`) through an
`allowPosture` gate that only counts a hit when
`classifySessionKind(path)` returns `"interactive_cli"` **or** `"unknown"`
— `"unknown"` is the conservative fallback for transcripts
`classifySessionKind` can't confidently place (truncated files, legacy
shapes). That gate is deliberately wider than `interactive_only`. Gating a
memory/customization scorer on `interactive_only` while the counters it
reads were collected under `interactive_cli ∪ unknown` would let the
numerator exceed the denominator's universe — exactly the violation the
hard rule exists to catch.

The fix, added in `insights-signals.mjs`, matches the partition instead of
narrowing it:

```js
const interactiveOrUnknownSessionsAnalyzed =
  sessionsByKind.interactive_cli + sessionsByKind.unknown;
```

`withGates` gained a third `universe` value that resolves to this field.
Tightening `allowPosture` down to `interactive_cli` only was considered and
rejected — it would undo CCE-71's conservative-fallback design and
under-count users whose transcripts don't cleanly classify.

## Memory & Context Management Execution

`EXECUTION_SCORERS.memory` (`scripts/score.mjs`) is gated
`{ transcripts: true, universe: "interactive_or_unknown" }`. The numerator
is the session-coverage sum of `/clear` and `/compact` hits, read through
`maxProbe()` — a helper that takes the max of the transcript-scan count and
the shell-history-scan count for the same field, since `/clear` and
`/compact` can each be typed at the CLI or triggered inside the
transcript-visible session:

```js
const clear = maxProbe(s, "clearCommandUses");
const compact = maxProbe(s, "compactCommandUses");
const sum = clear + compact;
const ratio = Math.min(sum / denom, 1);
const score = Math.round(ratio * 100);
```

This is narrower than CCE-76's original design, which summed four
counters (`/btw`, `/clear`, `/compact`, `/rewind`). That shipped, then was
redesigned under **CCE-79** per the CLAUDE.md per-field semantic-
categorization rule: `/btw` is a *cumulative all-time* invocation counter
(`cliBtwUseCount`), not a 30-day windowed session-coverage signal, and
`/rewind` is a near-zero, keyboard-shortcut-driven signal that doesn't
belong in the same ratio class as the other two. Mixing all three counter
classes into one numerator would have silently corrupted the ratio in the
same way the `/btw` blend at `run-assessment.mjs:134-137` once did for the
old Memory ratio. The redesign:

- Restricts the ratio numerator to `/clear` + `/compact` — both genuine
  session-coverage counters over the 30-day window.
- Surfaces cumulative `/btw` usage as **evidence text**, not numerator
  input: `s.signalsSummary?.cliBtwUseCountAllTime`, appended to the
  evidence string only when nonzero.
- Drops `/rewind` from the ratio entirely — it remains a binary
  next-action probe (`rewindCommandUses >= 1`) in the rubric, gating
  Platform Setup rather than feeding an Execution ratio.
- Recalibrated `rubric.json`'s `memory.target` from 92 to 60, so the
  narrower, more honest numerator still reaches a realistic 100 ceiling.

If the raw ratio exceeds 1 (a session that fired both `/clear` and
`/compact` counts toward both counters), the scorer caps the displayed
score at 100 but says so in evidence — `"— capped from 142% (multiple
memory commands per session)"` — rather than hiding the over-count behind
a clean number.

## Terminal & Customization Execution

`EXECUTION_SCORERS.customization` uses the same shape and universe, summing
session-coverage hits on `/color`, `/voice`, and `/focus`:

```js
const color = maxProbe(s, "colorCommandUses");
const voice = maxProbe(s, "voiceCommandUses");
const focus = maxProbe(s, "focusCommandUses");
const sum = color + voice + focus;
```

Unlike memory, all three customization counters survived the CCE-79
review unchanged — they're already same-class (30-day, session-coverage).
The same capped-ratio evidence pattern applies when a session fires more
than one customization command.

### Counter-class unification (`focusCommandUses` / `rewindCommandUses`)

Before CCE-76, `focusCommandUses` and `rewindCommandUses` were the only two
posture counters still incrementing per-*message* in
`scanTranscriptInvocations` — a leftover from when they were added
(a separate PR from the one that introduced the session-coverage pattern
for the other five posture commands: `/simplify`, `/btw`, `/voice`,
`/clear`, `/compact`). A session where a user typed `/focus` three times
would report `focusCommandUses: 3`, while a session that typed `/simplify`
three times reported `simplifyCommandUses: 1` — same usage intensity,
different counter semantics. CCE-76 retrofit both to session-coverage flags
(`sessionHasFocus` / `sessionHasRewind`, flipped to `true` on first sighting,
counted once at end-of-session) so every posture counter in the file now
shares one counting class. This mattered for the customization scorer:
summing a raw-invocation counter (`focusCommandUses`) alongside two
session-coverage counters (`color`, `voice`) would have been exactly the
per-field mismatch the CLAUDE.md categorization rule warns against.

## What changed on the radar

Before CCE-76, all twelve rubric dimensions had Platform Setup scorers, but
Memory and Customization Execution routed to `unavailable(gapReason)` and
rendered as italic, 0.65-opacity vertices on the radar (see
`RadarChart.tsx`'s handling of `gapReason !== null`). After CCE-76 (and the
CCE-79 follow-up), **all twelve dimensions have a real Execution scorer**.
Model & Effort Tuning remains the only *partially*-measured dimension — the
Opus-usage half is scored from transcripts (`opusDominantSessionCount`),
but effort level (`/effort max`, `xhigh`, etc.) has no transcript signature
and stays Platform-Setup-only. Every other dimension's italic label now
depends solely on whether that specific run had zero sessions in its
gated universe (`gapReason !== null`), not on a structurally-missing
scorer.
