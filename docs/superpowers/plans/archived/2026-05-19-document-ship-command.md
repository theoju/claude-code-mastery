# Document and Surface /ship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formally document the personal `/ship` slash command as a recommended pattern in the `claude-extensions` repo, and upgrade the rubric's `automation/ship-command` next-action so the `/self-assessment` output presents it as a high-quality, spec-backed suggestion rather than a one-line nudge.

**Architecture:** Pure documentation + rubric copy change. No new signals, scorers, or implementation logic — `/ship` itself stays in `~/.claude/` (personal, outside this repo) and PR #36 already shipped the design spec. This plan closes the public-discoverability gap on four surfaces: the rubric action text (renders in `/self-assessment` output and on the dashboard), README.md, `docs/self-assessment.md`, and a new public-facing pattern summary.

**Tech Stack:** Markdown, JSON (`app/data/rubric.json`), vitest.

**Branch:** `docs/ship-command-public-docs` (off main).

---

## Current state — verified 2026-05-19

| Surface                                                          | State                                                                            | Source                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| `~/.claude/commands/ship.md`                                     | Exists (1,629 bytes, May 9)                                                      | Filesystem                                    |
| `~/.claude/skills/ship/{SKILL.md,spokes/,lib/,tests/}`           | Exists (May 9)                                                                   | Filesystem                                    |
| `docs/superpowers/specs/2026-05-09-ship-slash-command-design.md` | On main (PR #36 merged)                                                          | `git log`                                     |
| Signals `hasShipCommand`, `shipsRecent`, `shipVerifyStageRecent` | Detected & wired through `signalsSummary`                                        | `app/data/assessment.json`                    |
| Rubric `automation/ship-command` next-action                     | Exists with `satisfiedWhen: "hasShipCommand"` — text mentions only 4 of 8 stages | `app/data/rubric.json:19-22`                  |
| Rubric-predicates sweep test includes `hasShipCommand: true`     | Yes                                                                              | `app/lib/__tests__/rubric-predicates.test.ts` |
| README.md `## Slash commands` section                            | Lists only `/self-assessment` and `/refresh-insights`                            | `README.md:79-92`                             |
| `docs/self-assessment.md` user guide                             | No mention of `/ship`                                                            | `docs/self-assessment.md`                     |

**Gap:** A new user reading this repo's docs has no clear pointer to `/ship` even though the rubric scores it (Boris tip 5) and the spec doc lives on main. The current rubric action text is a one-line nudge; it should reference the spec doc so an implementer has a starting point.

---

## File Structure

| File                                          | Change                                                                                                                                               | Why                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `app/data/rubric.json`                        | Rewrite `automation/ship-command` `action` text — name all 8 stages, reference the spec doc path                                                     | Surfaces in `/self-assessment` output and at `/dimensions/automation` |
| `app/lib/__tests__/rubric-predicates.test.ts` | No change (sweep already includes `hasShipCommand: true`)                                                                                            | Verify, don't modify                                                  |
| `README.md`                                   | Add `/ship` as a third entry in `## Slash commands` under a new "Recommended personal commands" subsection; link to the new pattern doc and the spec | Closes the discoverability gap for new readers                        |
| `docs/ship-pattern.md`                        | **New file.** ~80-line public-facing summary: what /ship is, the 8 stages, where to find the spec, how to bootstrap it from `~/.claude/`             | A reader-friendly entry point; the spec doc is implementer-facing     |
| `docs/self-assessment.md`                     | Add a short callout in the "Suggestions" or "Pointers" section pointing at `/ship` and the new pattern doc                                           | Cross-link from the scorer guide to the recommended pattern it scores |

---

## Tasks Summary

| #   | Task                                                     | Effort |
| --- | -------------------------------------------------------- | ------ |
| 1   | Create branch and sanity-check working tree              | 2 min  |
| 2   | Upgrade rubric `automation/ship-command` action text     | 10 min |
| 3   | Verify rubric-predicates sweep test still passes         | 2 min  |
| 4   | Add `docs/ship-pattern.md` public summary                | 25 min |
| 5   | Add `/ship` row to README.md `## Slash commands` section | 15 min |
| 6   | Cross-reference `/ship` from `docs/self-assessment.md`   | 10 min |
| 7   | Run full test suite + Next.js typecheck                  | 5 min  |
| 8   | Manual dashboard preview: verify rubric copy renders     | 5 min  |
| 9   | Commit, push, open PR                                    | 10 min |

Total: ~90 minutes.

---

## Task 1: Create branch and sanity-check working tree

**Files:** none changed.

- [ ] **Step 1: Confirm clean working tree on main**

```bash
git status
```

Expected: `On branch main`, `nothing to commit, working tree clean`. If `CLAUDE.md` or other files show as modified (stale buffer state), confirm with the user before proceeding — don't auto-stash.

- [ ] **Step 2: Pull latest**

```bash
git fetch origin && git pull --ff-only origin main
```

Expected: `Already up to date.` or a fast-forward merge.

- [ ] **Step 3: Create branch**

```bash
git checkout -b docs/ship-command-public-docs
```

Expected: `Switched to a new branch 'docs/ship-command-public-docs'`.

---

## Task 2: Upgrade rubric `automation/ship-command` action text

**Files:**

- Modify: `app/data/rubric.json` — locate the `automation` dimension's `nextActions` array, find the entry with `"id": "ship-command"`.

**Why:** Current text reads `"Create ~/.claude/commands/ship.md that chains test → simplify → commit → PR — Boris tip 5"`. The actual /ship design (per `docs/superpowers/specs/2026-05-09-ship-slash-command-design.md`) is an 8-stage chain (pre-flight → cost-gate → test → verify-agent → simplify → code-review → commit → push+PR → Jira-update). The action text should name the full chain and point at the spec doc so an implementer has a starting blueprint.

- [ ] **Step 1: Read the current entry to confirm its exact shape**

```bash
node -e "
const r = JSON.parse(require('fs').readFileSync('app/data/rubric.json','utf8'));
const auto = r.dimensions.find(d => d.id === 'automation');
console.log(JSON.stringify(auto.nextActions.find(a => a.id === 'ship-command'), null, 2));
"
```

Expected output:

```json
{
  "id": "ship-command",
  "action": "Create ~/.claude/commands/ship.md that chains test → simplify → commit → PR — Boris tip 5",
  "effort": "30min",
  "satisfiedWhen": "hasShipCommand"
}
```

- [ ] **Step 2: Edit `app/data/rubric.json`** — replace ONLY the `action` field of the `ship-command` entry. Keep `id`, `effort`, `satisfiedWhen` untouched.

New value (use this exact string):

```
Create ~/.claude/commands/ship.md that chains test → verify → simplify → review → commit → push+PR → Jira. See docs/superpowers/specs/2026-05-09-ship-slash-command-design.md and docs/ship-pattern.md for a reference design — Boris tip 5
```

Use the `Edit` tool. The replacement must preserve JSON formatting (trailing comma, indentation). After editing, the entry should be:

```json
{
  "id": "ship-command",
  "action": "Create ~/.claude/commands/ship.md that chains test → verify → simplify → review → commit → push+PR → Jira. See docs/superpowers/specs/2026-05-09-ship-slash-command-design.md and docs/ship-pattern.md for a reference design — Boris tip 5",
  "effort": "30min",
  "satisfiedWhen": "hasShipCommand"
}
```

- [ ] **Step 3: Validate JSON parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('app/data/rubric.json','utf8')); console.log('OK')"
```

Expected: `OK`. If you see a SyntaxError, the edit broke JSON — re-read the file and fix.

- [ ] **Step 4: Commit just this change**

```bash
git add app/data/rubric.json
git commit -m "$(cat <<'EOF'
docs(rubric): expand /ship next-action with full 8-stage chain and spec link

The previous one-liner mentioned only 4 of /ship's 8 stages and gave no
pointer to the spec. Implementers needed to dig through the repo to find
the design. Now references both the spec (for implementers) and the new
pattern doc (for readers).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one-file commit, no hook failures.

---

## Task 3: Verify rubric-predicates sweep test still passes

**Files:** none changed.

**Why:** `app/lib/__tests__/rubric-predicates.test.ts` walks every `satisfiedWhen` in `rubric.json` against a known-good `ALL_SATISFIED_SIGNALS` fixture. Our edit only touched the `action` text — `satisfiedWhen: "hasShipCommand"` is unchanged — so the test should pass without modification. This step confirms.

- [ ] **Step 1: Run the rubric-predicates sweep**

```bash
npx vitest run app/lib/__tests__/rubric-predicates.test.ts
```

Expected: all tests pass. If any fail, the predicate or fixture is out of sync — STOP and diagnose; do not edit the test.

- [ ] **Step 2: Run the broader assessment test file**

```bash
npx vitest run app/lib/__tests__/assessment.test.ts
```

Expected: all tests pass.

---

## Task 4: Add `docs/ship-pattern.md` public summary

**Files:**

- Create: `docs/ship-pattern.md`

**Why:** The spec at `docs/superpowers/specs/2026-05-09-ship-slash-command-design.md` is implementer-facing — 207 lines of architecture, halt-rules, lifecycle. A new repo reader who sees `/ship` referenced in the rubric output needs a shorter on-ramp: what it is, what it does, where to start. This is that on-ramp.

- [ ] **Step 1: Create the file**

Use the `Write` tool to create `docs/ship-pattern.md` with this exact content:

```markdown
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
```

- [ ] **Step 2: Validate the file rendered correctly**

```bash
wc -l docs/ship-pattern.md && head -5 docs/ship-pattern.md
```

Expected: ~80 lines, first line `# \`/ship\` — recommended personal shipping command`.

- [ ] **Step 3: Commit**

```bash
git add docs/ship-pattern.md
git commit -m "$(cat <<'EOF'
docs: add public ship-pattern summary linking the spec to readers

The full spec is implementer-facing. New repo readers who see /ship
referenced in /self-assessment output and the README need a shorter
on-ramp explaining what /ship is, the 8 stages at a glance, where to
start, and how the scorer detects it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one-file commit.

---

## Task 5: Add `/ship` row to README.md `## Slash commands` section

**Files:**

- Modify: `README.md:79-130`.

**Why:** The README's `## Slash commands` section is the canonical "what slash commands does this repo know about?" surface. Today it lists only `/self-assessment` and `/refresh-insights` because those are the two that ship under `.claude/commands/`. `/ship` is different — it's not committed to any repo by design — but it deserves a clearly-labeled "recommended personal pattern" sub-entry so readers don't conclude it doesn't exist.

- [ ] **Step 1: Read the current section**

```bash
sed -n '79,131p' README.md
```

This is the section you'll modify. Note the existing format: the two committed commands are described as bullet points, followed by a `### Running the full workflow` subsection with a chain example.

- [ ] **Step 2: Use the Edit tool to insert a third bullet after `/refresh-insights`**

Locate the lines (currently around `README.md:89-92`):

```
- **`/refresh-insights`** — files the markdown summary from a `/insights`
  run in the current session into `app/data/insights-narrative.md`. Thin
  convenience wrapper around `pbpaste | npm run import-insights`; never
  invokes `/insights` itself, never paraphrases.
```

After that bullet (before `### Running the full workflow`), insert a small subsection. The result should read:

```
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
```

Use the `Edit` tool with the existing `### Running the full workflow` heading as part of `old_string` to uniquely locate the insertion point. The `new_string` should add the new subsection above it.

- [ ] **Step 3: Verify the insertion didn't break the rest of the section**

```bash
grep -n "^##\|^###" README.md | sed -n '1,30p'
```

Expected: heading order is `## Slash commands` → `### Recommended personal commands (not in this repo)` → `### Running the full workflow` → `## Slack notifier (optional)` (or whatever follows). No heading collisions.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): surface /ship as a recommended personal command

The Slash commands section listed only the two repo-committed
commands. Add a clearly-labeled "Recommended personal commands"
subsection that points readers at the new pattern doc and the spec.
Keeps /ship discoverable without implying it ships from this repo.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Cross-reference `/ship` from `docs/self-assessment.md`

**Files:**

- Modify: `docs/self-assessment.md`.

**Why:** The user guide is where a reader lands after running `/self-assessment` and wondering "what now?". If the rubric output mentions `/ship`, the guide should pick that up and explain.

- [ ] **Step 1: Locate the right spot**

Find the section in `docs/self-assessment.md` that discusses next-actions or suggestions. If unsure, run:

```bash
grep -n "next-action\|suggest\|Pointers\|automation" docs/self-assessment.md | head -20
```

The natural insertion point is near a "Pointers" / "Related" / "Recommended patterns" section, or — failing that — at the end of the "Invoking" section before any deeper internals.

- [ ] **Step 2: Insert a short callout**

Use the `Edit` tool to add this paragraph in the appropriate spot (pick a heading boundary that makes sense in the existing structure — don't fight the doc's flow):

```markdown
### Recommended pattern: `/ship`

The rubric's highest-weighted automation next-action is authoring a
personal `/ship` slash command. It lives in `~/.claude/commands/` (not
this repo) and chains test → verify → simplify → review → commit →
push+PR → Jira. See [`docs/ship-pattern.md`](./ship-pattern.md) for a
short summary and
[`docs/superpowers/specs/2026-05-09-ship-slash-command-design.md`](./superpowers/specs/2026-05-09-ship-slash-command-design.md)
for the full spec.
```

If the existing doc already has heading levels deeper than `###`, match the surrounding depth.

- [ ] **Step 3: Validate the doc still has valid markdown structure**

```bash
grep -c "^##\|^###" docs/self-assessment.md
```

Expected: a count consistent with adding one or two new headings. If the count exploded, your edit duplicated a section — undo and retry.

- [ ] **Step 4: Commit**

```bash
git add docs/self-assessment.md
git commit -m "$(cat <<'EOF'
docs(self-assessment): cross-reference /ship pattern

Close the loop between the scorer's user guide and the new ship-pattern
doc. A reader running /self-assessment and seeing the ship-command
suggestion now has a direct pointer from the user guide.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Run full test suite + Next.js typecheck

**Files:** none changed.

- [ ] **Step 1: Run vitest suite**

```bash
npx vitest run
```

Expected: all tests pass (494 per CLAUDE.md; current count may vary). If any fail:

- `rubric-predicates.test.ts` failure → re-check Task 2 edit; the action text changed but `satisfiedWhen` should still resolve.
- Any other failure → likely unrelated; surface to user and STOP.

- [ ] **Step 2: Next.js typecheck (lib + page)**

```bash
npx tsc --noEmit 2>&1 | grep -E "rubric|ship|assessment\.ts" | head
```

Expected: empty output (no errors in the files we touched). Pre-existing errors in unrelated files (e.g. `RadarChart.test.tsx`) are fine.

---

## Task 8: Manual dashboard preview

**Files:** none changed.

**Why:** The rubric action text renders in two places — the `/dimensions/automation` page and the priority-actions list on the dashboard home. Confirm the new copy renders cleanly (no broken markdown, no overflowed truncation).

- [ ] **Step 1: Start dev server if not running**

```bash
lsof -i :3737 | grep LISTEN || npm run dev &
```

Wait until the server is listening (check `curl -s http://localhost:3737 | head -5` returns HTML).

- [ ] **Step 2: Visually inspect the rendered action**

Open `http://localhost:3737` in a browser. The "Top priority actions" section may or may not show the ship-command action depending on whether `hasShipCommand` is satisfied in the current snapshot — that's expected.

Then visit `http://localhost:3737/dimensions/automation` and look for the ship-command action card. Verify the action text reads as intended; the spec doc paths render as plain text (the dashboard does not auto-linkify markdown links — that's known).

- [ ] **Step 3: Note any visual issues**

If the action text wraps awkwardly or truncates mid-link, shorten the action text in `app/data/rubric.json` and re-commit as a fixup. If it renders cleanly, proceed.

---

## Task 9: Commit, push, open PR

**Files:** none changed (commits already exist from prior tasks).

- [ ] **Step 1: Sanity-check commit history**

```bash
git log --oneline main..HEAD
```

Expected: 4 commits (rubric, ship-pattern.md, README, self-assessment.md). If you have additional commits from Task 8 fixups, that's fine — keep them.

- [ ] **Step 2: Push branch**

```bash
git push -u origin docs/ship-command-public-docs
```

Expected: branch created on origin with upstream tracking.

- [ ] **Step 3: Open PR**

```bash
gh pr create --base main --title "docs: surface /ship as a recommended personal pattern" --body "$(cat <<'EOF'
## Summary

- Closes the public-discoverability gap for the /ship slash command — PR #36 shipped the spec but no surface (README, user guide, rubric action text) referenced it.
- Upgrades the rubric's `automation/ship-command` next-action to name all 8 stages and link the spec + new pattern doc, so `/self-assessment` output reads as a real recommendation rather than a one-liner.
- Adds `docs/ship-pattern.md` as a reader-friendly on-ramp pointing at the spec for implementers.
- Cross-links from README and `docs/self-assessment.md`.

No behavior changes. No new signals, scorers, or implementation logic — `/ship` itself stays in `~/.claude/` (personal, outside this repo).

## Test plan

- [x] `npx vitest run` — all tests pass (rubric-predicates sweep still resolves `hasShipCommand`).
- [x] `npx tsc --noEmit` — no new errors in touched files.
- [x] Manual dashboard preview at `/dimensions/automation` — new action text renders cleanly.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens against `main`, mergeable.

- [ ] **Step 4: Note PR URL and stop**

Return the PR URL to the user. **Do not merge** — let the user review and decide.

---

## Self-Review

**Spec coverage:**

- [x] /ship documented in GitHub: README.md + docs/ship-pattern.md + docs/self-assessment.md.
- [x] /ship surfaced as a suggestion in /self-assessment output: rubric action text upgraded with full 8-stage chain + spec link.
- [x] PR #36 acknowledged as already-merged prerequisite; this plan doesn't touch the spec doc itself.

**Placeholder scan:**

- No "TBD", "TODO", "implement later" patterns in the plan.
- All exact strings to insert into rubric.json, README.md, ship-pattern.md, self-assessment.md are spelled out verbatim.
- All commands have expected output documented.

**Type consistency:**

- The rubric entry preserves its `id`, `effort`, `satisfiedWhen` fields exactly; only `action` text changes.
- Heading levels in `docs/ship-pattern.md` (`#`, `##`) and `docs/self-assessment.md` (`###`) match the existing depth of each doc.

**Edge case noted in Task 8:** the dashboard doesn't auto-linkify markdown URLs in action text — the spec doc path renders as plain text. If that bothers the user, a follow-up PR could extend `LinkifyBoris` to also recognize path-like tokens. Not in scope for this plan.
