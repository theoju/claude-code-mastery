# Claude Code Self-Assessment

A personal dashboard that scores your day-to-day Claude Code usage against
[Boris Cherny's 87 workflow tips](https://howborisusesclaudecode.com) and a
Self-Assessment rubric. Reads signals directly from `~/.claude/` — no telemetry, no
external service, nothing leaves your machine unless you enable the Slack
notifier.

![Dashboard overview — two-axis scoring (Platform Setup vs Execution), 12-dimension radar, milestone progression, and the headline read.](docs/images/self-assessment-dashboard.png)

- **Two axes, not one composite**: **Platform Setup** (how `~/.claude/` is
  configured) and **Execution** (whether you actually use it, derived from
  `~/.claude/usage-data/`). The diagnostic case is a high Δ — every tool
  installed, none of them fired.
- **12 dimensions**: automation, permissions, model/effort tuning, parallelism,
  verification, memory, planning, integrations, customization, scheduled work,
  remote/mobile, and learning. Each scored independently on each axis where
  data exists; the radar marks honestly-unmeasured Execution dims with italic
  labels and a footnote so they're not silently zero.
- **Deterministic scoring**: signals → rules → number, normalized per-dimension
  to a 100-point scale (`raw / target × 100`). Trend arrows (↗/↘/→) reflect
  real config changes, not vibes.
- **Trend history**: each run appends to `app/data/assessment-history.json`
  (gitignored). After two runs you get meaningful directionality.
- **Optional Slack ping** at 07:15 daily via macOS `launchd`. The dashboard
  stays local; the Slack message is the delivery vehicle.

```
Claude Code Self-Assessment — Engineer
Platform Setup  78 / 100
Execution       63 / 100 (observed practice)

   46 / 100  →  Automation — Hooks, Commands, Agents (raw 41/90)
   65 / 100  →  Permissions & Safety (raw 55/85) · ex  24
   78 / 100  →  Model & Effort Tuning (raw 70/90)
   …
```

## Quick start

```bash
git clone <this repo> claude-self-assessment
cd claude-self-assessment
npm install
npm run setup          # creates assessment.config.json and .env.local from examples
npm run assess:print   # score your setup, print to terminal
npm run dev            # open http://localhost:3737
```

That's the whole loop. Everything else is optional polish.

## How scoring works

1. **`scripts/signals.mjs`** reads your local Claude Code state for the
   _Platform Setup_ axis: `~/.claude/settings.json` (effort level, hooks,
   permissions, enabled plugins), the contents of `~/.claude/agents`,
   `~/.claude/commands`, `~/.claude/skills`, `~/.claude/plans`, and MEMORY.md
   files under `~/.claude/projects/*/memory`.
2. **`scripts/insights-signals.mjs`** + **`scripts/_usage-data.mjs`** read the
   _Execution_ axis from `~/.claude/usage-data/{facets,session-meta}/*.json`
   (the same cooked telemetry `/insights` reads). Optionally scans transcripts
   under `~/.claude/projects/*/*.jsonl` for the `★ Insight` banner (learning
   mode), worktree usage, and skill attribution.
3. **`scripts/score.mjs`** applies deterministic rules per dimension and
   normalizes each to 100 (`raw / target × 100`). Ten of twelve dims have
   Execution scorers; the remaining two — Memory & Context and Terminal &
   Customization — route to _unmeasured_ via `gapReason` rather than scored
   zero. (Model & Effort is _partially_ measured: Opus usage is scored from
   transcripts, effort level stays settings-only.) Every number is traceable
   to a signal.
4. **`scripts/run-assessment.mjs`** orchestrates: signals → score → write
   `app/data/assessment.json`, append `app/data/assessment-history.json`, post
   to Slack if configured.
5. The Next.js app reads `app/data/rubric.json` (static metadata) + the
   generated `assessment.json` and renders the dashboard. See
   [`/methodology`](http://localhost:3737/methodology) for the formula
   breakdown of every scorer.

To retune targets or add a dimension, edit `app/data/rubric.json` and add a
matching scorer in `scripts/score.mjs`. Frontend picks it up automatically.

## Probe coverage

Every score traces to a **probe** — a named signal read from your local Claude
Code state. Probes sit on two axes:

- **P (config)** — Settings / Filesystem / Plugins: _"is it installed/configured?"_ (Platform Setup)
- **P\* (behavior)** — Transcripts: a usage signal (_"do you do it?"_) that still gates a Platform-Setup next-action, not the Execution radar
- **E** — cooked telemetry: the Execution radar vertices (_"are you using it?"_)
- **P+E** — scored on both axes

…and each of Boris Cherny's 75 tips carries a tracking status: ✅ predicate-backed
probe · 📊 shared/scorer signal · 🗣 behavioral coaching (not auto-detected) ·
❌ not yet tracked.

| Source layer                                               | Signals | Axis |
| ---------------------------------------------------------- | ------: | ---- |
| Settings (`~/.claude/settings.json`)                       |      23 | P    |
| Filesystem (`agents` / `commands` / `skills` / `projects`) |      10 | P    |
| Plugins (`enabledPlugins`, PATH)                           |       6 | P    |
| Transcripts (`projects/*/*.jsonl`)                         |      21 | P\*  |
| Insights / cooked telemetry (`usage-data/`)                |      11 | E    |
| **Total**                                                  |  **71** |      |

Of the 71 signals, **45 are catalog-backed probes**; **44 of them gate a
`satisfiedWhen` next-action** — the predicate-backed checks the dashboard's
[`/methodology/probes`](http://localhost:3737/methodology/probes) page renders
(grouped there by raw source, so the command counters show under _history_ and
cooked-telemetry signals aren't listed). The 45th catalog entry,
`sessionsByKind`, is the session-universe classifier. Across the **75 canonical
tips**: ✅ 51 · 📊 11 · 🗣 2 · ❌ 11.

The full per-probe registry (every field, predicate, and axis) and the
tip-by-tip coverage matrix live in the living tracker,
[`docs/superpowers/specs/2026-05-25-probe-implementation-status.md`](docs/superpowers/specs/2026-05-25-probe-implementation-status.md).
Its header counts are CI-enforced by `scripts/__tests__/tracker-counts.test.mjs`.

## Slash commands

Two slash commands ship in `.claude/commands/`:

- **`/self-assessment`** — calls `npm run assess` and reports back the
  Platform Setup + Execution scores, trend deltas, and the top three
  weight×deficit priority actions. Accepts the same flags as the script
  (`--include-transcripts`, `--insights-lookback N`, `--no-slack`, etc).
  Treat it like a morning standup with your toolchain. Full guide:
  [`docs/self-assessment.md`](docs/self-assessment.md).
- **`/refresh-insights`** — files the markdown summary from a `/insights`
  run in the current session into `app/data/insights-narrative.md`. Thin
  convenience wrapper around `pbpaste | npm run import-insights`; never
  invokes `/insights` itself, never paraphrases.

### Recommended personal commands (not in this repo)

The rubric scores authorship of a personal `/ship` slash command (Boris
tip 5) as the highest-weighted automation next-action. `/ship` is **not**
committed to this repo — it lives in your personal `~/.claude/commands/`
so it works against whatever repo your terminal is in. See
[`docs/ship-pattern.md`](docs/ship-pattern.md) for a one-page summary or
[`docs/superpowers/specs/2026-05-09-ship-slash-command-design.md`](docs/superpowers/specs/2026-05-09-ship-slash-command-design.md)
for the full 8-stage design spec.

### Running the full workflow

The two slash commands chain with Claude Code's built-in `/insights`. Run
`/insights` first (it's token-heavy and user-initiated), then chain the
filer + scorer in one shot:

```text
/insights

/refresh-insights && /self-assessment \
  --claude-md-target <name>=<absolute-path-to-project-root> \
  --include-transcripts \
  --insights-lookback 30
```

What each piece does:

| Step                | Effect                                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/insights`         | Anthropic's built-in command — writes the HTML report and prints the markdown narrative into the session. **Not invoked by this dashboard**; you run it yourself. |
| `/refresh-insights` | Files that markdown verbatim into `app/data/insights-narrative.md` (gitignored).                                                                                  |
| `/self-assessment`  | Calls `npm run assess`, scores Platform Setup + Execution, posts to Slack if configured.                                                                          |

Flag reference for `/self-assessment`:

| Flag                                         | Meaning                                                                                                                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--claude-md-target <name=path>` or `<path>` | Audit a CLAUDE.md file at `<path>`. With `name=path`, the report labels it `<name>`; with a bare path, the name defaults to the last directory segment. Repeat the flag for multiple targets. Path can use `~`. |
| `--include-transcripts`                      | Scan the last N days of `~/.claude/projects/*/*.jsonl` transcripts for behavioral signals (skill invocation, plan-mode usage, ★ Insight banners, worktree usage).                                               |
| `--no-transcripts`                           | Skip the transcript scan even when `scoring.includeTranscripts: true` in config. Wins over `--include-transcripts`.                                                                                             |
| `--insights-lookback <N>`                    | How many days back to read from `~/.claude/usage-data/`. Defaults to 30 (or `scoring.insightsLookbackDays` in config).                                                                                          |
| `--no-slack`                                 | Skip the Slack post even when `slack.enabled: true`. Useful for ad-hoc local runs.                                                                                                                              |
| `--print`                                    | Print the full block of dimension scores to stdout in addition to the summary.                                                                                                                                  |

Cadence note: `/insights` is token-heavy (run it weekly-ish);
`/self-assessment` is cheap (run it daily). The chained form above is the
full weekly refresh — drop the first two on daily runs.

## Slack notifier (optional)

1. Create an Incoming Webhook at <https://api.slack.com/apps> (new app → add
   Incoming Webhooks feature → add to channel).
2. Paste the URL into `.env.local` as `SLACK_WEBHOOK_URL=...`. `.env.local` is
   gitignored.
3. Set `slack.enabled: true` in `assessment.config.json` (it's true by default).
4. `npm run assess` will now post a scored card with strengths, biggest gaps,
   and an "Open dashboard" button linking to `publish.publicUrl`
   (default: `http://localhost:3737`).

The card link only works on your own machine because the dashboard is local.
That's intentional — the score is personal.

## Daily 07:15 run (optional)

Uses macOS `launchd`. Laptop is woken from sleep if needed; missed runs fire on
next wake.

```bash
npm run schedule:install     # one-time
launchctl start com.$(whoami).claude-self-assessment   # fire once to test
npm run schedule:uninstall   # remove
```

The installer reads `SLACK_WEBHOOK_URL` from `.env.local` and bakes it into
`~/Library/LaunchAgents/com.<you>.claude-self-assessment.plist`. See
[`ROUTINE.md`](./ROUTINE.md) for the full explanation of why `/schedule`
doesn't work here (Anthropic-cloud routines can't read your local
`~/.claude/`).

## Project layout

```
app/
  layout.tsx, page.tsx, globals.css   # Next.js 16 App Router
  components/RadarChart.tsx           # hand-rolled SVG radar
  lib/assessment.ts                   # loader + stats helpers
  data/
    rubric.json                       # static: titles, weights, targets, next-actions  ← committed
    assessment.json                   # current scored snapshot                          ← gitignored
    assessment-history.json           # trend series                                    ← gitignored
scripts/
  signals.mjs                         # read ~/.claude/
  score.mjs                           # rules → scores
  slack.mjs                           # webhook payload + poster
  run-assessment.mjs                  # entry point (npm run assess)
  setup.sh                            # first-run bootstrap
  launchd/
    claude-self-assessment.plist.template     # LaunchAgent template
    install.sh                        # substitutes placeholders, loads via launchctl
.claude/
  commands/self-assessment.md         # ships the /self-assessment slash command
assessment.config.example.json        # template for per-user config
.env.example                          # template for webhook secret
ROUTINE.md                            # scheduling deep dive
```

## What's committed vs. what's yours

| File / path                                                     | Status        | Why                                                                                                                                |
| --------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `assessment.config.example.json`                                | **committed** | template                                                                                                                           |
| `.env.example`                                                  | **committed** | documents `SLACK_WEBHOOK_URL`                                                                                                      |
| `app/data/rubric.json`                                          | **committed** | the static rubric everyone shares                                                                                                  |
| `app/data/boris-tip-index.json`                                 | **committed** | volume/tab routing metadata for `/tips/N` (small index, our own work)                                                              |
| `.claude/commands/self-assessment.md`                           | **committed** | the slash command                                                                                                                  |
| `.claude/commands/refresh-insights.md`                          | **committed** | the slash command                                                                                                                  |
| `app/data/boris-tips-content.json`                              | gitignored    | snapshot of the `/boris` skill (third-party content) — regenerated by `npm install` postinstall hook from `~/.claude/skills/boris` |
| `.claude/settings.local.json`                                   | gitignored    | per-user permissions                                                                                                               |
| `assessment.config.json`                                        | gitignored    | your display name, webhook channel                                                                                                 |
| `.env.local`                                                    | gitignored    | your webhook secret                                                                                                                |
| `app/data/assessment.json`                                      | gitignored    | your scored snapshot                                                                                                               |
| `app/data/assessment-history.json`                              | gitignored    | your trend series                                                                                                                  |
| `.launchd.{out,err}.log`                                        | gitignored    | runtime output from the LaunchAgent                                                                                                |
| `~/Library/LaunchAgents/com.<you>.claude-self-assessment.plist` | outside repo  | lives in your `$HOME`                                                                                                              |

The rubric and scoring engine are generic. Everything identifying — display
name, channel, webhook, and your actual scores — stays on your machine.

## Sharing this repo

Fork it or push it under your own account. A new user's experience:

```bash
git clone <your-fork>
cd <your-fork>
npm install
npm run setup
# edit assessment.config.json → their displayName
# (optional) edit .env.local → their webhook
npm run assess:print
npm run dev
```

No PRs touching `rubric.json` are needed per-user. Retunes of the target
profile (e.g. raising the permissions target) are the only reason to send a PR
back upstream.

## Tuning the rubric

`app/data/rubric.json` is the target profile. Each dimension has a `weight`
(1–3, how high-leverage the area is) and a `target` (0–100, what "good" looks
like). The overall score is a weight-normalized mean.

Change those two numbers per dimension to match your team's philosophy. A
security-first team might weight `permissions: 3` and `target: 95`; a research
lab might push `learning: 3` and drop `scheduled: 1`.

New dimensions need a matching scorer function in `scripts/score.mjs` keyed on
`id`. Without one, the dimension renders with score 0 and a "not-touched" tier.

## FAQ

**Why not use `/schedule` for the daily run?**
`/schedule` routines run in Anthropic's cloud. They don't have access to your
local `~/.claude/` directory, which is exactly what the scorer reads. `launchd`
is the local equivalent that can still wake your laptop.

**Does the dashboard need to be deployed?**
No. The default config points at `http://localhost:3737`. If you want the
Slack "Open dashboard" button to work from your phone, deploy the Next.js app
(`vercel deploy --prod`) and update `publish.publicUrl`.

**Why are scores lower than I expected?**
Scoring rewards what _you_ built (custom agents, commands, hooks), not what
plugins provide. Boris's rule is "if you do something 2×/day, make it a skill."
Score accordingly. Set `scoring.includePluginSkillsAsPersonal: true` in
`assessment.config.json` if you disagree.

**Where do Boris's tips come from?**
The `boris` skill at `~/.claude/skills/boris` (installed with the
`andrej-karpathy-skills` or `claude-code-workflows` marketplace). The rubric's
`borisTips` field cross-references section numbers.

## Surfacing Claude's `/insights` analysis in the dashboard

The dashboard scores your usage from raw signals on its own. Two opt-in paths
let you also surface Claude's own analysis — both read artifacts already on
your disk, neither auto-captures anything.

**1. One-click HTML report button.** When you run `/insights`, Claude Code
writes a full HTML report to `~/.claude/usage-data/report.html`. The
dashboard detects the file and shows an "Open Claude's full /insights
report" button that streams it locally through `/api/insights-report`. Same
posture as reading the JSON telemetry: a static file Claude Code wrote to
your machine, served locally for your own consumption.

**2. Inline markdown summary** (optional). For a condensed narrative
rendered inline, file it into `app/data/insights-narrative.md` via any of
three user-driven paths:

```bash
# In Claude Code:
/insights
# Then pick one:
/refresh-insights                   # slash command — Claude files the markdown verbatim
pbpaste | npm run import-insights   # pipe the macOS clipboard
# or paste into app/data/insights-narrative.md directly
```

The markdown file is gitignored, rendered locally, never uploaded, and
never posted to Slack. `/refresh-insights` is a thin convenience wrapper —
it only files output that `/insights` already produced in your session,
never invokes `/insights` on its own, and won't paraphrase or augment the
text. The HTML report is served only on localhost via the local Next
route. The dashboard never invokes `/insights` itself, never captures API
output, and never persists anything beyond the files you choose to create.

## Attribution & relationship to Claude Code

This is an **independent, open-source community tool**. It is **not affiliated
with, endorsed by, or sponsored by Anthropic**.

What the dashboard actually does:

- Reads files that Claude Code writes to your local `~/.claude/` directory
  during normal use — settings, installed plugins, project memory, and the
  per-session telemetry under `~/.claude/usage-data/`. Those are your files on
  your machine; this tool just reads them and computes its own scores.
- The Execution-axis scoring and the progression timeline rely on the same
  local data files that Claude Code's built-in `/insights` command reads.
  This project does **not** reuse `/insights` output, replicate its UI, or
  call any Anthropic API. References to `/insights` in the dashboard describe
  the data source format only.
- "Claude", "Claude Code", and "/insights" are trademarks of Anthropic, used
  here only to identify the platform this tool complements — not to imply
  endorsement or partnership.

Acknowledgements:

- **Anthropic** for building Claude Code and exposing the local
  `~/.claude/usage-data/` telemetry that makes the Execution axis possible.
- **Boris Cherny** ([@bcherny on X](https://x.com/bcherny)) — author of the
  87 workflow tips that the rubric weights are derived from.
- **Daniel An** ([@CarolinaCherry on
  GitHub](https://github.com/CarolinaCherry)) — creator of
  [howborisusesclaudecode.com](https://howborisusesclaudecode.com) and
  compiler of the `/boris` skill that `/self-assessment` cross-references.
  Tip content is rendered from a local snapshot of that skill via the
  dashboard's `/tips/N` route.

If you work at Anthropic and any of this attribution should be tightened
(or relaxed), please open an issue on this repo.

## License

This project is licensed under the **MIT License** — see the [`LICENSE`](./LICENSE)
file for the full text.

```
MIT License

Copyright (c) 2026 Theo Jungeblut

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

**Third-party content not covered by the MIT grant** (also documented in `LICENSE`):

- _Trademarks._ "Claude", "Claude Code", and `/insights` are trademarks of
  Anthropic, used nominatively. The MIT license does not grant trademark rights.
- _Tip content._ `app/data/boris-tips-content.json` is a snapshot of Boris
  Cherny's tips compiled by Daniel An. It's included for cross-referencing
  only; redistributing the tip text outside that role requires permission
  from the original authors.
