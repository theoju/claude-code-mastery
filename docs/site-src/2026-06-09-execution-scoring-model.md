---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/116
synthesized_into: []
doc_kind: architecture
---

# Execution scoring model — architecture reference

_As of PR #116 / CCE-76 (2026-06-09). All twelve Execution scorers are now live._

The Execution axis answers a single question: **are you actually using the tools
you've configured?** It reads `~/.claude/usage-data/{facets,session-meta}/*.json`
— the same cooked telemetry that `/insights` reads — and optionally scans
`~/.claude/projects/*/*.jsonl` transcripts for behavioral signals.

This page describes the design constraints that shaped the scorer, the session
universes used as denominators, and the state of all twelve dimensions as of
CCE-76.

---

## The two-axis split

Platform Setup and Execution are scored independently and never collapsed into
a single composite. Platform Setup asks _"is it in place?"_ (signals from
`~/.claude/settings.json`, agents, commands, skills, plans, memory). Execution
asks _"are you using it?"_ (signals from usage-data telemetry and optionally
transcripts).

The diagnostic case is a large delta between the two: every tool installed, none
of them fired. Collapsing the axes hides that gap.

---

## Session universes

Every Execution ratio scorer declares a `universe` — the denominator pool. Three
universes are defined in `scripts/score.mjs`:

| Universe               | Sessions included                                                   | Used for                                                    |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `interactive_cli`      | Sessions classified as `interactive_cli` by `classifySessionKind`   | Posture ratios where only user-initiated sessions count     |
| `interactive_or_unknown` | `interactive_cli` ∪ `unknown` sessions                            | Posture-command ratios (CCE-76, see below)                  |
| `all_sessions`         | Every session in the lookback window                                | Volume/integration ratios where session kind doesn't matter |

The `universe` is declared on `withGates({ universe: … })` at construction time
and enforced at the ratio layer. A scorer's **numerator must be a subset of its
denominator's universe** — violating this produces ratios above 100% (the PR #97
regression where plan-mode sessions ÷ multi-task sessions yielded 105.88%).

### Why `interactive_or_unknown`?

Posture commands like `/btw`, `/clear`, `/compact`, `/focus`, `/rewind`,
`/color`, `/voice` are counted from transcript scans. The transcript scanner
returns counts only for sessions where `classifySessionKind` returns
`interactive_cli` **or** `unknown` (the conservative fallback for sessions the
classifier cannot definitively categorize).

Using `interactive_cli` alone as the denominator would violate the
numerator-subset rule: some command-carrying sessions land in `unknown` rather
than `interactive_cli`, so the numerator universe is `interactive_cli ∪ unknown`.
The denominator must match. CCE-76 introduced
`interactiveOrUnknownSessionsAnalyzed` as the canonical denominator signal for
Memory and Customization scorers. In the v0.9.20 dataset this resolved to
161 sessions.

---

## Counter-class unification

Before CCE-76, `focusCommandUses` and `rewindCommandUses` were counted as
**per-message invocation counts** — each occurrence of the command in a message
incremented the counter. All other posture commands (`/btw`, `/clear`,
`/compact`) were already counted as **per-session-coverage** — the counter
increments once per session regardless of how many times the command appeared.

Mixing counter classes in a single ratio numerator produces a score that is
denominated in sessions but partially driven by per-message invocation frequency,
which breaks the semantic contract. CCE-76 rebaselined both signals to
per-session-coverage before the Memory and Customization scorers were wired up.

The canonical counter class for all posture-command numerator signals is now
**per-session-coverage**: deduplicated at session granularity, windowed to the
lookback period, restricted to `interactive_cli ∪ unknown` sessions.

---

## The twelve Execution scorers

As of CCE-76, every dimension returns a numeric Execution score. No scorer
routes to `noTelemetry()` (which previously marked a dimension as
unmeasured and excluded it from the Execution composite).

| Dimension                   | Scorer type        | Universe                   | Notes                                                  |
| --------------------------- | ------------------ | -------------------------- | ------------------------------------------------------ |
| Automation                  | Ratio              | `all_sessions`             | hooks, commands, agents fired                          |
| Permissions & Safety        | Ratio              | `interactive_cli`          | permission-prompt posture                              |
| Model & Effort Tuning       | Ratio (partial)    | `interactive_cli`          | Opus usage from transcripts; effort level settings-only |
| Parallelism                 | Ratio              | `interactive_cli`          | worktree + parallel session signals                    |
| Verification                | Ratio              | `all_sessions`             | hook-gated verification passes                         |
| Memory & Context Management | Ratio (CCE-76 new) | `interactive_or_unknown`   | `/clear` + `/compact` session coverage                 |
| Planning                    | Ratio              | `interactive_cli`          | plan-mode multi-task session coverage                  |
| Integrations                | Ratio              | `all_sessions`             | MCP tool calls, plugin usage                           |
| Terminal & Customization    | Ratio (CCE-76 new) | `interactive_or_unknown`   | `/color` + `/voice` + `/focus` session coverage        |
| Scheduled Work              | Ratio              | `all_sessions`             | scheduled session count                                |
| Remote & Mobile             | Ratio              | `all_sessions`             | remote session count                                   |
| Learning                    | Binary + ratio     | `interactive_cli`          | `★ Insight` banner detection in transcripts            |

**Model & Effort Tuning** is the only dimension that remains partially measured:
the Opus-usage half is scored from transcripts; the effort-level half stays
settings-only (Platform Setup axis). The `gapReason` field is non-null for this
dim, which causes the radar to render it with an italic label and a `¹` footnote.

---

## Effect on the Execution composite

Before CCE-76, Memory and Customization routed to `noTelemetry()` and were
excluded from the Execution average. Their real scores — Memory: 16,
Customization: 3 — were not represented.

Including them dropped the Execution composite from 77 to 66. **This is the
correct number.** The drop is not a regression; it is the cost of honest
measurement. Two dimensions with genuinely low usage were previously invisible
to the average.

If you see a large delta between Platform Setup and Execution after upgrading
to v0.9.20, the most likely source is Memory and Customization. The top
next-actions in `rankedNextActions` will point at those two dimensions first.

---

## Invariants enforced by the design

Three hard rules from `CLAUDE.md` shaped this scorer:

1. **Numerator universe ⊆ denominator universe.** Declared via `withGates({
   universe })` and enforced at construction. Violating it produces ratios above
   100% (PR #97 regression — `planModeSessionCount / multiTaskSessionCount =
   105.88%`).

2. **Per-field semantic categorization before summing.** Every signal in a ratio
   numerator must share the same (time window × counter class). `focusCommandUses`
   and `rewindCommandUses` were rebaselined to per-session-coverage before being
   added to the Customization numerator. Mixing a per-message counter with
   per-session counters produces a denominator-mismatch even if the universe is
   correct.

3. **Posture commands gated to `interactive_cli ∪ unknown`.** Commands that
   reflect user posture (hygiene, UX, focus) are only meaningful in
   user-initiated sessions. `sdk_orchestrated`, `observer`, and `subagent`
   sessions run with SDK defaults and would silently dilute posture ratios if
   included.

---

## Related pages

- [Memory & Customization Execution Scorers — decision record](./2026-06-01-memory-customization-execution-scorers.md)
- [Design spec: CCE-79 Memory scorer redesign](../superpowers/specs/2026-06-04-cce79-memory-scorer-redesign-design.md)
- [Probe implementation status tracker](../superpowers/specs/2026-05-25-probe-implementation-status.md)
- [Methodology page](http://localhost:3737/methodology) — live formula breakdown per scorer
