# Session retrospective — 2026-07-30

A single long-running session (opened 2026-07-25, closed 2026-07-30) that ran
the full weekly chain, built the first knowledge graph of this repo, shipped two
PRs, and lost most of an afternoon to a toolchain failure. Recorded here because
the diagnosis path is reusable.

Not published to the docs site — `mkdocs` builds from `docs/site-src/` only
(`mkdocs.yml:4`), and this contains machine-local detail.

---

## What ran

| Stage               | Outcome                                                      |
| ------------------- | ------------------------------------------------------------ |
| `/insights`         | 540 sessions analysed, 2026-06-16 → 2026-07-25               |
| `/refresh-insights` | filed verbatim to `app/data/insights-narrative.md` (2,869 B) |
| `/self-assessment`  | Platform **92** / Execution **64**, Δ 28                     |
| `/graphify`         | 1,424 nodes · 2,064 edges · 161 communities                  |
| PR #177             | graphite + electric-blue retheme → merged `e4059fb`          |
| PR #178             | toolchain gotchas → merged `8f8cfd4`                         |

## The assessment read

Platform 92 vs Execution 64 is the diagnostic case the rubric was built to
surface: tooling installed, habits not following. The whole Δ 28 lives in three
dimensions where the Platform score is near-perfect and Execution is near-zero —
Terminal & Customization **0** (Platform 100), Integrations **4** (Platform 95),
Memory & Context **20** (Platform 100).

Movement was entirely on the Execution axis; every Platform dimension was flat.
Memory dropped 35 → 20 in one day, which is the **CCE-79 recalibration working
as designed** rather than a regression: the numerator is now only the two
session-coverage signals (`/clear` + `/compact`), so a day of long uncompacted
sessions moves it hard. Remote moved the other way, 67 → 100 against a Platform
score of 87 — usage outrunning setup, the inverse of the headline gap. Worth
remembering that the two axes genuinely decouple in **both** directions.

## The knowledge graph

First `/graphify` build of this repo. 189 files, ~265k words, 4 parallel
extraction agents, 450,179 tokens.

The genuinely valuable output was the semantic layer, not the AST layer.
`CLAUDE.md` alone produced 39 nodes that are almost entirely _rationale_ — each
hard rule carrying its originating incident (PR / CCE ticket). No import graph
recovers that.

The most interesting cross-document link found: the tip-type taxonomy
(Setup only / Habit only / Both) and the two-axis scoring model (Platform Setup
/ Execution) are **the same partition expressed in two independent
vocabularies**, in two files that never reference each other.

Two structural artifacts were significant enough to codify as CLAUDE.md
conventions — the `boris-tip-index.json` community fragmentation and the ~10%
dangling semantic edges. See the Conventions section; not repeated here.

One flagged edge was **spurious and left in the report deliberately**: an
`OAuth Token Well-Formedness Assertion` ≈ `Posture vs Volume Command Partition`
similarity at INFERRED confidence. A nightly-workflow token gate and a
command-counting partition share no problem domain. Useful calibration on how
much INFERRED noise to expect.

## The toolchain failure

**Symptom:** mid-session, `npm`, `node`, `npx`, and `gh` all vanished. They had
worked earlier in the same session.

**Cause:** a Homebrew Intel→ARM version correction. Two independent failures
stacked, and each alone explains only part of the symptoms — which is why it
took as long as it did:

1. The uninstall removed every formula in the old `/usr/local` prefix, taking
   `node` and `gh` with it.
2. `~/.zprofile` still evaluated `$(/usr/local/bin/brew shellenv)` for a `brew`
   that no longer existed — so login and non-interactive shells got no Homebrew
   at all, while the interactive terminal kept working via the separate `eval`
   in `~/.zshrc`.

**What made it confusing:** the terminal worked fine. Only Claude Code's shell
was blind. That reads as a Claude Code bug rather than a shell-config bug, and
it sent the first diagnosis pass looking in the wrong place.

**What resolved it:** comparing shell types directly — `zsh -lc` (login) vs
`zsh -ic` (interactive) vs `zsh -c` (plain). The split output localised the bug
to `.zprofile` in one step. Full rule in CLAUDE.md Conventions.

### Process lessons

- **A running session inherits the PATH captured at session start.** Fixing
  `.zprofile` did not help the live session at all; absolute paths
  (`/opt/homebrew/bin/gh`) kept work moving, and a restart picked up the fix.
  Worth reaching for absolute paths early rather than treating the session as
  blocked.
- **Two wrong inferences were made and corrected mid-diagnosis**, both now
  written into the CLAUDE.md entry because both would mislead the same way
  again: `/usr/local/bin` is _not_ a dead Homebrew prefix (it holds live
  Docker / gcloud / python.org tooling — never clean it out), and stranded
  `npm -g` packages are _not_ broken, just frozen at their old version.
- **The stop-verify hook caught a real gap.** It fired on 93 changed files and
  forced a verification pass that surfaced `graphify-out/` being untracked and
  unignored — 3.2 MB of build output one `git add -A` away from being
  committed. The hook was reacting to generated artifacts rather than source
  edits, and still produced the session's most useful catch.

## Follow-ups not taken

- `npm run lint` is still broken repo-wide (`next lint` removed in Next 16).
  Pre-existing, flagged in PR #177, out of scope.
- Two landed plans remain unarchived: `2026-06-01-mkdocs-upgrade.md` (#122) and
  `2026-06-04-cce79-memory-scorer-redesign-plan.md` (#128), 53 and 51 days.
- Top-ranked next-actions from the assessment, all Platform-axis and untouched:
  promote a repeating pattern to a Routine (`scheduled`, weight 2 × deficit 37),
  install the Claude Chrome extension, try the Claude Code desktop app (both
  `verification`, 5 min each, tied at rank 54).
