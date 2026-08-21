# Probe Implementation Status — Coverage Tracker

**Date:** 2026-05-25
**Status:** Living tracker — update on every probe add/remove.
**Validated against:** `app/data/boris-tip-index.json` (75 tips), `app/data/rubric.json`
(12 dimensions / 48 next-actions), `app/data/probe-catalog.json` (50 probes +
the `_meta` sidecar), `scripts/score.mjs` (`SCORERS` + `EXECUTION_SCORERS`),
`scripts/_usage-data.mjs` (transcript scanners),
`scripts/run-assessment.mjs#buildSignalsSummary` (74 `signalsSummary` keys).
**CCE-164** (2026-08-20) fixed `classifySessionKind`, which had been
misclassifying 43% of in-window sessions as `unknown` — see the
`[^partition]` footnote. **No probe-set change**: no probes, catalog entries,
or `signalsSummary` keys were added or removed, so the five machine-enforced
header counts above are unchanged. What changed is what the existing
`interactive_cli` / `unknown` buckets *contain*.
Snapshot current as of **CCE-33 branch** (adds three progression milestone detectors for
`scheduled` tip 48, `remote` tip 35, `verification` tip 73 — no probe-set change,
no count changes). **v0.9.17** shipped two
scoring-accuracy fixes (no probe-set change): the planning Execution scorer's
ratio numerator switched to `planModeMultiTaskSessionCount`
(interactive ∩ multi_task ∩ plan_mode) so the plan-mode ratio can no longer
exceed 100% (#97), and `/color` is now counted from `history.jsonl`
(#96, Boris tip 40). The **runtime-adoption probes** shipped in
**v0.9.16 / #94**: `coworkDispatchAdopted` (tip 50, axis A →
`parallel` Execution scorer) and `opus47AwarenessAdopted` (tip 74, awareness proxy
→ `model-effort` Execution scorer), plus four non-predicate runtime signals:
`cliBtwUseCount` (tip 33 MAX-merge), `planModeRecencyDays` (planning recency),
`skillsUsedRecently` (learning recency), and `aiTitlePresent` (tip 39, info-only),
and the tip-27 customization-breadth composite (≥4 surfaces → +10 pts in the
`customization` Platform scorer). The `/effort max` reflex probe
(`effortMaxAdopted` derived OR + `effortMaxCommandUses` transcript counter, tip 34)
shipped earlier in **#85 / CCE-29**. The prior
**v0.9.11** baseline added the three coverage probes `hasSessionStartHook`
(tip 37), `hasTerminalSetup` (tip 11), `desktopSessionCount` (tip 52) in #79 / CCE-25.
**v0.9.10** was the probe-coverage expansion (#72 `colorCommandUses`, #73 integrity
guards, #74 PostCompact + auto-mode, #75 Opus exec scorer) plus the radar hydration
fix (#71), tracked as **CCE-24**.

## Purpose

This is the single current source of truth for **which probes are implemented and
what they cover**. It answers, per Boris tip and per tracked behavior: is it
tracked, by what probe, and on which axis (Platform Setup vs Execution).

It is probe-centric and current. It supersedes the _probe-status_ portions of two
earlier artifacts (which remain valid for their own purposes):

- `docs/tip-classification-2026-05-10.md` — tip-centric analysis snapshot (v3.4)
  with 30-day score trajectories. Now stale vs. code (cites `hasPostToolHook` for
  tip 7 where the rubric uses `hasFormatterHook`; predates `colorCommandUses`).
- `docs/superpowers/specs/2026-05-10-probe-closure-and-validation-design.md` —
  frozen design spec for the PR #45–#49 probe-closure project. Historical.

## Canonical scope: 75 tips (not 87)

The repo data files (`boris-tip-index.json`, `boris-tips-content.json`) define
exactly **75** tips, keyed `"1"`–`"75"` (`$schema`: "section numbers (1-75)"). The
`87`-tip figure that appears in `CLAUDE.md` and the older classification doc is an
**analytical superset**: rows 76–87 were hand-backfilled from
`docs/boris-tips-reference-2026-05-10.md` and never landed in the data files. The
self-assessment scores against the 75 canonical tips only. (See Finding F1.)

## Axis legend

- **P** — Platform Setup: feeds `SCORERS[dim]` (`score.mjs`) or a `satisfiedWhen`
  next-action gate. Two flavors, distinguished in the Part 1 registry:
  - **P (config)** — Settings / Filesystem / Plugins: "is it installed/configured?"
  - **P\* (behavior)** — Transcripts: a transcript-derived _usage_ signal ("do you
    _do_ it?") that gates a Platform-Setup next-action or feeds a Platform-Setup
    scorer — **not** an `EXECUTION_SCORERS` input. It drives next-action filtering /
    the Platform-Setup score, _not_ the Execution radar vertex. So `effortMaxCommandUses`
    counts real usage yet is correctly **P\***, not E. (Marker used in the Part 1
    Transcripts table only; Part 2 keeps dimension-level P / E / P+E.)
- **E** — Execution scorer present: a probe consumed by an `EXECUTION_SCORERS.<dim>`
  body (sourced from cooked telemetry **and/or** transcript counters as appropriate).
  "Do you actually use it?" — the radar's Execution vertex.
- **P+E** — both axes scored.
- **P / exec unmeasured** — the specific signal is not consumed by any
  `EXECUTION_SCORERS.<dim>` body, so Execution carries no information about
  _this_ probe. Independent of whether the parent dim is E-scored on other
  signals: e.g. tips 4 (`claudeMdExists`) and 45 (`autoMemoryEnabled`) live in
  the now-E-scored `memory` dim, but the memory Execution scorer reads
  `/clear`+`/compact` (CCE-79: numerator narrowed from the original four-command
  blend), not these flags. Renders as _unmeasured_, not zero.

## Tracking-status legend

- ✅ **Direct probe** — a `satisfiedWhen` predicate OR a dedicated scorer signal
  isolates this exact behavior.
- 📊 **Shared signal** — feeds a scorer via a generic signal (e.g. `hookTotalCount`
  for any hook tip), not isolated to the tip.
- 🗣 **Coaching only** — has a next-action card but no auto-detect predicate.
- ❌ **Untracked** — no probe, no scorer signal, not in any dimension's `borisTips`.

---

## Part 1 — Implemented probe registry

Every implemented signal, grouped by source layer. `signalsSummary` field names are
the LHS of `satisfiedWhen` predicates. "Catalog" = present in `probe-catalog.json`
(drives `/methodology/probes`).

> **Relation to the dashboard `/methodology/probes` page.** That page renders
> only the **predicate-backed** probes — one card per rubric next-action with a
> `satisfiedWhen` — so its check count is _smaller_ than this registry's row
> count (which also lists Insights/Execution signals and non-catalog `—` rows).
> It groups by the catalog `source` field, **not** the source _layer_ headings
> here: the command counters surface under a **`history`** source rather than
> under Transcripts, and cooked-telemetry signals don't appear at all (they
> aren't predicate-backed — they drive the radar). Each source group is
> axis-labeled **P** / **P\***, mirroring the [Axis legend](#axis-legend)
> above. One catalog entry, `sessionsByKind`, is metadata-only (the session
> census), not a predicate.

### Settings (`~/.claude/settings.json`, `~/.claude.json`) — readers in `signals.mjs`

| Field                     | Predicate / use                                                                                | Catalog | Axis |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------- | ---- |
| `outputStyle`             | `outputStyle=Explanatory\|Learning` (learning)                                                 | ✅      | P    |
| `effortLevel`             | `effortLevel=xhigh\|max`, `=max` (model-effort)                                                | ✅      | P    |
| `skipDangerous`           | `!skipDangerous` (permissions)                                                                 | ✅      | P    |
| `allowListCount`          | `allowListCount>=10` (permissions)                                                             | ✅      | P    |
| `hasWildcardAllow`        | `hasWildcardAllow` (permissions)                                                               | ✅      | P    |
| `autoCompactWindow`       | `autoCompactWindow` (model-effort)                                                             | ✅      | P    |
| `autoMemoryEnabled`       | `autoMemoryEnabled` (memory) — inverse of `CLAUDE_CODE_DISABLE_AUTO_MEMORY`                    | ✅      | P    |
| `hasStopHook`             | `hasStopHook` (automation)                                                                     | ✅      | P    |
| `hasPostCompactHook`      | `hasPostCompactHook` (automation)                                                              | ✅      | P    |
| `hasSessionStartHook`     | `hasSessionStartHook` (automation) — `hookEvents` includes `SessionStart`, Boris tip 37        | ✅      | P    |
| `hasFormatterHook`        | `hasFormatterHook` (automation)                                                                | ✅      | P    |
| `hasStopHookNotification` | `hasStopHookNotification` (scheduled)                                                          | ✅      | P    |
| `hasCustomSpinnerVerbs`   | `hasCustomSpinnerVerbs` (customization)                                                        | ✅      | P    |
| `hasClaudeInChrome`       | `hasClaudeInChrome` (verification, integrations)                                               | ✅      | P    |
| `hasRemoteControl`        | `hasRemoteControl` (remote)                                                                    | ✅      | P    |
| `hasTerminalSetup`        | `hasTerminalSetup` (customization) — `~/.claude.json` deep-link / Option-as-Meta, Boris tip 11 | ✅      | P    |
| `mcpServersConnected`     | `mcpServersConnected>=3` (integrations)                                                        | ✅      | P    |
| `permissionsDefaultMode`  | `permissionsDefaultMode=auto` (permissions); permissions scorer +10                            | ✅      | P    |
| `hookTotalCount`          | automation scorer credit (generic)                                                             | —       | P    |
| `hookEvents`              | Stop-hook presence (scheduled), evidence                                                       | —       | P    |
| `hasPostToolHook`         | scorer/evidence (generic PostToolUse)                                                          | —       | P    |
| `statuslineConfigured`    | customization scorer (+15)                                                                     | —       | P    |
| `keybindingsConfigured`   | customization scorer (+10)                                                                     | —       | P    |

### Filesystem (`~/.claude/{agents,commands,skills,projects}`) — `signals.mjs`

| Field                                                          | Predicate / use                                       | Catalog | Axis |
| -------------------------------------------------------------- | ----------------------------------------------------- | ------- | ---- |
| `claudeMdExists`                                               | `claudeMdExists` (memory)                             | ✅      | P    |
| `personalSkillNames`                                           | `personalSkillNames~spaced\|repetition\|…` (learning) | ✅      | P    |
| `hasShipCommand`                                               | `hasShipCommand` (automation)                         | ✅      | P    |
| `hasVerifyAgent`                                               | `hasVerifyAgent` (automation)                         | ✅      | P    |
| `hasIsolatedAgent`                                             | `hasIsolatedAgent` (parallel)                         | ✅      | P    |
| `personalAgents` / `personalCommands` / `personalSkills`       | automation + parallel scorer counts                   | —       | P    |
| `projectsWithMemory`                                           | memory scorer                                         | —       | P    |
| `shipsRecent` / `shipVerifyStageRecent`[^journal-stage-credit] | automation / verification scorer (`shipJournal`)      | —       | P    |
| `worktreeAliasCount` / `worktreeShortcutCount`                 | `parallelWorktreeAdoption` OR-inputs                  | —       | P    |
| (`plansCount`)                                                 | memory + planning scorer (`>=10`)                     | —       | P    |

### Plugins (`enabledPlugins`, PATH) — `signals.mjs`

| Field                                                                                                                                                      | Predicate / use                           | Catalog | Axis |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------- | ---- |
| `hasCodeReviewPlugin`                                                                                                                                      | `hasCodeReviewPlugin=true` (verification) | ✅      | P    |
| `hasSlackPlugin`                                                                                                                                           | `hasSlackPlugin` (integrations)           | ✅      | P    |
| `hasVercelCli`                                                                                                                                             | `hasVercelCli` (integrations)             | ✅      | P    |
| `hasVercelPlugin`                                                                                                                                          | integrations evidence                     | —       | P    |
| `plugins`                                                                                                                                                  | integrations scorer (`len*3`, cap 70)     | —       | P    |
| `has.{superpowers,karpathy,featureDev,skillCreator,semgrep,playwright,vercel,imessage,claudeMdMgmt,explanatoryStyle,ralphLoop,prReviewToolkit,codeReview}` | per-dimension plugin credit               | —       | P    |

### Transcripts (`~/.claude/projects/*/*.jsonl`) — `_usage-data.mjs`[^partition]

| Field                                            | Predicate / use                                                                                                          | Catalog | Axis |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------- | ---- |
| `parallelWorktreeAdoption`                       | `parallelWorktreeAdoption` (parallel)                                                                                    | ✅      | P\*  |
| `effortMaxAdopted`                               | `effortMaxAdopted` (model-effort, tip 34) — derived OR: `effortLevel=max` OR `effortMaxCommandUses>=2`                   | ✅      | P\*  |
| `effortMaxCommandUses`                           | `effortMaxAdopted` OR-input — per-session `/effort max` count (argument-aware; markup + start-anchored, transcript-only) | —       | P\*  |
| `planThenLaunchSessions`                         | `planThenLaunchSessions>=1` (planning)                                                                                   | ✅      | P\*  |
| `shipVerifyStageRecent`[^journal-stage-credit]   | `shipVerifyStageRecent>=1` (verification)                                                                                | ✅      | P\*  |
| `sessionsByKind`                                 | universe classifier (gates posture ratios)                                                                               | ✅      | —    |
| `goCommandUses`                                  | `goCommandUses>=3` (verification)                                                                                        | ✅      | P\*  |
| `batchCommandUses`                               | `batchCommandUses>=1` (parallel)                                                                                         | ✅      | P\*  |
| `simplifyCommandUses`[^journal-stage-credit]     | `simplifyCommandUses>=1` (automation)                                                                                    | ✅      | P\*  |
| `btwCommandUses`[^memory-customization-exec]     | `btwCommandUses>=1` (memory)                                                                                             | ✅      | P\*  |
| `voiceCommandUses`[^memory-customization-exec]   | `voiceCommandUses>=1` (customization)                                                                                    | ✅      | P\*  |
| `clearCommandUses`[^memory-customization-exec]   | `clearCommandUses>=1` (memory)                                                                                           | ✅      | P\*  |
| `compactCommandUses`[^memory-customization-exec] | `compactCommandUses>=1` (memory)                                                                                         | ✅      | P\*  |
| `colorCommandUses`[^memory-customization-exec]   | `colorCommandUses>=1` (customization)                                                                                    | ✅      | P\*  |
| `memoryToolSessionCount`                         | — (Execution ratio input, CCE-163: claude-mem/graphify session coverage)                                                 | ✅      | E    |
| `memoryHygieneSessions`                          | — (Execution ratio numerator, CCE-163: /clear ∪ /compact ∪ memory tools)                                                 | ✅      | E    |
| `fewerPermsCommandUses`                          | `fewerPermsCommandUses>=1` (permissions)                                                                                 | ✅      | P\*  |
| `focusCommandUses`[^memory-customization-exec]   | `focusCommandUses>=1` (customization)                                                                                    | ✅      | P\*  |
| `scheduleCommandUses`                            | `scheduleCommandUses>=1` (scheduled)                                                                                     | ✅      | P\*  |
| `loopCommandUses`                                | `loopCommandUses>=1` (scheduled)                                                                                         | ✅      | P\*  |
| `babysitLoopUses`                                | scheduled scorer (`/loop /babysit`)                                                                                      | —       | P\*  |
| `rewindCommandUses`[^memory-customization-exec]  | `rewindCommandUses>=1` (memory)                                                                                          | ✅      | P\*  |
| `desktopSessionCount`                            | `desktopSessionCount>=1` (verification) — transcript `entrypoint == "claude-desktop"`, Boris tip 52                      | ✅      | P\*  |

> All command counters are MAX-merged with `~/.claude/history.jsonl` in
> `buildSignalsSummary` via `maxProbe(field)` and gated to the lookback window.

> **Why every Axis here is `P*`, not `E`.** These are transcript-derived
> _behavior_ signals — they measure "do you _do_ it?" — yet they remain on the
> **Platform Setup** axis because they feed a `satisfiedWhen` next-action gate
> (or a Platform-Setup scorer in `score.mjs`), not an `EXECUTION_SCORERS` vertex.
> `P*` flags that distinction: a usage signal that drives next-action filtering /
> the Platform-Setup score, not the radar's Execution axis. The genuine
> Execution-axis signals are the cooked-telemetry ones in the next section (`E`).
> So a row like `effortMaxCommandUses` counts real `/effort max` usage and is
> still correctly `P*` — it gates the tip-34 next-action, it does not score
> Execution.

### Insights / cooked telemetry (`~/.claude/usage-data/`) — `insights-signals.mjs`

These drive the **Execution** scorers (no `satisfiedWhen`; consumed directly in
`EXECUTION_SCORERS`):

| Signal                                                             | Execution scorer                                                                     | Universe               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------- |
| `autoModeSessionCount`, `bypassPermissionsSessionCount`            | permissions                                                                          | interactive_only       |
| `frictionCounts.{buggy_code,wrong_approach}`                       | verification                                                                         | all_sessions           |
| `subagentSessionCount`, `worktreeUsageSessionCount`                | parallel                                                                             | interactive_only       |
| `planModeMultiTaskSessionCount`, `multiTaskSessionCount`           | planning                                                                             | interactive_only       |
| `hookFireCount` (3-state warm/cold/null)                           | automation                                                                           | interactive_only       |
| `toolInvocationsByPlugin`                                          | integrations (calls/session, target 2)                                               | all_sessions           |
| `scheduledInvocationsTotal`                                        | scheduled (1→50, ≥3→100)                                                             | all_sessions           |
| `remoteInvocationsTotal`                                           | remote (1→50, ≥3→100)                                                                | all_sessions           |
| `learningModeSessionCount`, `learningModeMatchesTotal`             | learning (★ Insight banner ratio)                                                    | interactive_only       |
| `opusDominantSessionCount`, `opusModelMatchesTotal`                | model-effort (Opus-dominant ratio)                                                   | interactive_only       |
| `interactiveOrUnknownSessionsAnalyzed`[^memory-customization-exec] | denominator universe for posture-gated Execution scorers (interactive_cli ∪ unknown) | interactive_or_unknown |

**No dimension currently routes Execution to `noTelemetry()`.** Post-CCE-76,
`memory` and `customization` are transcript-derived Execution scorers
(`scripts/score.mjs` — memory reads the two session-coverage hygiene commands
`/clear`+`/compact` (CCE-79: `/btw` rerouted to cumulative evidence text via
`cliBtwUseCountAllTime`; `/rewind` retained as a binary next-action probe
only); customization reads `/color`+`/voice`+`/focus`).
`model-effort` is **partially** measured: the model half (Opus usage, tip 2) is
scored from transcripts; effort level stays settings-only. Individual _signals_
inside a scored dimension may still be Execution-unmeasured when the scorer
doesn't consume them (e.g. tips 4 / 45 — `claudeMdExists` / `autoMemoryEnabled`
gate Platform-Setup memory next-actions but are not inputs to the memory
Execution scorer); the dimension is E-scored, but those probes' axis annotation
stays `P / exec unmeasured` because it reflects the **signal**, not the dim.

### Runtime (`~/.claude.json` behavioral-adoption flags) — `signals.mjs`

These are **durable behavioral-adoption flags** written by the CLI to
`~/.claude.json` — distinct from the Settings layer's posture/config fields in
the same file. They record _has the user ever done X_ and feed the **Execution
axis (axis A)** as adoption-credit bonuses composed into `EXECUTION_SCORERS`
via `adoptionBonus()`. They are NOT per-session rates and are NOT gated by a
session denominator.

| Field                    | Predicate / use                                                                                                                                                                                                                                                               | Catalog | Axis |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| `coworkDispatchAdopted`  | `coworkDispatchAdopted` (parallel) — `~/.claude.json#hasUsedAgentsFleet`; +15 adoption-credit in parallel Execution scorer; Boris tip 50                                                                                                                                      | ✅      | A    |
| `opus47AwarenessAdopted` | `opus47AwarenessAdopted` (model-effort) — `opus47LaunchSeenCount / unpinOpus47LaunchEffort / lastReleaseNotesSeen`; +8 awareness-proxy credit (capped-low) in model-effort Execution scorer; Boris tip 74                                                                     | ✅      | A    |
| `cliBtwUseCountAllTime`  | `cliBtwUseCountAllTime>=1` (memory) — `~/.claude.json#btwUseCount`; cumulative all-time invocation counter that backs the tip 33+54 habit predicate. CCE-78: extracted from the prior `btwCommandUses` MAX-blend so it no longer corrupts the windowed Memory Execution ratio | ✅      | A    |
| `planModeRecencyDays`    | Recency corroboration for planning Execution scorer — days since `lastPlanModeUse`; +8 pts (recency decay over 30 days)                                                                                                                                                       | —       | A    |
| `skillsUsedRecently`     | Recency corroboration for learning Execution scorer — count of skills with `lastUsedAt` within 30 days; +10 pts at 3 skills                                                                                                                                                   | —       | A    |
| `aiTitlePresent`         | Info-only: true if any scanned session has an `ai-title` transcript entry (auto session naming, tip 39). **Not scored, no rubric predicate, no probe-catalog entry.**                                                                                                         | —       | —    |

> **Axis label "A" (adoption)** is used here to mark signals from this layer;
> in Part 2 the standard P / E / P+E / P / exec unmeasured conventions apply
> at the dimension level. The runtime signals compose into Execution scorers, so
> their tip rows appear as ✅ or 📊 on the E or P+E dimension axis.

### Progression milestones (`scripts/progression.mjs`) — timeline events

These are **behavioral-milestone detectors** that walk session-meta and (optionally)
raw transcripts to emit `{timestamp, dimension, milestone, borisTip, evidence}`
events for the `/progression` timeline page. They do **not** add `satisfiedWhen`
predicates, `probe-catalog.json` entries, or new `signalsSummary` keys — they
augment the timeline's coverage of dimensions that previously had no detector.

The first nine detectors (subagents, MCP, multi-task, auto-mode, plan-mode,
worktree, explanatory-output, first-skill, stopped-bypass) were part of the
original progression implementation. The three below were added in **CCE-33** to
close the coverage gap cited in CLAUDE.md (`scheduled`, `remote`, `verification`
had no telemetry-dated detectors).

| Detector (milestone)                       | Dimension    | Evidence source                                                             | Boris tip | Axis |
| ------------------------------------------ | ------------ | --------------------------------------------------------------------------- | --------- | ---- |
| First `/loop`\|`/schedule`\|`/babysit` use | scheduled    | transcript `commands` Set                                                   | 48        | P\*  |
| First remote-tool invocation               | remote       | session-meta `tool_counts` (RemoteTrigger / PushNotification / SendMessage) | 35        | E    |
| First `/go` composite invocation           | verification | transcript `commands` Set                                                   | 73        | P\*  |

> **Axis rationale.** `scheduled` and `verification` detect transcript-level slash
> commands — the same `commands` Set introduced for the `scanTranscriptModes`
> extension — so they are **P\*** (transcript-derived behavior, feeds the Platform
> Setup axis). `remote` detects session-meta `tool_counts` (cooked telemetry), so
> it is **E** (Execution flavor, consistent with the Insights / cooked telemetry
> layer's conventions).

[^partition]: As of PR #110 (spec 2026-05-31), the nine posture commands listed below (`color`, `voice`, `focus`, `btw`, `clear`, `compact`, `simplify`, `rewind`, `fewer-permission-prompts`) are counted from transcripts only when `classifySessionKind` returns `interactive_cli` or `unknown`. Observer and SDK-orchestrated sessions still echo the primary session's `<command-name>` markup but no longer inflate posture counters. The five volume commands (`loop`, `schedule`, `babysit`, `go`, `batch`) remain counted across every scanned session kind. See `scripts/_usage-data.mjs` `POSTURE_COMMANDS` / `VOLUME_COMMANDS` for the canonical partition. **CCE-164 (2026-08-20) corrected what `unknown` means.** The classifier enumerated the machine-driven entrypoints it knew (`sdk-cli`) and let everything else fall through to `unknown`, which `interactive_or_unknown` then *admits* — so when `sdk-py` appeared upstream, 226 automated agent sessions entered the posture universe and inflated the Memory Execution denominator to 353 against a true 93. A second defect, a 5-line scan bound, hid a further 39 sessions whose `entrypoint` row sits deeper (corpus max: line 83). The classifier now uses an allow-list (`INTERACTIVE_ENTRYPOINTS = {cli, claude-desktop}`) and **fails closed**: any other entrypoint is `observer` or `sdk_orchestrated`, never `unknown`. `unknown` now means exactly one thing — no `entrypoint` row was found at all. Full analysis: `docs/superpowers/specs/2026-08-20-cce164-session-classifier-defect-design.md`.

[^journal-stage-credit]: As of PR #113 (CCE-72, spec 2026-06-01), `gatherShipJournal` counts stage execution across all three journal format generations: singular `entry.stage`, legacy-numeric `stages_run`, and new-string `stages_run`. `simplifyCommandUses` is MAX-merged with the journal's `simplifyStageCount` at the projection layer (`run-assessment.mjs`). `shipVerifyStageRecent` consumes the now-broader `stage2Count` automatically. The five machine-enforced header counts are unchanged (no new probes / catalog entries / signalsSummary keys).

[^memory-customization-exec]: As of PR #116 (CCE-76, spec 2026-06-01), these posture-command counters and the new `interactiveOrUnknownSessionsAnalyzed` denominator feed the Memory and Customization Execution scorers. Both scorers gate on `transcripts: true` and the new `interactive_or_unknown` universe option in `withGates`. The five machine-enforced header counts are unchanged (no new probes / catalog entries / signalsSummary keys); CCE-79 narrowed the memory Execution ratio numerator to `/clear`+`/compact` without adding/removing any key, so header counts remain unchanged.

---

## Part 2 — Coverage of all 75 Boris tips

| #   | Topic                     | Dim                       | Status | Probe / signal                                                                                                                                                    | Axis                |
| --- | ------------------------- | ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | Parallel Execution        | parallel                  | ✅     | `parallelWorktreeAdoption`; exec `subagent`+`worktree`                                                                                                            | P+E                 |
| 2   | Model Selection           | model-effort              | ✅     | `effortLevel` (P) + exec `opusDominantSessionCount` (Opus-dominant ratio)                                                                                         | P+E                 |
| 3   | Plan Mode                 | planning                  | ✅     | exec `planModeMultiTaskSessionCount/multiTask`; `planThenLaunchSessions`                                                                                          | P+E                 |
| 4   | CLAUDE.md                 | memory                    | ✅     | `claudeMdExists`                                                                                                                                                  | P / exec unmeasured |
| 5   | Skills & Slash Commands   | automation                | ✅     | `hasShipCommand` (+ skill/command counts)                                                                                                                         | P                   |
| 6   | Subagents                 | parallel                  | 📊     | exec `subagentSessionCount`; `personalAgents`                                                                                                                     | P+E                 |
| 7   | Hooks                     | automation                | ✅     | `hasFormatterHook`, `hasStopHook`; exec `hookFireCount`                                                                                                           | P+E                 |
| 8   | Permissions               | permissions               | 📊     | `allowListCount`, `skipDangerous`                                                                                                                                 | P                   |
| 9   | MCP Integrations          | integrations              | ✅     | `hasSlackPlugin`, `mcpServersConnected>=3`; exec `toolInvocationsByPlugin`                                                                                        | P+E                 |
| 10  | Prompting Tips            | verification              | 📊     | mapped to `shipVerifyStageRecent`                                                                                                                                 | P                   |
| 11  | Terminal Setup            | customization             | ✅     | `hasTerminalSetup` (deep-link / Option-as-Meta)                                                                                                                   | P                   |
| 12  | Bug Fixing                | —                         | ❌     | not referenced anywhere                                                                                                                                           | —                   |
| 13  | Long-Running Tasks        | automation\*              | ✅     | `hasStopHook`                                                                                                                                                     | P                   |
| 14  | Verification (#1)         | verification              | ✅     | `hasVerifyAgent`; exec friction rate                                                                                                                              | P+E                 |
| 15  | Learning with Claude      | learning                  | ✅     | `personalSkillNames~spaced`                                                                                                                                       | P                   |
| 16  | Terminal Config           | customization             | 📊     | `statuslineConfigured`/`keybindingsConfigured` (loose)                                                                                                            | P                   |
| 17  | Effort Level              | model-effort              | ✅     | `effortLevel` (effort facet; exec scorer measures the Opus facet, tip 2)                                                                                          | P                   |
| 18  | Plugins                   | integrations              | ✅     | `plugins.length`; exec `toolInvocationsByPlugin`                                                                                                                  | P+E                 |
| 19  | Custom Agents             | automation/parallel       | 📊     | `personalAgents`, `hasIsolatedAgent`                                                                                                                              | P                   |
| 20  | Permissions Management    | permissions               | ✅     | `hasWildcardAllow`, `allowListCount`                                                                                                                              | P                   |
| 21  | Sandboxing                | permissions               | ❌     | not separately probed                                                                                                                                             | —                   |
| 22  | Status Line               | customization             | 📊     | `statuslineConfigured`                                                                                                                                            | P                   |
| 23  | Keybindings               | customization             | 📊     | `keybindingsConfigured`                                                                                                                                           | P                   |
| 24  | Hooks (Advanced)          | automation                | 📊     | `hookTotalCount` (generic)                                                                                                                                        | P                   |
| 25  | Spinner Verbs             | customization             | ✅     | `hasCustomSpinnerVerbs`                                                                                                                                           | P                   |
| 26  | Output Styles             | customization/learning    | ✅     | `outputStyle`; exec `learningModeSessionCount`                                                                                                                    | P+E                 |
| 27  | Customize Everything      | customization             | ✅     | customization-breadth composite: ≥4 surfaces configured → +10 pts in Platform scorer                                                                              | P                   |
| 28  | Git Worktree Support      | parallel                  | ✅     | `hasIsolatedAgent`; exec `worktreeUsageSessionCount`                                                                                                              | P+E                 |
| 29  | /simplify                 | automation                | ✅     | `simplifyCommandUses>=1`                                                                                                                                          | P                   |
| 30  | /batch                    | parallel                  | ✅     | `batchCommandUses>=1`                                                                                                                                             | P                   |
| 31  | /loop                     | scheduled                 | ✅     | `loopCommandUses`                                                                                                                                                 | P                   |
| 32  | Code Review Agents        | (ver/intg)                | ✅     | `hasCodeReviewPlugin`                                                                                                                                             | P                   |
| 33  | /btw                      | memory                    | ✅     | `cliBtwUseCountAllTime>=1` (CCE-78: predicate moved off `btwCommandUses` so the windowed Memory Execution ratio isn't blended with a cumulative all-time counter) | P+E                 |
| 34  | /effort max               | model-effort              | ✅     | `effortMaxAdopted` (settings `max` OR `/effort max` in ≥2 sessions)                                                                                               | P                   |
| 35  | Remote Control            | remote                    | ✅     | `hasRemoteControl`; exec `remoteInvocationsTotal`; progression milestone (first remote-tool fire)                                                                 | P+E                 |
| 36  | Voice                     | customization             | ✅     | `voiceCommandUses` (cited as tip 60)                                                                                                                              | P+E                 |
| 37  | Setup Scripts             | automation                | ✅     | `hasSessionStartHook` (+ generic `hookTotalCount`)                                                                                                                | P                   |
| 38  | Session Naming (`--name`) | customization             | ❌     | `claude --name` not probed                                                                                                                                        | —                   |
| 39  | Auto Session Naming       | —                         | 🗣     | `aiTitlePresent` DETECTED (transcript `ai-title` entry) — info-only, not scored; non-discriminating (~universal)                                                  | —                   |
| 40  | /color                    | customization             | ✅     | `colorCommandUses>=1`                                                                                                                                             | P+E                 |
| 41  | PostCompact Hook          | automation                | ✅     | `hasPostCompactHook`; exec generic `hookTotalCount`                                                                                                               | P                   |
| 42  | Auto Mode                 | permissions               | ✅     | `permissionsDefaultMode=auto & !skipDangerous`; exec `autoModeSessionCount`; permissions scorer +10                                                               | P+E                 |
| 43  | /schedule                 | scheduled                 | ✅     | `scheduleCommandUses`; exec `scheduledInvocationsTotal`                                                                                                           | P+E                 |
| 44  | iMessage Plugin           | integrations/remote       | ✅     | `has.imessage`                                                                                                                                                    | P                   |
| 45  | Auto-Memory & Auto-Dream  | memory                    | ✅     | `autoMemoryEnabled`                                                                                                                                               | P / exec unmeasured |
| 46  | Mobile App                | remote                    | 🗣     | `ios-task` next-action (unpredicated)                                                                                                                             | coaching            |
| 47  | Session Teleporting       | remote                    | ✅     | `hasRemoteControl`                                                                                                                                                | P                   |
| 48  | /loop & /schedule         | scheduled                 | ✅     | `loopCommandUses`/`babysitLoopUses`; progression milestone (first /loop\|/schedule\|/babysit)                                                                     | P                   |
| 49  | Hooks Lifecycle           | automation                | 📊     | generic hooks                                                                                                                                                     | P                   |
| 50  | Cowork Dispatch           | parallel                  | ✅     | `coworkDispatchAdopted` (~/.claude.json#hasUsedAgentsFleet) — +15 adoption-credit in parallel Execution scorer                                                    | E                   |
| 51  | Chrome Extension          | verification/integrations | ✅     | `hasClaudeInChrome`                                                                                                                                               | P (+E reach)        |
| 52  | Desktop App               | verification              | ✅     | `desktopSessionCount>=1` (transcript `entrypoint`)                                                                                                                | P                   |
| 53  | Fork Sessions             | —                         | ❌     | not tracked                                                                                                                                                       | —                   |
| 54  | /btw (deep dive)          | memory                    | ✅     | `btwCommandUses`                                                                                                                                                  | P+E                 |
| 55  | Git Worktrees (deep)      | parallel                  | ✅     | worktree signals                                                                                                                                                  | P+E                 |
| 56  | /batch (deep)             | parallel                  | ✅     | `batchCommandUses`                                                                                                                                                | P                   |
| 57  | --bare                    | —                         | ❌     | not tracked                                                                                                                                                       | —                   |
| 58  | --add-dir                 | integrations              | ❌     | not separately probed                                                                                                                                             | —                   |
| 59  | --agent                   | automation                | 📊     | `personalAgents`/`hasIsolatedAgent` (loose)                                                                                                                       | P                   |
| 60  | /voice                    | customization             | ✅     | `voiceCommandUses>=1`                                                                                                                                             | P+E                 |
| 61  | Routines                  | scheduled                 | ✅     | `scheduleCommandUses`; exec `scheduledInvocationsTotal`                                                                                                           | P+E                 |
| 62  | /rewind                   | memory                    | ✅     | `rewindCommandUses>=1`                                                                                                                                            | P+E                 |
| 63  | /compact vs /clear        | memory                    | ✅     | `compactCommandUses>=1` + `clearCommandUses>=1`                                                                                                                   | P+E                 |
| 64  | Auto-Compact Window       | model-effort              | ✅     | `autoCompactWindow` (effort facet; exec scorer measures the Opus facet, tip 2)                                                                                    | P                   |
| 65  | Delegation over Guidance  | planning                  | ✅     | `planThenLaunchSessions>=1`; exec plan ratio                                                                                                                      | P+E                 |
| 66  | Full Task Context Upfront | planning                  | 🗣     | `goal-constraints-template` (unpredicated)                                                                                                                        | coaching            |
| 67  | xhigh effort              | model-effort              | ✅     | `effortLevel=xhigh\|max`                                                                                                                                          | P                   |
| 68  | Auto Mode + Parallel      | parallel                  | 📊     | composite (auto + parallel signals)                                                                                                                               | P+E                 |
| 69  | /fewer-permission-prompts | permissions               | ✅     | `allowListCount>=10` + `fewerPermsCommandUses>=1`                                                                                                                 | P                   |
| 70  | Recaps                    | memory                    | ❌     | not probed                                                                                                                                                        | —                   |
| 71  | Focus Mode                | customization             | ✅     | `focusCommandUses>=1`                                                                                                                                             | P+E                 |
| 72  | Effort Mastery            | model-effort              | ✅     | `effortLevel`                                                                                                                                                     | P                   |
| 73  | /go composite             | verification              | ✅     | `goCommandUses>=3` (+`hasVerifyAgent`); exec friction; progression milestone (first /go)                                                                          | P+E                 |
| 74  | 4.6→4.7 Shifts            | model-effort              | 📊     | `opus47AwarenessAdopted` awareness proxy — +8 pts (capped-low) in model-effort Execution scorer; proxy, not mastery                                               | E                   |
| 75  | Task Notifications        | automation/scheduled      | ✅     | `hasStopHookNotification`                                                                                                                                         | P                   |

**Tally** (75 = 53 + 12 + 3 + 7): ✅ direct **53** · 📊 shared **12** ·
🗣 coaching-only **3** (39, 46, 66) ·
❌ untracked **7** (12, 21, 38, 53, 57, 58, 70).

### Untracked — two groups (triage 2026-05-25, updated for runtime-adoption probes)

**Blocked until a signal source ships** (instrumentable if a field/command appears):
**21** Sandboxing · **38** `--name` · **53** Fork Sessions ·
**58** `--add-dir` · **70** Recaps — no matching settings key, slash command, or
session-meta field exists today.

**Permanently blocked** (no user-measurable signal):
**12** Bug Fixing (generic) · **57** `--bare` (launch flag — no trace).
Launch flags (`--name`/`--bare`/`--add-dir`) configure the session at startup
and leave no trace in any of the five layers.

_Previously permanently-blocked tips now reclassified:_ **27** Customize
Everything — scored via customization-breadth composite (≥4 surfaces, Platform);
**39** Auto Session Naming — detected via `aiTitlePresent` (info-only, 🗣);
**50** Cowork Dispatch — scored via `coworkDispatchAdopted` adoption credit (Execution);
**74** 4.6→4.7 Shifts — proxied via `opus47AwarenessAdopted` awareness signal (📊 Execution).

---

## Part 3 — Findings (tracked open items)

| ID     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                 | Severity          | Status         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------- |
| **F1** | `CLAUDE.md` says "87 workflow tips"; canonical index is **75**. The 87 scheme is an analytical backfill (rows 76–87 from a reference doc, never in the data files).                                                                                                                                                                                                                                                     | Low (doc drift)   | resolved (PR1) |
| **F2** | `colorCommandUses` (merged PR #72) is **absent from `probe-catalog.json`** — the `/methodology/probes` page won't document it, though the predicate + scorer wiring exist.                                                                                                                                                                                                                                              | Med (visible gap) | resolved (PR1) |
| **F3** | Three rubric next-actions cite the **wrong Boris tip number** (cosmetic copy, predicates are correct): `code-review-plugin` cites tip 44 (=iMessage; should be **32**); `claude-in-chrome` cites tip 32 (=Code Review Agents; should be **51**); `output-style-tuned` cites tip 34 (=/effort max; should be **26**). Also `probe-catalog.json` `hasCustomSpinnerVerbs` desc cites tip 4 (=CLAUDE.md; should be **25**). | Low (misleading)  | resolved (PR1) |
| **F4** | **Two** dimensions have **no Execution measurement** by design (`memory`, `customization` → `noTelemetry()`); `model-effort` moved off `noTelemetry()` in PR3 (Opus-usage exec scorer, tip 2). Worth stating that two radar vertices remain Platform-only on the execution axis.                                                                                                                                        | Info              | resolved (PR3) |
| **F5** | No test guards the human-readable "Boris tip N" citation against `boris-tip-index.json` (only the predicate is validated). F3-class drift can recur silently. Likewise, no test asserts every `satisfiedWhen` LHS has a `probe-catalog.json` entry (the seam that let F2 slip).                                                                                                                                         | Med (process)     | resolved (PR1) |

### Resolution — all findings closed

All five findings (F1–F5) are resolved per the **Status** column above — landed
across the probe-coverage expansion stack and shipped in **v0.9.10**, tracked as
**CCE-24**. The former "suggested fixes" list is retired; the Findings table is the
record of what changed and where.

## Pointers

- Probe wiring contract: `docs/superpowers/specs/2026-05-10-probe-closure-and-validation-design.md` (the 5-layer touch list).
- Tip-by-tip 30-day habit analysis (historical): `docs/tip-classification-2026-05-10.md`.
- Scoring formula per dimension: `scripts/score.mjs`; rendered at `/methodology`.
- Probe page metadata: `app/data/probe-catalog.json` → `/methodology/probes`.
