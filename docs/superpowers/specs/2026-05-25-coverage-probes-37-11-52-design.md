# Coverage Probes — Tips 37 / 11 / 52 Design Spec

> **For agentic workers:** REQUIRED NEXT STEP: invoke `superpowers:writing-plans` to turn this spec into an implementation plan.

**Date:** 2026-05-25
**Status:** Approved design — ready for planning.
**Tracking:** follow-on to the probe-coverage expansion (CCE-24, v0.9.10). Triage source: `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` Part 2 (the 14 `❌` untracked tips).

## Goal

Instrument the **three** untracked Boris tips that have a confirmed signal source in this install, moving the tracker's `❌` count from 14 → 11. Each becomes a small probe on the **Platform Setup** axis, following an existing proven pattern. Also reclassify the remaining 11 untracked tips into "blocked-until-a-field-appears" vs "permanently blocked" so the tracker stops lumping unequal cases.

## Background — why only these three

An empirical triage (read against this install's real `~/.claude/settings.json`, `~/.claude.json`, transcripts, `history.jsonl`, `usage-data/{facets,session-meta}`) found:

- **Launch flags leave no trace.** Tips 38 (`--name`), 57 (`--bare`), 58 (`--add-dir`) configure the session at startup and never appear in any of the five signal layers (verified by empty `claude --<flag>` greps). Not instrumentable.
- **No matching field exists today** for tips 21 (sandbox), 50 (cowork), 53 (fork), 70 (recaps) — they'd each need a settings key, slash command, or session-meta field that this install does not have.
- **Umbrella / automatic / meta tips** (12 bug-fixing, 27 customize, 39 auto-naming, 74 changelog) have no isolable user posture.
- **Three have real, confirmed signals** → this spec.

## Scope — the three probes

All three are scored on the **Platform Setup axis** via a `satisfiedWhen` predicate, exactly like `colorCommandUses` / `hasClaudeInChrome` / `hasPostCompactHook`. No new Execution scorer; no change to session-kind classification or any shared universe.

### Tip 37 — Setup Scripts → `automation` dimension

- **Signal:** `hasSessionStartHook` = `(settings.hookEvents || []).includes("SessionStart")`.
- **Pattern copied:** tip 41 `hasPostCompactHook` (PR #74), verbatim shape.
- **Layers:**
  - _collect_ — none new; `hookEvents` is already extracted in `scripts/signals.mjs`.
  - _forward_ — `scripts/run-assessment.mjs#buildSignalsSummary`: add `hasSessionStartHook: (signals.settings.hookEvents || []).includes("SessionStart")` beside the existing `hasPostCompactHook` line.
  - _predicate_ — `app/data/rubric.json` `automation` dimension: new next-action `setup-script-hook`, `satisfiedWhen: "hasSessionStartHook"`, `borisTip: 37`; add `37` to the dimension's `borisTips`.
  - _catalog_ — `app/data/probe-catalog.json`: add `hasSessionStartHook` (source `settings`, path `~/.claude/settings.json#hooks.SessionStart`).
  - _score_ — no explicit credit; rides the generic `hookTotalCount` credit in the automation scorer, identical to how tip 41 contributes. (The probe adds coverage + a next-action card, not score inflation.)

### Tip 11 — Terminal Setup → `customization` dimension

- **Signal:** `hasTerminalSetup` — true when a terminal is configured, defined as **either** condition: `(typeof cliConfig.deepLinkTerminal === "string" && cliConfig.deepLinkTerminal.length > 0)` (this install: `"iTerm"`) **OR** `cliConfig.optionAsMetaKeyInstalled === true`. Both are checked; either one satisfies the probe.
- **Pattern copied:** `detectClaudeInChrome` / `detectRemoteControl` in `scripts/signals.mjs` (both read `~/.claude.json` `cliConfig`).
- **Layers:**
  - _collect_ — `scripts/signals.mjs`: add a `detectTerminalSetup(cliConfig)` helper next to `detectClaudeInChrome`; wire its result into the `settings` block of the `gatherSignals` return as `hasTerminalSetup`. (The implementer must confirm the exact `cliConfig` accessor used by the sibling detectors before adding.)
  - _forward_ — `buildSignalsSummary`: `hasTerminalSetup: !!signals.settings.hasTerminalSetup` (mirror `hasClaudeInChrome`).
  - _predicate_ — `rubric.json` `customization`: new next-action `terminal-setup`, `satisfiedWhen: "hasTerminalSetup"`, `borisTip: 11`. (`customization` already lists tip 11 in `borisTips`.)
  - _catalog_ — `probe-catalog.json`: add `hasTerminalSetup` (source `settings`, path `~/.claude.json#deepLinkTerminal`).
  - _score_ — small credit in the customization scorer, mirroring the existing `hasCustomSpinnerVerbs` credit (amount to match its sibling; pin by reading the scorer).
- **Overlap note:** distinct from tip 16 "Terminal Config" (statusline/keybindings). `deepLinkTerminal`/`optionAsMetaKey` are different fields, so no double-count.

### Tip 52 — Desktop App → `verification` dimension

- **Signal:** `desktopSessionCount` (predicate `desktopSessionCount>=1`), derived from transcript `entrypoint: "claude-desktop"` (confirmed present at line 3 of desktop session transcripts).
- **Pattern copied:** `colorCommandUses` — a transcript-derived count forwarded into `signalsSummary` and used in a `>=1` predicate.
- **Critical safety property:** **do NOT modify `classifySessionKind`.** It currently folds `claude-desktop` into `interactive_cli`, the denominator for the permissions/plan/learning/model-effort posture ratios. Splitting it would silently regress those four scores. Instead, capture the entrypoint in `scanTranscriptModes` (which already reads the whole transcript) and aggregate a separate additive count.
- **Layers:**
  - _collect_ — `scripts/_usage-data.mjs` `scanTranscriptModes`: add `let entrypoint = null;`, set it from the early `entry.entrypoint` line, and return it in the result object (alongside `assistantTurns` / `opusAssistantTurns`).
  - _forward (aggregate)_ — `scripts/insights-signals.mjs` `gatherInsightsSignals`: where it already destructures `assistantTurns`/`opusAssistantTurns` from `scanTranscriptModes`, also read `entrypoint` and increment `desktopSessionCount` when it equals `"claude-desktop"`. Count unconditionally (adoption/volume signal — no universe gating). Surface `desktopSessionCount` in the insights result.
  - _forward (summary)_ — `buildSignalsSummary`: forward `desktopSessionCount: signals.insights?.desktopSessionCount ?? 0` (direct insights value; not a `maxProbe`/history merge — desktop is not a `/command`).
  - _predicate_ — `rubric.json` `verification`: new next-action `desktop-app`, `satisfiedWhen: "desktopSessionCount>=1"`, `borisTip: 52`. (`verification` already lists tip 52, alongside Chrome 51.)
  - _catalog_ — `probe-catalog.json`: add `desktopSessionCount` (source `transcripts`, path `~/.claude/projects/*/*.jsonl#entrypoint`).
  - _score_ — small credit in the verification scorer, mirroring the `hasClaudeInChrome` credit.

## Testing

TDD per probe. Each predicate-backed probe is automatically guarded by the existing `scripts/__tests__/rubric-integrity.test.mjs` (it asserts every `satisfiedWhen` LHS has a `probe-catalog.json` entry and every `borisTip` resolves) — so a missing catalog entry or bad tip number fails the suite. In addition:

- **Tip 37:** unit test that `buildSignalsSummary` sets `hasSessionStartHook` true when `hookEvents` includes `"SessionStart"` and false otherwise. (Fixture-level in `scripts/__tests__/`.)
- **Tip 11:** unit test for `detectTerminalSetup` — true when `deepLinkTerminal` is a non-empty string, false on `null`/`undefined`/`""`.
- **Tip 52:** `scanTranscriptModes` returns `entrypoint` for a desktop fixture; `gatherInsightsSignals` increments `desktopSessionCount` for a `claude-desktop` session and **does not** for a `cli` session (the control case that proves no over-count). Assert `classifySessionKind`'s `interactive_cli` result is unchanged for a desktop transcript (regression guard for the universe).
- Full suite green (current baseline 539; new tests add to it — the plan states the exact expected count after writing them).

## Tracker update

In `docs/superpowers/specs/2026-05-25-probe-implementation-status.md`:

- Flip tips **37, 11, 52** from `❌` to `✅` in Part 2 with their new probe names.
- Update the tally: `❌` 14 → 11.
- Reclassify the remaining 11 untracked tips into two explicit groups (replacing the single "Entirely absent" lump):
  - **Blocked-until-a-field-appears** (instrumentable if a signal source ships): 21 sandbox, 38 `--name`, 50 cowork, 53 fork, 58 `--add-dir`, 70 recaps.
  - **Permanently blocked** (umbrella / automatic / launch-flag-no-trace / changelog): 12, 27, 39, 57, 74.
- Add a one-line note recording the triage source (this spec) and that launch flags are categorically untrackable.

## Packaging

**One PR**, four commits: one TDD commit per tip (37, 11, 52) plus the tracker-update commit. The three probes are independent and tiny; a stacked-PR sequence would be pure overhead (YAGNI). Ship via `/ship` from a feature branch; squash-merge from the main checkout.

## Out of scope

- The 11 non-instrumentable tips beyond the tracker reclassification (no probes).
- Any change to `classifySessionKind`, the `interactive_cli` universe, or existing Execution scorers.
- An Execution scorer for desktop usage (the predicate suffices; a future Execution scorer could reuse `desktopSessionCount` if justified).
- Score recalibration of existing dimensions.
