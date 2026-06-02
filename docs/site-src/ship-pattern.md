# `/ship` — recommended personal shipping command

`/ship` is a personal slash command pattern that codifies the recurring
"close the loop on a feature" sequence so it runs as one chained call.
It is **not** committed to this repo — it lives in your personal
`~/.claude/commands/` and `~/.claude/skills/ship/` so it works against
whatever repo your terminal is currently in.

The `/self-assessment` rubric scores authorship of `/ship` as the
highest-weighted automation next-action (Boris tip 5) because the
underlying pattern — shipping a feature end-to-end without forgetting
the post-merge bookkeeping — is exactly the kind of two-times-a-day
workflow Boris's playbook tells you to codify.

## The 8-stage chain

| #   | Stage           | What it does                                                                                                              |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0   | Pre-flight      | Detect repo, branch, test runner, Jira key from branch name; create a state file under `~/.claude/skills/ship/state/`.    |
| 0a  | Early cost gate | Skip if the working tree has no changes worth shipping (silent exit, no halt).                                            |
| 1   | Test            | Detect the project's test command (`npm test`, `pytest`, `cargo test`, …) and run it; halt on failure.                    |
| 2   | Verify-agent    | Dispatch a verify-agent subagent that checks the change against the original task; halt on rejection.                     |
| 3   | Simplify        | Optional (`--no-simplify` skips). Invoke the `simplify` skill to clean up duplication or dead branches surfaced by edits. |
| 4   | Code review     | Dispatch the `code-review` plugin's reviewer against the staged diff; halt on hard findings, prompt on soft ones.         |
| 5   | Commit          | Compose a conventional-commit message from the diff and create the commit.                                                |
| 6   | Push + PR       | Push the branch, open a PR (draft if `--draft`), template the body from the commit + Jira context.                        |
| 7   | Jira update     | If a Jira key was detected, transition the ticket to In Review and post a link to the PR.                                 |

Each stage is independently halted: a failure at stage 2 doesn't push
broken code at stage 6. Halt-vs-prompt-vs-log rules per stage live in
the spec under `## Halt rules`.

## Where to start

The full design spec — files, lifecycle, halt matrix, gotchas — lives
at:

- [`docs/superpowers/specs/2026-05-09-ship-slash-command-design.md`](./superpowers/specs/2026-05-09-ship-slash-command-design.md)

To author your own copy:

1. Read the spec end-to-end. It's ~200 lines and self-contained.
2. Create `~/.claude/commands/ship.md` as a thin slash-command entry
   point that delegates to a `ship` skill.
3. Create `~/.claude/skills/ship/SKILL.md` as the hub and break stage
   details into spokes (`spokes/pre-flight.md`, `spokes/test-detection.md`,
   `spokes/jira-update.md`, etc.). Hub-and-spokes keeps the slash command
   small (it's loaded into every session).
4. Wire test-command detection through a small shell script at
   `~/.claude/skills/ship/lib/detect-test-cmd.sh` (echo the detected
   command on stdout, exit 0 on hit / 1 on no match).
5. Run `/ship` against a real branch. Expect to iterate on the halt
   rules for a few days before they fit your repos.

## How `/self-assessment` knows about it

The scorer detects three signals from `~/.claude/`:

| Signal                  | Source                                                                    | Effect                                                                           |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `hasShipCommand`        | File exists at `~/.claude/commands/ship.md`                               | Satisfies the `automation/ship-command` next-action — suggestion drops off list. |
| `shipsRecent`           | Transcript scan: count of `/ship` invocations in last N days              | Feeds the automation Execution score.                                            |
| `shipVerifyStageRecent` | Transcript scan: count of "Stage 2: Verify-agent" markers from /ship runs | Feeds the verification Execution score via Boris tip 73 (`/go` reflex).          |

Until `~/.claude/commands/ship.md` exists, `/self-assessment` will keep
surfacing the `automation/ship-command` action as a priority. Authoring
it lands a `↗` on the automation Platform Setup score and unlocks the
two Execution signals above.

## Not in this repo

`/ship` is a personal tool, not a project artifact. This repo
(`claude-extensions`) only **documents** it as a recommended pattern —
the running code stays in `~/.claude/`. That separation is intentional:
`/ship` invokes Jira and gh against whatever credentials and project
the user's shell currently holds; embedding it in a product repo would
couple it to that product's CI and review conventions.
