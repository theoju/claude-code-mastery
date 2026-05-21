# Symmetric Cross-References for /ship Spec, ship-pattern, and Jira Convention — Design Spec

> **For agentic workers:** REQUIRED NEXT STEP: invoke `superpowers:writing-plans` to turn this spec into an implementation plan. The plan executes inside this repo (`claude-extensions`); both edits land on `main` via a single PR.

> **For readers:** This is a docs-only change closing two cross-reference asymmetries found during a post-merge audit of PR #58 and PR #59. The change adds one back-pointer to the `/ship` design spec and one forward-pointer in `CLAUDE.md`'s `## Issue tracking` section. No code, no tests, no scorer impact.

**Goal:** Add bidirectional cross-references so (a) readers of the `/ship` design spec can find the reader-facing one-page summary, and (b) readers of `CLAUDE.md`'s new `## Issue tracking` section can find the canonical example of Jira-touching automation in this repo.

**Why now:** PR #58 added `docs/ship-pattern.md` as a public summary that forward-points to the spec, but the spec doesn't point back. PR #59 added `## Issue tracking` to `CLAUDE.md` as a self-contained rule section that doesn't surface its canonical example. The CLAUDE.md `## Conventions` doctrine ("default to symmetric; one-way pointers age into stale asymmetric trees") flags both as gaps worth closing.

**Why not more:** A broader symmetric-pointer audit found that the pre-existing skill/command/doc tree (`/refresh-insights` ↔ `/self-assessment` ↔ `docs/self-assessment.md` ↔ `.claude/skills/self-assessment/SKILL.md`) is already symmetric — PR #26 and PR #27 closed those gaps earlier. No further audit findings.

---

## Audit findings (locked at 2026-05-20)

Two asymmetries closed by this spec, two non-asymmetries documented for posterity:

### Closed by this PR

| #   | From                                                             | To                             | Direction status before            | After                 |
| --- | ---------------------------------------------------------------- | ------------------------------ | ---------------------------------- | --------------------- |
| 1   | `docs/superpowers/specs/2026-05-09-ship-slash-command-design.md` | `docs/ship-pattern.md`         | one-way (ship-pattern → spec only) | bidirectional         |
| 2   | `CLAUDE.md` `## Issue tracking`                                  | `docs/ship-pattern.md` Stage 7 | no pointer (new section in PR #59) | forward pointer added |

### Considered and rejected

| #   | Candidate                                                                                      | Why rejected                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3   | Pin `docs/ship-pattern.md` to a specific Jira project (CCE)                                    | `docs/ship-pattern.md` line 75 explicitly states the pattern is project-neutral by design (`"embedding it in a product repo would couple it to that product's CI and review conventions"`). Adding a CCE reference would conflict with that scope statement. |
| 4   | Add CCE references to the `/ship` design spec or `~/.claude/skills/ship/spokes/jira-update.md` | These are personal-tool docs; pinning to a project-specific Jira target would couple the personal tool to one project.                                                                                                                                       |

---

## File-by-file changes

### Edit 1 — Spec doc back-pointer

**File:** `docs/superpowers/specs/2026-05-09-ship-slash-command-design.md`
**Placement:** insert a new blockquote callout immediately after the existing "For agentic workers" callout (line 3 in the current file), before the `**Goal:**` line.

**Exact addition:**

```markdown
> **For readers:** A reader-facing one-page summary is rendered at the dashboard's `/docs/ship-pattern` route and lives at `docs/ship-pattern.md`. Read that first if you want the 8-stage chain and where-to-start without the full design.
```

**Style match:** uses inline code paths (no markdown link) to match the file's existing convention. Sits as a peer to the agentic-workers callout, creating a parallel "reader-vs-agentic" navigation pattern at the top of the spec.

### Edit 2 — CLAUDE.md `## Issue tracking` forward pointer

**File:** `CLAUDE.md`
**Placement:** append a new bullet at the end of the `## Issue tracking` section (after the existing "Atlassian MCP server" bullet, before the `## Privacy` heading).

**Exact addition:**

```markdown
- For the reference example of Jira-touching automation, see
  `docs/ship-pattern.md` Stage 7 — the `/ship` command transitions
  the linked ticket and posts the PR link as the close-of-loop step.
```

**Style match:** uses inline code paths (no markdown link) to match the section's existing bullets. Hangs indented continuation lines like the surrounding bullets.

---

## Branch + commit + merge strategy

- **Branch:** `docs/symmetric-pointers-jira-ship`
- **Commit 1:** `docs(spec): add reader-facing summary back-pointer to ship-pattern.md`
- **Commit 2:** `docs(claude.md): forward-ref ship-pattern Stage 7 from ## Issue tracking`
- **PR title:** `docs: bidirectional cross-references between /ship spec, ship-pattern, and Jira convention`
- **Merge:** squash to `main` (matches PR #58 and PR #59 cadence).
- **Post-merge:** `git fetch --prune` to clear the stale remote-tracking ref left by `--delete-branch`.
- **No version bump:** docs-only change; the v0.9.7 tag is unaffected.

---

## Verification

- **Automated tests:** none required. No code or scorer paths touched. The 508/508 vitest baseline and `tsc --noEmit` clean state on `main @ 9cc07c5` carry forward unchanged.
- **Dashboard render:** none required. The `/docs/ship-pattern` route reads `docs/ship-pattern.md`, which is **not** edited by this PR.
- **Manual pre-commit check:** for each addition, re-read the surrounding lines in context to confirm wording flows with adjacent text and that relative paths resolve when viewed in GitHub's Markdown previewer.

---

## Design choice — no CCE Jira ticket for this PR

Considered: file this PR as the first `CCE-N` ticket in the new project to exercise the convention added in PR #59 end-to-end.

**Rejected because:**

- The `## Issue tracking` rule says "Reference the key in PR titles and commit messages **when the work maps to a ticket**." Pure cross-reference housekeeping doesn't map to a feature, bug, or improvement ticket.
- 2-edit docs PRs aren't substantive enough to warrant ticket overhead. Over-applying `CCE-N` to trivial PRs would dilute the convention's signal value.
- The "first CCE-N PR" deserves to land on real work (a feature or fix), not on a housekeeping audit. That's tracked as item #4 in the post-session priority list.

This rationale is recorded here so future readers can understand the deliberate omission.

---

## Scope check

- **Single PR:** yes — both edits ship together; they're complementary halves of the same audit finding.
- **Single subsystem:** yes — docs cross-reference hygiene.
- **Independent value:** each commit is independently meaningful (spec back-pointer is useful on its own; CLAUDE.md forward-pointer is useful on its own). But shipping together is the natural shape.
- **Worktree:** not needed — two-line edits with no test impact; isolated branch is sufficient.

---

## Self-review (post-write)

- ✅ **Placeholder scan:** no TBDs, no "fill in later" — both additions have exact text quoted verbatim.
- ✅ **Internal consistency:** Edit 1 and Edit 2 don't contradict; they close different asymmetries. The Edit 2 wording ("reference example of Jira-touching automation") matches the existing section's framing ("future automation in this repo needs Jira integration").
- ✅ **Scope check:** appropriate for one implementation plan; 2 commits + 1 PR.
- ✅ **Ambiguity check:** placement is locked (top-of-spec callout for Edit 1; end-of-section bullet for Edit 2); link style is locked (inline code paths matching surrounding context).

---

## Success criteria

The spec is successfully implemented when:

1. `docs/superpowers/specs/2026-05-09-ship-slash-command-design.md` contains the "For readers" callout in the position specified above, with verbatim text.
2. `CLAUDE.md` `## Issue tracking` ends with the `docs/ship-pattern.md` Stage 7 bullet, with verbatim text.
3. Both changes land as separate commits on a single PR squash-merged to `main`.
4. `git log --oneline -3` on `main` shows the new squash commit at HEAD.
5. The stale remote-tracking ref for `docs/symmetric-pointers-jira-ship` is pruned locally.
