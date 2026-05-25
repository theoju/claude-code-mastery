# Probe Coverage Expansion — Design Spec

**Date:** 2026-05-25
**Source artifact:** `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`
(the coverage audit — Part 2 untracked tips + Part 3 findings F1–F5).
**Predecessor pattern:** `docs/superpowers/specs/2026-05-10-probe-closure-and-validation-design.md`
(the 5-layer probe-wiring contract and the predicate-first default).

## Goal

Close the **implementable** subset of the coverage audit's gaps — the items whose
data source was empirically confirmed to exist — and add a structural guard so the
F2/F3 drift class cannot silently recur.

Concretely, move three Boris tips from untracked → tracked, and resolve four
findings:

- **Tip 42 (Auto Mode), platform** — wire the orphan `permissionsDefaultMode` signal.
- **Tip 41 (PostCompact hook), platform** — add `hasPostCompactHook` from data already parsed.
- **Tip 2 (Model selection / Opus), execution** — new transcript scanner; gives the
  `model-effort` dimension its first-ever Execution signal.
- **F1/F2/F3** — fix the doc count, the missing catalog entry, the mislabeled citations.
- **F5** — add drift-guard tests backed by a structured `borisTip` field.

## Empirical basis (verified 2026-05-25)

Per the repo's hard rule ("verify telemetry fields before scoring against them"),
each new signal's source was confirmed before this spec was written:

| Signal                   | Evidence                                                                                                                                                                                                  | Status                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `permissionsDefaultMode` | `signals.mjs:758` reads `settings.permissions.defaultMode`; `run-assessment.mjs:167` forwards it to `signalsSummary`; **grep confirms 0 consumers** in `score.mjs` / `rubric.json` / `probe-catalog.json` | Orphan — collected, unused                  |
| `hasPostCompactHook`     | `signals.mjs:744` already emits `hookEvents: Object.keys(hooks)`; `"PostCompact"` is a valid hook-event key                                                                                               | Derivable, no new read                      |
| Opus model usage         | Transcript assistant turns carry `message.model` (sampled value `claude-opus-4-7`); user-line metadata carries `gitBranch`/`cwd`/`version`/`isSidechain`                                                  | Confirmed in `~/.claude/projects/*/*.jsonl` |

Explicitly **not** implementable (no confirmed source) and therefore **out of scope**:
CLI-flag tips 38/57/58/59 (launch args absent from transcript lines), auto-naming
39/86 (no session-name field), mobile/desktop/cowork 46/50/52 (origin not confirmed),
fork 53 (previously blocked), sandbox 21 (settings key unconfirmed — this machine has
none), and the prose/coaching tips 12/27/66/70/74.

## Scope

Four workstreams, delivered as three stacked PRs (guards first, so the later probes
are _forced_ by the new test to register in the catalog).

### Workstream A — Drift guards + F1/F2/F3 fixes (PR1)

**Structural change:** add an explicit `borisTip` field to every next-action in
`rubric.json` (integer, or array for multi-tip actions). The prose "Boris tip N"
suffix stays and must agree with the field. Actions that cite no tip get
`borisTip: null`.

`borisTip` assignments (extracted from current prose; ⚠️ = F3 correction):

| Action id                     | borisTip                 |
| ----------------------------- | ------------------------ |
| hook-formatter                | 7                        |
| ship-command                  | 5                        |
| verify-agent                  | [14, 73]                 |
| stop-hook                     | 13                       |
| simplify-skill                | 29                       |
| auto-mode-on                  | 42                       |
| fewer-permission-prompts      | 69                       |
| wildcard-allowlist            | 20                       |
| fewer-perms-skill             | 69                       |
| effort-xhigh                  | [67, 72]                 |
| effort-max-reflex             | 34                       |
| auto-compact-window           | 64                       |
| worktree-aliases              | 1                        |
| batch-sweep                   | 30                       |
| agent-isolation               | 28                       |
| chrome-extension              | 51                       |
| go-reflex                     | 73                       |
| branch-diff                   | 10                       |
| code-review-plugin            | **32** ⚠️ (was cited 44) |
| auto-dream                    | 45                       |
| rewind-reflex                 | 62                       |
| claude-md-corrections         | 4                        |
| btw-side-channel              | [33, 54]                 |
| compact-clear-balance-compact | 63                       |
| compact-clear-balance-clear   | 63                       |
| goal-constraints-template     | 66                       |
| plan-then-launch              | 65                       |
| vercel-cli                    | null                     |
| slack-mcp                     | 9                        |
| claude-in-chrome              | **51** ⚠️ (was cited 32) |
| mcp-servers                   | 9                        |
| per-worktree-color            | 40                       |
| focus-mode                    | 71                       |
| spinner-verbs                 | 25                       |
| voice-input                   | 60                       |
| babysit-loop                  | 48                       |
| stop-hook-notification        | 75                       |
| promote-routine               | 61                       |
| remote-control                | 47                       |
| ios-task                      | 46                       |
| spaced-repetition-skill       | 15                       |
| output-style-tuned            | **26** ⚠️ (was cited 34) |
| post-compact-hook (new, WS-B) | 41                       |

**New test** — `scripts/__tests__/rubric-integrity.test.mjs`:

1. **Catalog completeness** — every distinct `satisfiedWhen` LHS field has an entry
   in `probe-catalog.json`. _Catches F2-class._
2. **borisTip validity** — every non-null `borisTip` value (or array element) is an
   integer in 1–75, **and** the set of numbers parsed from the prose `Boris tip …`
   suffix equals the `borisTip` set. _Catches typos + prose/field divergence._
3. **Audit cross-ref (informational)** — log each `borisTip → boris-tip-index topic`
   so a reviewer can eyeball mis-assignment (cannot be a hard assertion — see Risks).

**Folded-in fixes:** F2 (`colorCommandUses` catalog entry, source `history`);
F3 (the three ⚠️ prose corrections above + `probe-catalog.json` `hasCustomSpinnerVerbs`
description `tip 4`→`tip 25`); F1 (`CLAUDE.md` "87 workflow tips"→"75").

### Workstream B — PostCompact hook probe, tip 41 (PR2)

- `buildSignalsSummary` derives `hasPostCompactHook` from the existing
  `signals.settings.hookEvents` (`includes("PostCompact")`). No new filesystem read.
- New automation next-action `post-compact-hook`,
  `satisfiedWhen: "hasPostCompactHook"`, `borisTip: 41`, text: "Add a PostCompact
  hook to re-inject critical instructions after context compaction — Boris tip 41".
- `probe-catalog.json` entry (source `settings`).
- Predicate-only (no scorer change): automation Platform already credits
  `hookTotalCount` generically.

### Workstream C — Auto Mode platform wiring, tip 42 (PR2)

- `auto-mode-on` next-action predicate: `!skipDangerous` →
  `"permissionsDefaultMode=auto & !skipDangerous"` (direct positive signal AND
  bypass-off). Uses the existing `&` / `=` / `!` predicate DSL operators.
- `probe-catalog.json` entry for `permissionsDefaultMode` (source `settings`).
- **Calibration touch (approved):** in `score.mjs` `permissions` Platform scorer,
  add `+10` credit when `permissionsDefaultMode === "auto"`. The scorer currently
  rewards the _absence_ of `skipDangerous` but never the _presence_ of auto mode —
  this closes that asymmetry. Pre-clamp; permissions target is 85.

### Workstream D — Opus execution scanner, tip 2 (PR3)

- **Scanner** (`scripts/_usage-data.mjs`, alongside `scanTranscriptModes`): for each
  session, tally assistant-turn `message.model`; mark the session **Opus-dominant**
  if a strict majority of its assistant turns match `/opus/i`. Emit
  `opusDominantSessionCount` (interactive_cli sessions only) and
  `opusModelMatchesTotal` (for evidence copy, mirroring `learningModeMatchesTotal`).
  These flow onto `s.insights` via the existing transcript-modes plumbing.
- **Scorer** (`scripts/score.mjs`): replace `"model-effort": noTelemetry()` with
  `withGates({ transcripts: true, universe: "interactive_only" }, …)`:
  `ratio = opusDominantSessionCount / interactiveSessionsAnalyzed`,
  `score = clamp(round(ratio * 100))`. Returns `NO_TRANSCRIPTS` gap when transcripts
  are off; `NO_SESSIONS` when the interactive denominator is 0.
- **Documented caveat:** this measures the **model** half of "Model & Effort" (Opus
  adoption). Effort level is not logged per-turn, so it remains settings-only on the
  Platform axis and _unmeasured_ on Execution. The dimension's Execution vertex now
  reflects Opus usage specifically.
- **Doc/UI updates:** `app/methodology/page.tsx` (model-effort execution row +
  caveat), CLAUDE.md project memory ("three … route to unmeasured" → **two**: Memory
  & Context, Terminal & Customization), and the audit spec
  `2026-05-25-probe-implementation-status.md` (flip tip 2 to ✅, update F4 + the
  unmeasured-dimension count).

## Architecture

Each probe follows the established 5-layer touch list (see the probe-closure spec):

```
settings.json / transcripts ─▶ signals.mjs / _usage-data.mjs   (collect)
                                        │
                              run-assessment.mjs#buildSignalsSummary (forward)
                                        │
                    ┌───────────────────┼────────────────────┐
                    ▼                   ▼                     ▼
            rubric.json           probe-catalog.json     score.mjs
            (satisfiedWhen +      (probes page +         (scorer credit /
             borisTip)            F5 guard target)        execution scorer)
```

- WS-A touches `rubric.json` (borisTip + predicate/citation fixes), `probe-catalog.json`,
  CLAUDE.md, and adds `rubric-integrity.test.mjs`.
- WS-B/C touch `signals`/`run-assessment` (B only), `rubric.json`, `probe-catalog.json`,
  `score.mjs` (C only).
- WS-D touches `_usage-data.mjs`, `insights-signals.mjs` (surface the field),
  `score.mjs`, methodology page, CLAUDE.md, and the audit spec.

## Testing

TDD per the repo bar — one failing test before each probe, plus contract updates so
nothing cascades to NaN:

- `scripts/__tests__/_fixtures.mjs` — `makeSignals` gets `hasPostCompactHook`,
  `permissionsDefaultMode`; `makeInsights` gets `opusDominantSessionCount`,
  `opusModelMatchesTotal`.
- `scripts/__tests__/build-signals-summary.test.mjs` — `expectedKeys` + inline
  snapshot get `hasPostCompactHook` (and `permissionsDefaultMode` already exists).
- `app/lib/__tests__/rubric-predicates.test.ts` — `ALL_SATISFIED_SIGNALS` gets
  `hasPostCompactHook: true`, `permissionsDefaultMode: "auto"`.
- New: `rubric-integrity.test.mjs` (the F5 guards).
- New: scanner unit test (model-mix sessions → correct Opus-dominant count) and
  `EXECUTION_SCORERS["model-effort"]` unit test (ratio → score, gates).
- Score-impact check: capture `npm run assess` Setup/Execution before & after WS-C
  and WS-D; calibrate only if the swing is unexpectedly large (probe-closure risk #3).

## Risks

1. **Citation correctness is not fully machine-checkable.** The F5 guard catches
   typos, out-of-range, prose/field divergence, and missing catalog entries — but
   **not** a human picking a plausible-but-wrong tip number (the F3 root cause). The
   informational cross-ref (test #3) surfaces candidates for human review; it cannot
   hard-fail without an authoritative action→tip map we don't want to duplicate.
2. **WS-C and WS-D move real scores.** Permissions Platform rises for auto-mode
   users; `model-effort` Execution goes from _unmeasured_ to a real number, which
   also changes the `executionOverall` denominator (one more dimension averaged in).
   Historical `executionOverall` comparisons will show a step at this change. Mitigate
   by documenting expected deltas in the plan and gating on noise-floor.
3. **Opus-dominance majority rule edge cases.** Sessions with an even split, zero
   assistant turns, or only subagent-model turns. Define: ties and zero-turn sessions
   are **not** Opus-dominant; the scan counts only `interactive_cli` sessions in both
   numerator and denominator.
4. **Multi-tip `borisTip` arrays** complicate the prose-match assertion. The test
   parses _all_ `tip N`/`N/M`/`N+M`/`N, M` numbers from the suffix and compares as a
   set, so `14/73`, `33+54`, `67, 72` round-trip correctly.

## Success criteria

1. Tips 2, 41, 42 read ✅ in a refreshed `2026-05-25-probe-implementation-status.md`;
   findings F1/F2/F3/F5 marked resolved.
2. `rubric-integrity.test.mjs` is green and would fail if (a) a `satisfiedWhen` LHS
   lacked a catalog entry, or (b) a `borisTip` diverged from its prose suffix.
3. `model-effort` returns a numeric Execution score against a transcript-scanned run
   (was `null`/unmeasured); `npm run assess --include-transcripts` shows it on the
   radar's Execution polygon.
4. Full suite green; `_fixtures` / `expectedKeys` / snapshot / `ALL_SATISFIED_SIGNALS`
   all carry the new fields (no NaN cascade).
5. Setup/Execution overall move only by the documented, calibrated amount.

## Delivery shape

Three stacked PRs, base-on-base per repo convention:

1. **PR1 — guards + fixes (WS-A).** Smallest, highest integrity value. Landing the
   catalog-completeness test _first_ means PR2/PR3 cannot merge a probe without its
   catalog entry.
2. **PR2 — settings probes (WS-B + WS-C).** PostCompact + auto-mode wiring + the +10
   calibration. Mechanical; one scorer touch.
3. **PR3 — Opus execution scanner (WS-D).** The capability change + methodology /
   CLAUDE.md / audit-spec updates.

## Out of scope (deferred)

- CLI-flag probes (38/57/58/59), auto-session-naming (39/86), mobile/desktop/cowork
  origin (46/50/52), fork (53), sandbox (21) — all blocked on an unconfirmed or
  absent data source. Revisit if a schema-sampling pass identifies the field.
- Push-notification signal (`agentPushNotifEnabled`, tip 75 alt) — tip 75 is already
  tracked via `hasStopHookNotification`; marginal.
- Effort-level Execution measurement — effort is not logged per-turn; stays
  settings-only.
- Re-numbering the data files to a 76–87 superset (F1 is resolved by correcting the
  count, not by backfilling).
