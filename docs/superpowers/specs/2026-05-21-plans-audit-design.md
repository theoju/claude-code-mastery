# Plans Audit + `archived/` Convention — Design Spec

> **For agentic workers:** REQUIRED NEXT STEP: invoke `superpowers:writing-plans` to turn this spec into an implementation plan. The plan executes inside this repo (`claude-extensions`); all edits land on `main` via a single PR (plus the user-executed merge).

> **For readers:** This spec introduces a daily report-only audit that surfaces "landed plans not yet archived." Companion to the existing `scripts/claude-md-audit.mjs`. A new convention (`docs/superpowers/plans/archived/`) is established. No scoring changes, no dashboard changes, no auto-mutations.

**Goal:** Stop `docs/superpowers/plans/` from accumulating landed plans indefinitely (18 today, growing every PR) by surfacing archive candidates in the daily console output.

**Why now:** Today's Task 3 verification (PR #62 cycle) confirmed the directory is flat with no archival convention. With 18 plans and the cadence accelerating (4 PRs shipped in this single session alone), the directory will become noise inside a month without intervention.

**Why not more:** Auto-move, dashboard surfaces, Slack integration, specs-directory coverage, and metadata frontmatter are all deferred until v1 proves the pattern. Report-only matches the existing `claude-md-audit.mjs` posture exactly — same architectural choice, same daily routine surface, same zero-coupling-to-scoring property.

---

## Architecture

**Premise:** A plan is _archive-ready_ when its file is tracked on `main`. Detection is purely git-based. No metadata in plan docs, no decoration of the existing landing workflow.

**One new file:**

- `scripts/plans-audit.mjs` — sibling to the existing `scripts/claude-md-audit.mjs`. Same posture (report-only), same shape (functional, ESM, no dependencies beyond Node built-ins).

**One existing file modified:**

- `scripts/run-assessment.mjs` — import and invoke `auditPlans()`; print its section after the CLAUDE.md health block.

**One convention established:**

- `docs/superpowers/plans/archived/` — a real directory the user creates by moving the first plan file there (no script creates it). The audit script only _reports_; the user moves via docs PR.

**Test file:** `scripts/__tests__/plans-audit.test.mjs`.

**Nothing changed:**

- Scoring logic (`score.mjs`, `signals.mjs`, `insights-signals.mjs`)
- Rubric / probe catalog
- Dashboard routes/components
- Slack output (`scripts/slack.mjs`)
- Existing test fixtures

This mirrors `claude-md-audit.mjs` exactly: a parallel audit that surfaces nudges via the daily console, with zero coupling to the two-axis scorer.

---

## Detection logic

Per `.md` file in `docs/superpowers/plans/` (top-level only — `archived/` skipped):

1. Check if file is tracked on `main`:

   ```
   git log main --format=%H -- <path>
   ```

2. If no commits on main → skip (in-progress draft, not landed yet).

3. If commits on main → landed; capture:
   - **first-appearance SHA** — oldest commit touching the file (use `git log main --reverse --format='%H %ct %s' -- <path>` and take the first line)
   - **age** — `(now - committer date) / 86400` in days, rounded down to integer
   - **PR number** — regex match `/\(#(\d+)\)/` against the squash-merge commit subject (use the _latest_ commit's subject from `git log main -1 --format=%s -- <path>`). If no match, fall back to the short SHA from the first-appearance commit.

4. Add to the report list. Sort by age descending (oldest first).

Files in `docs/superpowers/plans/archived/` are not scanned. The `archived/` directory comes into existence the first time the user moves a file there — the audit doesn't auto-create it. If `archived/` doesn't exist, the audit treats it as "no archived plans yet" and proceeds normally.

---

## Output format

Matches the compact register of CLAUDE.md health, printed by `run-assessment.mjs` after the CLAUDE.md health block:

```
Plans audit (report-only):
  Landed plans not yet archived: 3
    2026-05-20-session-kind-filtering.md              #62  1 day ago
    2026-05-20-symmetric-pointers-jira-ship.md        #61  1 day ago
    2026-05-20-cce-13-closeout-and-release-v0.9.8.md  #65  1 day ago
```

Column alignment: filename left-padded to longest filename in the report; PR/SHA column right-aligned in a 6-char field; age column free-form ("N days ago", "1 day ago", "today").

Empty state:

```
Plans audit: nothing to archive.
```

Direct-to-main fallback (no `(#NN)` in subject):

```
    2026-05-09-orphan-plan.md  9cc07c5  11 days ago
```

---

## Function signature + injected dependencies

```js
// scripts/plans-audit.mjs

const defaults = {
  plansDir: path.join(repoRoot, "docs/superpowers/plans"),
  gitLog: realGitLog, // ({ path, args }) => Promise<Array<{ sha, ts, subject }>>
  readdir: fs.readdir, // (dir) => Promise<string[]>
  now: () => new Date(),
};

export async function auditPlans(deps = defaults) {
  // Returns: { count: number, items: Array<{ filename, prOrSha, ageDays, ageLabel }> }
}

export function formatAuditReport(audit) {
  // Returns: string (the multi-line console block)
}
```

The tuple of injected dependencies is the test boundary. Production code wires defaults; tests pass stubs.

---

## Testing

Six tests in `scripts/__tests__/plans-audit.test.mjs`, all using stubbed git:

| #   | Scenario                                                      | Assertion                                                      |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Empty `plansDir`                                              | `count == 0`; format prints "nothing to archive."              |
| 2   | Plan with no git history (stub returns `[]`)                  | Excluded from report (in-progress draft)                       |
| 3   | Plan with one landed commit, subject ends `(#62)`             | Included; `prOrSha == "#62"`; age computed from stub timestamp |
| 4   | File in `plansDir/archived/<name>.md`                         | Skipped (not scanned at all)                                   |
| 5   | Plan landed via direct-to-main commit, subject has no `(#NN)` | Included; `prOrSha == "<short-sha>"`                           |
| 6   | Three plans of varying ages                                   | Sorted oldest-first in output                                  |

No real git state, no real filesystem outside vitest's tmp helpers. Total runtime target: <100ms (matches the rest of the suite's per-test budget).

The vitest count will rise from 520 to 526.

---

## Out of scope (v1)

Deliberate cuts:

- **Specs directory** (`docs/superpowers/specs/`) — same convention could apply; defer until plans audit ships and proves the pattern. Specs are also fewer (5 vs 18) and accumulate slower.
- **Dashboard surface** — CLI-only per design.
- **Auto-move / auto-PR** — report-only per design.
- **Age threshold** — no `--min-age-days` flag; add later if very-fresh plans pollute the report.
- **Slack inclusion** — CLI-only per design. The existing Slack post is not touched.
- **Plan-doc metadata frontmatter** (e.g., `pr: 62`) — git history is canonical; no per-plan annotation needed.
- **Stale-but-not-landed detection** (orphaned feature-branch drafts) — different problem class.
- **Multi-PR plans** — list latest PR only; user disambiguates manually if needed.

---

## Branch + commit + merge strategy

- **Branch:** `feat/plans-audit` (matches existing feature-branch convention, e.g., `feat/v0.1.1-hardening`)
- **CCE ticket:** open a new `CCE-N` ticket at the start of the implementation plan (per the convention codified in CLAUDE.md `## Issue tracking`). Reference the key in the PR title (e.g., `feat(plans): daily archive-candidate audit — CCE-14`).
- **Commits** (TDD-shaped, one logical step each):
  1. `test(plans-audit): seed failing tests for the audit function`
  2. `feat(plans-audit): add scripts/plans-audit.mjs with auditPlans/formatAuditReport`
  3. `feat(run-assessment): wire plans audit into the daily console report`
- **PR title:** `feat(plans): daily archive-candidate audit — CCE-N`
- **Merge:** squash to `main` from the main checkout (per the CLAUDE.md worktree-merge gotcha).
- **Post-merge:** `git fetch --prune`, transition CCE-N to Done, comment the PR link on the ticket.
- **No version bump:** small feature, not a release on its own. Will be picked up by the next release-branch PR.

---

## Verification

- **Automated tests:** 6 new tests pass; 520 → 526 baseline. Full suite still green.
- **`tsc --noEmit`:** clean (no .ts files touched directly; only .mjs additions which tsc doesn't process).
- **Manual smoke:** run `npm run assess` after merge; confirm the audit block prints and matches the format spec above.
- **Empty-state verification:** create a tmpdir with an empty `plans/`, point `--plans-dir` at it (if we add the flag), see the empty-state line. (Note: v1 has no `--plans-dir` flag — verified via test fixture 1 instead.)

---

## Success criteria

The spec succeeds when:

1. `scripts/plans-audit.mjs` exists and exports `auditPlans` + `formatAuditReport`.
2. `scripts/run-assessment.mjs` invokes the audit and prints its block.
3. `scripts/__tests__/plans-audit.test.mjs` has the six tests above; all pass.
4. `npx vitest run` shows `526 passed`.
5. `tsc --noEmit` is clean.
6. Running `npm run assess` from the repo prints a block matching one of the three output shapes above (populated / empty / direct-to-main fallback).
7. PR squash-merged from the main checkout; remote/local cleanup complete; CCE-N transitioned to Done.

---

## Self-review

- ✅ **Placeholder scan:** no TBDs, no "fill in later." All API shapes, output formats, regexes, and test scenarios specified concretely.
- ✅ **Internal consistency:** Section 1's "audit doesn't auto-create `archived/`" matches Detection Logic's "if archived/ doesn't exist, treat as no archived plans yet." Output format examples align with the column-alignment rule.
- ✅ **Scope check:** single subsystem (new audit script + one-line wire-up), one PR, fits one implementation plan. Out-of-scope list is explicit.
- ✅ **Ambiguity check:** detection algorithm specifies "first-appearance SHA" via `--reverse` to avoid ambiguity between "added" vs "last touched"; PR-number extraction uses _latest_ commit (squash-merge) not first-appearance to handle the case where a plan was first-committed on a branch and squashed later under a different commit subject.
