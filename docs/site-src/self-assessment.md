# `/self-assessment` — user guide

A deterministic scorer for how you actually use Claude Code, compared against
Boris Cherny's 87 workflow tips and a two-axis **Platform Setup vs Execution**
Self-Assessment rubric.

The score is reproducible: same machine state → same numbers. Trends only move
when the underlying signals do, so day-to-day noise doesn't masquerade as
progress.

> **For Claude Code:** the `/self-assessment` slash command defers to
> [`.claude/skills/self-assessment/SKILL.md`](../.claude/skills/self-assessment/SKILL.md).
> Spokes: [setup](../.claude/skills/self-assessment/setup.md) ·
> [gotchas](../.claude/skills/self-assessment/gotchas.md) ·
> [signals](../.claude/skills/self-assessment/signals.md).

---

## Invoking

From inside this repo (anywhere Claude Code can see `.claude/commands/`):

```
/self-assessment
```

That runs `npm run assess` with no extra args. Pass flags through the slash
command:

```
/self-assessment --include-transcripts
/self-assessment --claude-md-target main-repo=/Users/you/Projects/main-repo
/self-assessment --no-slack
```

Or run it directly from the shell:

```bash
npm run assess
npm run assess -- --include-transcripts
npm run assess -- --claude-md-target main-repo=/Users/you/Projects/main-repo
npm run assess -- --print
```

### Flags

| Flag                                         | Effect                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `--no-slack`                                 | Skip the Slack post even if `slack.enabled: true`.                       |
| `--no-write`                                 | Don't write `assessment.json` / append to history. Useful for dry runs.  |
| `--print`                                    | Print the human-readable summary even when running in CI.                |
| `--include-transcripts`                      | Opt in to behavioral signals (see below). Off by default for cost.       |
| `--no-transcripts`                           | Force the transcript scan off even when config has it on.                |
| `--insights-lookback N`                      | Window for `/insights`-derived counters, in days. Default 30.            |
| `--progression-lookback N` or `none`         | Window for the milestone timeline. `none` = full history (default null). |
| `--claude-md-target <name=path>` or `<path>` | Audit one or more CLAUDE.md targets. Repeatable. Path can use `~`.       |

`--no-transcripts` beats `--include-transcripts` beats config — the explicit
"off" form always wins.

---

## What it reads

**Always (config audit, default mode):**

- `~/.claude/settings.json` — `effortLevel`, `skipDangerousModePermissionPrompt`, `permissions.allow/deny`, `hooks`, `enabledPlugins`, `env`
- `~/.claude/agents/*.md` — personal agents
- `~/.claude/commands/*.md` — personal slash commands
- `~/.claude/skills/*` — personal skills
- `~/.claude/plans/*` — saved plans (count only)
- `~/.claude/sessions/*` — recent sessions (count only)
- `~/.claude/projects/*/memory/*` — project memory files
- `~/.claude/statusline.sh`, `~/.claude/keybindings.json` — presence checks
- `~/.claude/usage-data/session-meta/`, `~/.claude/usage-data/facets/` — session telemetry (seeded by running `/insights` in Claude Code)
- `~/.claude/CLAUDE.md` — global personality memo
- This project's `.claude/settings.local.json`, `.claude/agents`, `.claude/commands`, `CLAUDE.md`
- Configured CLAUDE.md targets (`assessment.config.json#claudeMd.targets`)

**Only with `--include-transcripts` (behavior audit, opt-in):**

- `~/.claude/projects/*/conversations*.jsonl` — your conversation transcripts within the lookback window

Aggregate counters only ever land in `assessment.json` and the Slack post —
never raw prompts or turns.

---

## What it writes

| File                               | Contents                                         | Committed?                 |
| ---------------------------------- | ------------------------------------------------ | -------------------------- |
| `app/data/assessment.json`         | Current score snapshot                           | Yes (overwritten each run) |
| `app/data/assessment-history.json` | Append-only trend series                         | **Gitignored**             |
| `app/data/progression.json`        | Milestone timeline                               | Yes                        |
| Slack channel (if configured)      | Summary message with scores, deltas, top actions | n/a                        |

---

## How scoring works

1. **`scripts/signals.mjs`** reads the local Claude Code state above.
2. **`scripts/insights-signals.mjs`** rolls up session-meta and facets within
   the insights lookback window. With `--include-transcripts`, it also walks
   conversation JSONLs for plan/auto/bypass-permissions/worktree/learning-mode
   signals.
3. **`scripts/score.mjs`** runs one deterministic scorer per dimension. Each
   returns `{ score, evidence[], gaps[] }`. Open the file — every number is
   traceable to a signal.
4. Each dimension belongs to one of two axes — **Platform Setup** (did you
   wire it?) or **Execution** (did you actually use it?). The high-Δ
   diagnostic case is "every tool installed, none of them fired."
5. **Trends** are computed by comparing the latest snapshot against the
   previous one in `assessment-history.json`.

---

## Reading the output

```
Claude Code Self-Assessment — Theo
Platform Setup  78 / 100        Execution  41 / 100        Δ 37 ⚠

   33 / 90  →  Automation — Hooks, Commands, Agents
   91 / 95  ↗  Verification — The #1 Tip
   35 / 85  ↘  Permissions & Safety
   …
```

- Two axis scores plus the Δ between them. A high Δ is the diagnostic case.
- `score / target` per dimension.
- `↗` improving, `↘` slipping, `→` flat, `✦` new (no prior history).

For the full breakdown — formula, contributing signals, the highest-leverage
move that would push the score +10 — open the dashboard:

```bash
npm run dev               # http://localhost:3737
```

Each dimension card on the home page links to `/dimensions/<id>`.

---

## Behavioral signals (opt-in)

The default score is a **configuration audit**: did you toggle the right
knobs? Useful, but you can max it out without ever using Claude Code well.

`--include-transcripts` upgrades it to a **self-assessment audit** by walking
`~/.claude/projects/*/conversations*.jsonl` within the insights lookback
window and deriving aggregates per session:

| Signal                                  | Source                                                             |
| --------------------------------------- | ------------------------------------------------------------------ |
| Plan-mode entries                       | `EnterPlanMode` events in transcripts                              |
| Auto-mode session count                 | Auto-mode markers                                                  |
| Bypass-permissions session count        | Bypass-permissions markers (penalty)                               |
| Worktree usage                          | Worktree state events                                              |
| Learning-mode session count and matches | Learning-mode markers                                              |
| Subagent dispatch and tool counts       | session-meta `tool_counts`                                         |
| Hook fires                              | `~/.claude/usage-data/session-meta/*.json` (seeded by `/insights`) |

This scan is expensive — full transcript history each run. Off by default;
turn it on once you have a baseline.

### Privacy

- Only **aggregate counters** (counts, ratios) land in `assessment.json`.
- Raw prompts, tool inputs, and message text **never** leave the parser.
- Off by default — set `scoring.includeTranscripts: true` in
  `assessment.config.json`, or pass `--include-transcripts` per run.

### Hook fire telemetry

Hook-fire counts are read from `~/.claude/usage-data/session-meta/*.json`,
which Claude Code's `/insights` command populates automatically. If
`usage-data/` is empty (i.e., `/insights` hasn't been run yet), the scorer
treats the absence as "no telemetry" (null) rather than "no fires" (zero),
so a fresh setup doesn't hard-zero your hook-execution score. Run
`/insights` once in Claude Code to seed the data, then re-run
`/self-assessment`.

---

## CLAUDE.md health

If you pass `--claude-md-target <name=path>` (or list targets in
`assessment.config.json#claudeMd.targets`), each target's `CLAUDE.md` files
are scored on a 6-criterion 100-point rubric:

| Criterion            | Max | What earns it                                                                                                               |
| -------------------- | --- | --------------------------------------------------------------------------------------------------------------------------- |
| Commands/workflows   | 20  | Fenced code blocks containing real tooling invocations                                                                      |
| Architecture clarity | 20  | An `## Architecture`/`## Structure` heading with ≥80 chars of body                                                          |
| Non-obvious patterns | 15  | A `## Gotchas`/`## Notes` section with specific tool/file references (not generic prose)                                    |
| Conciseness          | 15  | Between 15 and 400 lines                                                                                                    |
| Currency             | 15  | mtime ≤ 30d (15) / ≤ 90d (10). Capped at 5 if stale version mentions like `Claude 3`/`Sonnet 3.5`/`claude.json` are present |
| Actionability        | 15  | Bullet density × heading count + imperative-verb hits (`run`, `use`, `prefer`, `avoid`, …)                                  |

Output is **report-only** (`mode: "report-only"` is the only mode shipped) —
the auditor never edits CLAUDE.md. Only aggregate stats land in the Slack
post: total targets, files scanned, average score/grade, grade distribution.
**No project names, paths, or per-file issues.**

---

## Configuration

`assessment.config.json` (copy from `assessment.config.example.json`,
**never commit secrets**). The example file is the source of truth for
shape and defaults — see [`.claude/skills/self-assessment/setup.md`](../.claude/skills/self-assessment/setup.md)
for the verbatim copy and the first-run prompt flow.

`.env.local`:

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

The webhook secret is read from the env var named in `slack.webhookEnvVar`
(default `SLACK_WEBHOOK_URL`). Never paste the URL into config or code.

---

## Tuning the rubric

Targets, weights, Boris-tip references, and next-action lists live in
`app/data/rubric.json`. Edit there to retune. The dashboard and Slack post
both read from this file at runtime — no rebuild needed.

To add a new dimension:

1. Add a `{ id, title, weight, target, rubricArea, borisTips, noiseFloor, nextActions }` entry.
2. Add a matching `SCORERS[id]` function in `scripts/score.mjs`.
3. Add an entry to `EXPLAINERS[id]` in `app/lib/dimension-explainer.ts` so the explainer page renders.

Tests in `scripts/__tests__/score.test.mjs` (74 unit tests) and
`scripts/__tests__/integration/` (gatherSignals + pipeline) catch most
regressions.

---

## Troubleshooting

| Symptom                                                          | Likely cause                                                                                     | Fix                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `Slack post skipped: SLACK_WEBHOOK_URL not set`                  | `.env.local` missing the webhook                                                                 | Add `SLACK_WEBHOOK_URL=…` to `.env.local`.                                      |
| All dimensions show `→ flat` even after a real change            | History didn't pick up the change yet, or the change wasn't substantive enough to move the score | Re-run after the change settles; check the dimension's `evidence`/`gaps` lists. |
| `automation` score didn't go up after adding hooks               | `~/.claude/usage-data/session-meta/` not seeded yet                                              | Run `/insights` once in Claude Code, then re-run `/self-assessment`.            |
| Dashboard shows stale data                                       | The page is statically rendered against the last `assessment.json`                               | Re-run `npm run assess` and reload the page.                                    |
| `--include-transcripts` is slow on a large `~/.claude/projects/` | Full transcript history scan                                                                     | Lower `--insights-lookback` to narrow the window, or accept the wait.           |

For more failure modes, see
[`.claude/skills/self-assessment/gotchas.md`](../.claude/skills/self-assessment/gotchas.md).

---

## Daily routine

A scheduled run (macOS `launchd` or cloud routine) can fire `/self-assessment`
each morning and post the result to Slack. See `ROUTINE.md` for setup.

---

## Recommended pattern: `/ship`

The rubric's highest-weighted automation next-action is authoring a
personal `/ship` slash command. It lives in `~/.claude/commands/` (not
this repo) and chains test → verify → simplify → review → commit →
push+PR → Jira. See [`docs/ship-pattern.md`](./ship-pattern.md) for a
short summary and
[`docs/superpowers/specs/2026-05-09-ship-slash-command-design.md`](./superpowers/specs/2026-05-09-ship-slash-command-design.md)
for the full spec.

---

## See also

- [`.claude/skills/self-assessment/SKILL.md`](../.claude/skills/self-assessment/SKILL.md) — Claude-facing skill hub (with `gotchas.md`, `signals.md`, `setup.md` spokes). Read by Claude when invoking `/self-assessment`.
- `README.md` — project overview, quick start, signal sources
- `ROUTINE.md` — cloud / launchd scheduled run
- `.claude/commands/self-assessment.md` — the slash-command shim
- `scripts/score.mjs` — every scoring rule, transparent and editable
- `app/lib/dimension-explainer.ts` — formula descriptions rendered on `/dimensions/<id>`
