# Probe Implementation Status — Coverage Tracker

**Date:** 2026-05-25
**Status:** Living tracker — update on every probe add/remove.
**Validated against:** `app/data/boris-tip-index.json` (75 tips), `app/data/rubric.json`
(12 dimensions / 42 next-actions), `app/data/probe-catalog.json` (40 probes),
`scripts/score.mjs` (`SCORERS` + `EXECUTION_SCORERS`), `scripts/_usage-data.mjs`
(transcript scanners), `scripts/run-assessment.mjs#buildSignalsSummary`
(60 `signalsSummary` keys). Snapshot taken after PR #72 (`colorCommandUses`).

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

- **P** — Platform Setup scorer (`SCORERS[dim]` in `score.mjs`): "is it installed/configured?"
- **E** — Execution scorer (`EXECUTION_SCORERS[dim]`): "do you actually use it?"
- **P+E** — both axes scored.
- **P / exec unmeasured** — dimension routes Execution to `noTelemetry()`
  (`model-effort`, `memory`, `customization`): the relevant signal never reaches
  cooked telemetry, so Execution renders as _unmeasured_, not zero.

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

### Settings (`~/.claude/settings.json`, `~/.claude.json`) — readers in `signals.mjs`

| Field                     | Predicate / use                                                             | Catalog | Axis |
| ------------------------- | --------------------------------------------------------------------------- | ------- | ---- |
| `outputStyle`             | `outputStyle=Explanatory\|Learning` (learning)                              | ✅      | P    |
| `effortLevel`             | `effortLevel=xhigh\|max`, `=max` (model-effort)                             | ✅      | P    |
| `skipDangerous`           | `!skipDangerous` (permissions)                                              | ✅      | P    |
| `allowListCount`          | `allowListCount>=10` (permissions)                                          | ✅      | P    |
| `hasWildcardAllow`        | `hasWildcardAllow` (permissions)                                            | ✅      | P    |
| `autoCompactWindow`       | `autoCompactWindow` (model-effort)                                          | ✅      | P    |
| `autoMemoryEnabled`       | `autoMemoryEnabled` (memory) — inverse of `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | ✅      | P    |
| `hasStopHook`             | `hasStopHook` (automation)                                                  | ✅      | P    |
| `hasFormatterHook`        | `hasFormatterHook` (automation)                                             | ✅      | P    |
| `hasStopHookNotification` | `hasStopHookNotification` (scheduled)                                       | ✅      | P    |
| `hasCustomSpinnerVerbs`   | `hasCustomSpinnerVerbs` (customization)                                     | ✅      | P    |
| `hasClaudeInChrome`       | `hasClaudeInChrome` (verification, integrations)                            | ✅      | P    |
| `hasRemoteControl`        | `hasRemoteControl` (remote)                                                 | ✅      | P    |
| `mcpServersConnected`     | `mcpServersConnected>=3` (integrations)                                     | ✅      | P    |
| `hookTotalCount`          | automation scorer credit (generic)                                          | —       | P    |
| `hookEvents`              | Stop-hook presence (scheduled), evidence                                    | —       | P    |
| `hasPostToolHook`         | scorer/evidence (generic PostToolUse)                                       | —       | P    |
| `statuslineConfigured`    | customization scorer (+15)                                                  | —       | P    |
| `keybindingsConfigured`   | customization scorer (+10)                                                  | —       | P    |
| `permissionsDefaultMode`  | captured; not yet scored                                                    | —       | —    |

### Filesystem (`~/.claude/{agents,commands,skills,projects}`) — `signals.mjs`

| Field                                                    | Predicate / use                                       | Catalog | Axis |
| -------------------------------------------------------- | ----------------------------------------------------- | ------- | ---- |
| `claudeMdExists`                                         | `claudeMdExists` (memory)                             | ✅      | P    |
| `personalSkillNames`                                     | `personalSkillNames~spaced\|repetition\|…` (learning) | ✅      | P    |
| `hasShipCommand`                                         | `hasShipCommand` (automation)                         | ✅      | P    |
| `hasVerifyAgent`                                         | `hasVerifyAgent` (automation)                         | ✅      | P    |
| `hasIsolatedAgent`                                       | `hasIsolatedAgent` (parallel)                         | ✅      | P    |
| `personalAgents` / `personalCommands` / `personalSkills` | automation + parallel scorer counts                   | —       | P    |
| `projectsWithMemory`                                     | memory scorer                                         | —       | P    |
| `shipsRecent` / `shipVerifyStageRecent`                  | automation / verification scorer (`shipJournal`)      | —       | P    |
| `worktreeAliasCount` / `worktreeShortcutCount`           | `parallelWorktreeAdoption` OR-inputs                  | —       | P    |
| (`plansCount`)                                           | memory + planning scorer (`>=10`)                     | —       | P    |

### Plugins (`enabledPlugins`, PATH) — `signals.mjs`

| Field                                                                                                                                                      | Predicate / use                           | Catalog | Axis |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------- | ---- |
| `hasCodeReviewPlugin`                                                                                                                                      | `hasCodeReviewPlugin=true` (verification) | ✅      | P    |
| `hasSlackPlugin`                                                                                                                                           | `hasSlackPlugin` (integrations)           | ✅      | P    |
| `hasVercelCli`                                                                                                                                             | `hasVercelCli` (integrations)             | ✅      | P    |
| `hasVercelPlugin`                                                                                                                                          | integrations evidence                     | —       | P    |
| `plugins`                                                                                                                                                  | integrations scorer (`len*3`, cap 70)     | —       | P    |
| `has.{superpowers,karpathy,featureDev,skillCreator,semgrep,playwright,vercel,imessage,claudeMdMgmt,explanatoryStyle,ralphLoop,prReviewToolkit,codeReview}` | per-dimension plugin credit               | —       | P    |

### Transcripts (`~/.claude/projects/*/*.jsonl`) — `_usage-data.mjs`

| Field                      | Predicate / use                            | Catalog | Axis |
| -------------------------- | ------------------------------------------ | ------- | ---- |
| `parallelWorktreeAdoption` | `parallelWorktreeAdoption` (parallel)      | ✅      | P    |
| `planThenLaunchSessions`   | `planThenLaunchSessions>=1` (planning)     | ✅      | P    |
| `shipVerifyStageRecent`    | `shipVerifyStageRecent>=1` (verification)  | ✅      | P    |
| `sessionsByKind`           | universe classifier (gates posture ratios) | ✅      | —    |
| `goCommandUses`            | `goCommandUses>=3` (verification)          | ✅      | P    |
| `batchCommandUses`         | `batchCommandUses>=1` (parallel)           | ✅      | P    |
| `simplifyCommandUses`      | `simplifyCommandUses>=1` (automation)      | ✅      | P    |
| `btwCommandUses`           | `btwCommandUses>=1` (memory)               | ✅      | P    |
| `voiceCommandUses`         | `voiceCommandUses>=1` (customization)      | ✅      | P    |
| `clearCommandUses`         | `clearCommandUses>=1` (memory)             | ✅      | P    |
| `compactCommandUses`       | `compactCommandUses>=1` (memory)           | ✅      | P    |
| `colorCommandUses`         | `colorCommandUses>=1` (customization)      | ✅      | P    |
| `fewerPermsCommandUses`    | `fewerPermsCommandUses>=1` (permissions)   | ✅      | P    |
| `focusCommandUses`         | `focusCommandUses>=1` (customization)      | ✅      | P    |
| `scheduleCommandUses`      | `scheduleCommandUses>=1` (scheduled)       | ✅      | P    |
| `loopCommandUses`          | `loopCommandUses>=1` (scheduled)           | ✅      | P    |
| `babysitLoopUses`          | scheduled scorer (`/loop /babysit`)        | —       | P    |
| `rewindCommandUses`        | `rewindCommandUses>=1` (memory)            | ✅      | P    |

> All command counters are MAX-merged with `~/.claude/history.jsonl` in
> `buildSignalsSummary` via `maxProbe(field)` and gated to the lookback window.

### Insights / cooked telemetry (`~/.claude/usage-data/`) — `insights-signals.mjs`

These drive the **Execution** scorers (no `satisfiedWhen`; consumed directly in
`EXECUTION_SCORERS`):

| Signal                                                  | Execution scorer                       | Universe         |
| ------------------------------------------------------- | -------------------------------------- | ---------------- |
| `autoModeSessionCount`, `bypassPermissionsSessionCount` | permissions                            | interactive_only |
| `frictionCounts.{buggy_code,wrong_approach}`            | verification                           | all_sessions     |
| `subagentSessionCount`, `worktreeUsageSessionCount`     | parallel                               | interactive_only |
| `planModeSessionCount`, `multiTaskSessionCount`         | planning                               | interactive_only |
| `hookFireCount` (3-state warm/cold/null)                | automation                             | interactive_only |
| `toolInvocationsByPlugin`                               | integrations (calls/session, target 2) | all_sessions     |
| `scheduledInvocationsTotal`                             | scheduled (1→50, ≥3→100)               | all_sessions     |
| `remoteInvocationsTotal`                                | remote (1→50, ≥3→100)                  | all_sessions     |
| `learningModeSessionCount`, `learningModeMatchesTotal`  | learning (★ Insight banner ratio)      | interactive_only |

**No Execution scorer (by design, `noTelemetry()`):** `model-effort`, `memory`,
`customization` — the relevant signals (model id, memory-tool calls, client-side
config) never reach cooked telemetry.

---

## Part 2 — Coverage of all 75 Boris tips

| #   | Topic                     | Dim                       | Status | Probe / signal                                                             | Axis                |
| --- | ------------------------- | ------------------------- | ------ | -------------------------------------------------------------------------- | ------------------- |
| 1   | Parallel Execution        | parallel                  | ✅     | `parallelWorktreeAdoption`; exec `subagent`+`worktree`                     | P+E                 |
| 2   | Model Selection           | model-effort              | 📊     | `effortLevel` proxy (model id not probed)                                  | P / exec unmeasured |
| 3   | Plan Mode                 | planning                  | ✅     | exec `planModeSessionCount/multiTask`; `planThenLaunchSessions`            | P+E                 |
| 4   | CLAUDE.md                 | memory                    | ✅     | `claudeMdExists`                                                           | P / exec unmeasured |
| 5   | Skills & Slash Commands   | automation                | ✅     | `hasShipCommand` (+ skill/command counts)                                  | P                   |
| 6   | Subagents                 | parallel                  | 📊     | exec `subagentSessionCount`; `personalAgents`                              | P+E                 |
| 7   | Hooks                     | automation                | ✅     | `hasFormatterHook`, `hasStopHook`; exec `hookFireCount`                    | P+E                 |
| 8   | Permissions               | permissions               | 📊     | `allowListCount`, `skipDangerous`                                          | P                   |
| 9   | MCP Integrations          | integrations              | ✅     | `hasSlackPlugin`, `mcpServersConnected>=3`; exec `toolInvocationsByPlugin` | P+E                 |
| 10  | Prompting Tips            | verification              | 📊     | mapped to `shipVerifyStageRecent`                                          | P                   |
| 11  | Terminal Setup            | customization             | ❌     | none specific (thematic)                                                   | —                   |
| 12  | Bug Fixing                | —                         | ❌     | not referenced anywhere                                                    | —                   |
| 13  | Long-Running Tasks        | automation\*              | ✅     | `hasStopHook`                                                              | P                   |
| 14  | Verification (#1)         | verification              | ✅     | `hasVerifyAgent`; exec friction rate                                       | P+E                 |
| 15  | Learning with Claude      | learning                  | ✅     | `personalSkillNames~spaced`                                                | P                   |
| 16  | Terminal Config           | customization             | 📊     | `statuslineConfigured`/`keybindingsConfigured` (loose)                     | P                   |
| 17  | Effort Level              | model-effort              | ✅     | `effortLevel`                                                              | P / exec unmeasured |
| 18  | Plugins                   | integrations              | ✅     | `plugins.length`; exec `toolInvocationsByPlugin`                           | P+E                 |
| 19  | Custom Agents             | automation/parallel       | 📊     | `personalAgents`, `hasIsolatedAgent`                                       | P                   |
| 20  | Permissions Management    | permissions               | ✅     | `hasWildcardAllow`, `allowListCount`                                       | P                   |
| 21  | Sandboxing                | permissions               | ❌     | not separately probed                                                      | —                   |
| 22  | Status Line               | customization             | 📊     | `statuslineConfigured`                                                     | P                   |
| 23  | Keybindings               | customization             | 📊     | `keybindingsConfigured`                                                    | P                   |
| 24  | Hooks (Advanced)          | automation                | 📊     | `hookTotalCount` (generic)                                                 | P                   |
| 25  | Spinner Verbs             | customization             | ✅     | `hasCustomSpinnerVerbs`                                                    | P                   |
| 26  | Output Styles             | customization/learning    | ✅     | `outputStyle`; exec `learningModeSessionCount`                             | P+E                 |
| 27  | Customize Everything      | customization             | ❌     | umbrella; no probe                                                         | —                   |
| 28  | Git Worktree Support      | parallel                  | ✅     | `hasIsolatedAgent`; exec `worktreeUsageSessionCount`                       | P+E                 |
| 29  | /simplify                 | automation                | ✅     | `simplifyCommandUses>=1`                                                   | P                   |
| 30  | /batch                    | parallel                  | ✅     | `batchCommandUses>=1`                                                      | P                   |
| 31  | /loop                     | scheduled                 | ✅     | `loopCommandUses`                                                          | P                   |
| 32  | Code Review Agents        | (ver/intg)                | ✅     | `hasCodeReviewPlugin`                                                      | P                   |
| 33  | /btw                      | memory                    | ✅     | `btwCommandUses>=1`                                                        | P                   |
| 34  | /effort max               | model-effort              | ✅     | `effortLevel=max`                                                          | P                   |
| 35  | Remote Control            | remote                    | ✅     | `hasRemoteControl`; exec `remoteInvocationsTotal`                          | P+E                 |
| 36  | Voice                     | customization             | ✅     | `voiceCommandUses` (cited as tip 60)                                       | P                   |
| 37  | Setup Scripts             | —                         | ❌     | not tracked                                                                | —                   |
| 38  | Session Naming (`--name`) | customization             | ❌     | `claude --name` not probed                                                 | —                   |
| 39  | Auto Session Naming       | —                         | ❌     | not tracked                                                                | —                   |
| 40  | /color                    | customization             | ✅     | `colorCommandUses>=1`                                                      | P                   |
| 41  | PostCompact Hook          | automation                | 📊     | generic `hookTotalCount` only                                              | P                   |
| 42  | Auto Mode                 | permissions               | ✅     | `!skipDangerous`; exec `autoModeSessionCount`                              | P+E                 |
| 43  | /schedule                 | scheduled                 | ✅     | `scheduleCommandUses`; exec `scheduledInvocationsTotal`                    | P+E                 |
| 44  | iMessage Plugin           | integrations/remote       | ✅     | `has.imessage`                                                             | P                   |
| 45  | Auto-Memory & Auto-Dream  | memory                    | ✅     | `autoMemoryEnabled`                                                        | P / exec unmeasured |
| 46  | Mobile App                | remote                    | 🗣     | `ios-task` next-action (unpredicated)                                      | coaching            |
| 47  | Session Teleporting       | remote                    | ✅     | `hasRemoteControl`                                                         | P                   |
| 48  | /loop & /schedule         | scheduled                 | ✅     | `loopCommandUses`/`babysitLoopUses`                                        | P                   |
| 49  | Hooks Lifecycle           | automation                | 📊     | generic hooks                                                              | P                   |
| 50  | Cowork Dispatch           | remote                    | ❌     | not separately probed                                                      | —                   |
| 51  | Chrome Extension          | verification/integrations | ✅     | `hasClaudeInChrome`                                                        | P (+E reach)        |
| 52  | Desktop App               | verification              | ❌     | not probed                                                                 | —                   |
| 53  | Fork Sessions             | —                         | ❌     | not tracked                                                                | —                   |
| 54  | /btw (deep dive)          | memory                    | ✅     | `btwCommandUses`                                                           | P                   |
| 55  | Git Worktrees (deep)      | parallel                  | ✅     | worktree signals                                                           | P+E                 |
| 56  | /batch (deep)             | parallel                  | ✅     | `batchCommandUses`                                                         | P                   |
| 57  | --bare                    | —                         | ❌     | not tracked                                                                | —                   |
| 58  | --add-dir                 | integrations              | ❌     | not separately probed                                                      | —                   |
| 59  | --agent                   | automation                | 📊     | `personalAgents`/`hasIsolatedAgent` (loose)                                | P                   |
| 60  | /voice                    | customization             | ✅     | `voiceCommandUses>=1`                                                      | P                   |
| 61  | Routines                  | scheduled                 | ✅     | `scheduleCommandUses`; exec `scheduledInvocationsTotal`                    | P+E                 |
| 62  | /rewind                   | memory                    | ✅     | `rewindCommandUses>=1`                                                     | P                   |
| 63  | /compact vs /clear        | memory                    | ✅     | `compactCommandUses>=1` + `clearCommandUses>=1`                            | P                   |
| 64  | Auto-Compact Window       | model-effort              | ✅     | `autoCompactWindow`                                                        | P / exec unmeasured |
| 65  | Delegation over Guidance  | planning                  | ✅     | `planThenLaunchSessions>=1`; exec plan ratio                               | P+E                 |
| 66  | Full Task Context Upfront | planning                  | 🗣     | `goal-constraints-template` (unpredicated)                                 | coaching            |
| 67  | xhigh effort              | model-effort              | ✅     | `effortLevel=xhigh\|max`                                                   | P                   |
| 68  | Auto Mode + Parallel      | parallel                  | 📊     | composite (auto + parallel signals)                                        | P+E                 |
| 69  | /fewer-permission-prompts | permissions               | ✅     | `allowListCount>=10` + `fewerPermsCommandUses>=1`                          | P                   |
| 70  | Recaps                    | memory                    | ❌     | not probed                                                                 | —                   |
| 71  | Focus Mode                | customization             | ✅     | `focusCommandUses>=1`                                                      | P                   |
| 72  | Effort Mastery            | model-effort              | ✅     | `effortLevel`                                                              | P                   |
| 73  | /go composite             | verification              | ✅     | `goCommandUses>=3` (+`hasVerifyAgent`); exec friction                      | P+E                 |
| 74  | 4.6→4.7 Shifts            | —                         | ❌     | meta/changelog — not tracked                                               | —                   |
| 75  | Task Notifications        | automation/scheduled      | ✅     | `hasStopHookNotification`                                                  | P                   |

**Tally** (75 = 46 + 13 + 2 + 14): ✅ direct **46** · 📊 shared **13** ·
🗣 coaching-only **2** (46, 66) ·
❌ untracked **14** (11, 12, 21, 27, 37, 38, 39, 50, 52, 53, 57, 58, 70, 74).

### Entirely absent (no probe, no signal, no next-action, not in any `borisTips`)

**12** Bug Fixing · **37** Setup Scripts · **39** Auto Session Naming ·
**53** Fork Sessions · **57** `--bare` · **74** 4.6→4.7 Shifts. Most are
arguably un-trackable (12 generic, 74 changelog); 37/53/57 are concrete features
that _could_ be instrumented if justified.

---

## Part 3 — Findings (tracked open items)

| ID     | Finding                                                                                                                                                                                                                                                                                                                                                                                                                 | Severity          | Status         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------- |
| **F1** | `CLAUDE.md` says "87 workflow tips"; canonical index is **75**. The 87 scheme is an analytical backfill (rows 76–87 from a reference doc, never in the data files).                                                                                                                                                                                                                                                     | Low (doc drift)   | resolved (PR1) |
| **F2** | `colorCommandUses` (merged PR #72) is **absent from `probe-catalog.json`** — the `/methodology/probes` page won't document it, though the predicate + scorer wiring exist.                                                                                                                                                                                                                                              | Med (visible gap) | resolved (PR1) |
| **F3** | Three rubric next-actions cite the **wrong Boris tip number** (cosmetic copy, predicates are correct): `code-review-plugin` cites tip 44 (=iMessage; should be **32**); `claude-in-chrome` cites tip 32 (=Code Review Agents; should be **51**); `output-style-tuned` cites tip 34 (=/effort max; should be **26**). Also `probe-catalog.json` `hasCustomSpinnerVerbs` desc cites tip 4 (=CLAUDE.md; should be **25**). | Low (misleading)  | resolved (PR1) |
| **F4** | Three dimensions have **no Execution measurement** by design (`model-effort`, `memory`, `customization` → `noTelemetry()`). A third of the radar is Platform-only on the execution axis — correct, but worth stating.                                                                                                                                                                                                   | Info              | accepted       |
| **F5** | No test guards the human-readable "Boris tip N" citation against `boris-tip-index.json` (only the predicate is validated). F3-class drift can recur silently. Likewise, no test asserts every `satisfiedWhen` LHS has a `probe-catalog.json` entry (the seam that let F2 slip).                                                                                                                                         | Med (process)     | resolved (PR1) |

### Suggested low-risk fixes (one-liners)

- **F2:** add a `colorCommandUses` entry to `probe-catalog.json` (source `history`/`transcripts`).
- **F3:** correct the four tip-number citations in `rubric.json` + `probe-catalog.json`.
- **F5:** two cheap test guards — (a) every action's cited `Boris tip N` resolves
  to a topic in `boris-tip-index.json`; (b) every `satisfiedWhen` LHS field has a
  catalog entry.
- **F1:** reconcile the "87" wording in `CLAUDE.md` to "75 (+12 backfilled in the
  classification doc)".

## Pointers

- Probe wiring contract: `docs/superpowers/specs/2026-05-10-probe-closure-and-validation-design.md` (the 5-layer touch list).
- Tip-by-tip 30-day habit analysis (historical): `docs/tip-classification-2026-05-10.md`.
- Scoring formula per dimension: `scripts/score.mjs`; rendered at `/methodology`.
- Probe page metadata: `app/data/probe-catalog.json` → `/methodology/probes`.
