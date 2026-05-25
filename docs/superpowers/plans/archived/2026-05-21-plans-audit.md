# Plans Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `scripts/plans-audit.mjs` + wire it into `npm run assess` to report landed plans that haven't been archived yet, per the spec at `docs/superpowers/specs/2026-05-21-plans-audit-design.md`.

**Architecture:** New report-only audit script (sibling to `scripts/claude-md-audit.mjs`) with injected `gitLog`/`readdir`/`now` dependencies for testability. `run-assessment.mjs` invokes the audit and prints its block after the CLAUDE.md health section. No scoring changes, no dashboard changes, no auto-mutations.

**Tech Stack:** Node ESM, vitest, `git log` via `child_process.execFileSync` (no shell — args passed as an array).

---

## File Structure

| File                                             | Purpose                                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Create: `scripts/plans-audit.mjs`                | The audit module — `auditPlans()` + `formatAuditReport()` + a real-git default `gitLog` |
| Create: `scripts/__tests__/plans-audit.test.mjs` | Six vitest tests, all using stubbed `gitLog`/`readdir`/`now`                            |
| Modify: `scripts/run-assessment.mjs`             | Import + invoke audit, append its formatted block to the printed report                 |

We're on branch `feat/plans-audit` (created earlier in the brainstorming phase, with the spec already committed as `1e17baf`). All implementation commits land on this branch; the PR squash-merges to `main` from the main checkout.

---

## Task 1: Open CCE ticket + preflight

**Files:** None (external Jira create + repo state check)

**Preconditions:**

- Branch is `feat/plans-audit` at HEAD `1e17baf` (the spec commit)
- Working tree clean (apart from regenerated `next-env.d.ts` which is now ignored)
- The Atlassian MCP server is authenticated
- User provides explicit per-action authorization for the `createJiraIssue` call (per CLAUDE.md `## Issue tracking`)

- [ ] **Step 1: Verify preflight**

Run:

```bash
git branch --show-current
git log --oneline -1
git status --short
```

Expected:

- Current branch: `feat/plans-audit`
- HEAD: `1e17baf docs(spec): plans audit + archived/ convention`
- Working tree: clean (or only `?? next-env.d.ts`)

- [ ] **Step 2: Request user authorization**

Per CLAUDE.md `## Issue tracking`: each Jira write needs explicit per-action authorization. Ask the user verbatim: _"Authorize creation of the CCE ticket for plans-audit?"_

Wait for an affirmative text response. Do NOT issue the `createJiraIssue` call until the user replies with explicit authorization.

- [ ] **Step 3: Find the next CCE-N number**

Run:

```
mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql
  cloudId: f375676f-949f-4187-8adf-c9e6bbdb8458
  jql: "project = CCE ORDER BY key DESC"
  fields: ["summary"]
```

The highest key returned + 1 is the next available number. As of the spec write, CCE-13 was the latest; the next is **CCE-14** (verify, since other CCE work may have shipped between spec write and execution).

- [ ] **Step 4: Create the ticket**

Run:

```
mcp__plugin_atlassian_atlassian__createJiraIssue
  cloudId: f375676f-949f-4187-8adf-c9e6bbdb8458
  projectKey: CCE
  summary: "Plans audit + archived/ convention"
  issueTypeName: "Task"
  description: <see body below>
```

Description body (use markdown content format):

```markdown
## Goal

Surface "landed plans not yet archived" in the daily `npm run assess` console output. Establish `docs/superpowers/plans/archived/` as the destination convention.

## Architecture

New report-only `scripts/plans-audit.mjs` (sibling to `scripts/claude-md-audit.mjs`). Injected `gitLog`/`readdir`/`now` dependencies for testable detection. Wired into `scripts/run-assessment.mjs` after the CLAUDE.md health block.

## Scope

- 6 new tests (520 → 526 baseline)
- 1 new script, 1 wire-up to run-assessment.mjs
- No scoring changes, no dashboard, no Slack, no auto-mutations

## References

- Spec: `docs/superpowers/specs/2026-05-21-plans-audit-design.md`
- Brainstorm trail in commit `1e17baf`
- Branch: `feat/plans-audit`
```

Capture the assigned key (e.g., `CCE-14`). Refer to it as `$CCE` in subsequent steps.

- [ ] **Step 5: Transition to In Progress**

Request user authorization (per-action), then:

```
mcp__plugin_atlassian_atlassian__getTransitionsForJiraIssue
  cloudId: f375676f-949f-4187-8adf-c9e6bbdb8458
  issueIdOrKey: $CCE
```

Find the transition with `name: "In Progress"` (likely id `31` based on prior CCE workflow), then:

```
mcp__plugin_atlassian_atlassian__transitionJiraIssue
  cloudId: f375676f-949f-4187-8adf-c9e6bbdb8458
  issueIdOrKey: $CCE
  transition: {"id": "31"}
```

- [ ] **Step 6: No commit** — Jira state only.

---

## Task 2: Tests 1+2 (empty + no-git-history) and minimal stub

**Files:**

- Create: `scripts/__tests__/plans-audit.test.mjs`
- Create: `scripts/plans-audit.mjs`

- [ ] **Step 1: Write the test file with first two cases**

Create `scripts/__tests__/plans-audit.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { auditPlans, formatAuditReport } from "../plans-audit.mjs";

const NOW = new Date("2026-05-21T07:15:00.000Z");
const SECONDS_PER_DAY = 24 * 60 * 60;
const tsDaysAgo = (n) => Math.floor(NOW.getTime() / 1000) - n * SECONDS_PER_DAY;

describe("plans-audit", () => {
  it("reports nothing-to-archive on empty plans dir", async () => {
    const audit = await auditPlans({
      plansDir: "/fake/plans",
      readdir: async () => [],
      gitLog: async () => [],
      now: () => NOW,
    });
    expect(audit.count).toBe(0);
    expect(audit.items).toEqual([]);
    expect(formatAuditReport(audit)).toBe("Plans audit: nothing to archive.");
  });

  it("excludes plans with no git history (in-progress drafts)", async () => {
    const audit = await auditPlans({
      plansDir: "/fake/plans",
      readdir: async () => ["draft.md"],
      gitLog: async () => [],
      now: () => NOW,
    });
    expect(audit.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run scripts/__tests__/plans-audit.test.mjs`

Expected: FAIL — `Cannot find module '../plans-audit.mjs'` (or similar import error).

- [ ] **Step 3: Create the minimal implementation**

Create `scripts/plans-audit.mjs`. Note: the real-git `gitLog` uses `execFileSync` (not `execSync`) — args are passed as an array, no shell interpolation, so path values cannot escape into the shell:

```js
// Deterministic plans-directory auditor. Pure: (deps) -> { count, items }.
// Report-only: never moves files. Designed to run headless from the morning
// launchd routine alongside scripts/claude-md-audit.mjs.

import { readdir as fsReaddir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function realGitLog({ path }) {
  try {
    const out = execFileSync(
      "git",
      ["log", "main", "--format=%H %ct %s", "--", path],
      { cwd: ROOT, encoding: "utf-8" },
    );
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const idx1 = line.indexOf(" ");
        const idx2 = line.indexOf(" ", idx1 + 1);
        return {
          sha: line.slice(0, idx1),
          ts: Number(line.slice(idx1 + 1, idx2)),
          subject: line.slice(idx2 + 1),
        };
      });
  } catch {
    return [];
  }
}

const defaults = {
  plansDir: join(ROOT, "docs/superpowers/plans"),
  gitLog: realGitLog,
  readdir: fsReaddir,
  now: () => new Date(),
};

export async function auditPlans(deps = {}) {
  const { plansDir, gitLog, readdir, now } = { ...defaults, ...deps };

  let entries;
  try {
    entries = await readdir(plansDir);
  } catch {
    return { count: 0, items: [] };
  }

  const items = [];
  const nowMs = now().getTime();

  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const relPath = `docs/superpowers/plans/${name}`;
    const log = await gitLog({ path: relPath });
    if (log.length === 0) continue;

    // git log default order is reverse-chronological (newest first):
    //   log[0]              -> most recent commit (used for PR-number extraction)
    //   log[log.length - 1] -> oldest commit (used for first-appearance + age)
    const firstCommit = log[log.length - 1];
    const latestCommit = log[0];

    const prMatch = latestCommit.subject.match(/\(#(\d+)\)/);
    const prOrSha = prMatch ? `#${prMatch[1]}` : firstCommit.sha.slice(0, 7);

    const ageDays = Math.floor(
      (nowMs - firstCommit.ts * 1000) / (1000 * 60 * 60 * 24),
    );
    const ageLabel =
      ageDays === 0
        ? "today"
        : ageDays === 1
          ? "1 day ago"
          : `${ageDays} days ago`;

    items.push({ filename: name, prOrSha, ageDays, ageLabel });
  }

  items.sort((a, b) => b.ageDays - a.ageDays);
  return { count: items.length, items };
}

export function formatAuditReport(audit) {
  if (audit.count === 0) return "Plans audit: nothing to archive.";
  const lines = [
    "Plans audit (report-only):",
    `  Landed plans not yet archived: ${audit.count}`,
  ];
  const longestName = Math.max(...audit.items.map((i) => i.filename.length));
  for (const i of audit.items) {
    lines.push(
      `    ${i.filename.padEnd(longestName)}  ${i.prOrSha.padStart(6)}  ${i.ageLabel}`,
    );
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/__tests__/plans-audit.test.mjs`

Expected: PASS — 2/2.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npx vitest run`

Expected: 522 passed (520 + 2 new).

- [ ] **Step 6: Commit**

```bash
git add scripts/plans-audit.mjs scripts/__tests__/plans-audit.test.mjs
git commit -m "$(cat <<'EOF'
feat(plans-audit): seed auditPlans with empty + no-history cases

Initial scaffold for scripts/plans-audit.mjs with two failing-test-driven
cases:
  1. Empty plans directory  -> empty report
  2. File with no git history -> excluded (in-progress draft)

Real-git adapter uses execFileSync (args-as-array, no shell) to avoid
command-injection surface even though the path values are repo-internal.

Companion test file with NOW fixture + tsDaysAgo helper. Subsequent
commits will extend with: PR-tagged subject, archived/ skip, direct-
to-main short-SHA fallback, multi-plan sort order, and the wire-up
to run-assessment.mjs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Test 3 (PR-tagged squash subject) — verify existing impl handles it

**Files:**

- Modify: `scripts/__tests__/plans-audit.test.mjs` (append one test)

The minimal implementation already handles PR-tagged commits. This task asserts that empirically.

- [ ] **Step 1: Add the test**

Append to the `describe("plans-audit", () => { ... })` block, **inside the closing brace** (before the `});` at the end), the following test:

```js
it("includes a landed plan with PR-tagged squash subject", async () => {
  const audit = await auditPlans({
    plansDir: "/fake/plans",
    readdir: async () => ["2026-05-19-feature.md"],
    gitLog: async () => [
      {
        sha: "abc1234567890abcdef",
        ts: tsDaysAgo(2),
        subject: "feat: new thing (#42)",
      },
    ],
    now: () => NOW,
  });
  expect(audit.count).toBe(1);
  expect(audit.items[0]).toMatchObject({
    filename: "2026-05-19-feature.md",
    prOrSha: "#42",
    ageDays: 2,
    ageLabel: "2 days ago",
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run scripts/__tests__/plans-audit.test.mjs`

Expected: PASS — 3/3 (the implementation from Task 2 already covers this case).

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/plans-audit.test.mjs
git commit -m "$(cat <<'EOF'
test(plans-audit): cover PR-tagged squash subject case

Asserts that a landed plan whose latest commit subject ends in (#42)
produces prOrSha "#42" and the correct age label ("2 days ago").

This test passes against the Task 2 implementation — logging it as
a separate commit makes the TDD discipline explicit (one assertion
per commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Test 4 (archived/ skip)

**Files:**

- Modify: `scripts/__tests__/plans-audit.test.mjs`

- [ ] **Step 1: Add the test**

Append inside the `describe` block:

```js
it("skips directory entries (e.g., archived/ subdir is not recursed)", async () => {
  const audit = await auditPlans({
    plansDir: "/fake/plans",
    readdir: async () => ["archived", "live.md"],
    gitLog: async () => [
      {
        sha: "deadbeefdeadbeef",
        ts: tsDaysAgo(3),
        subject: "live plan (#1)",
      },
    ],
    now: () => NOW,
  });
  expect(audit.count).toBe(1);
  expect(audit.items[0].filename).toBe("live.md");
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run scripts/__tests__/plans-audit.test.mjs`

Expected: PASS — 4/4 (the implementation filters by `.endsWith(".md")`, so `archived` is naturally excluded).

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/plans-audit.test.mjs
git commit -m "$(cat <<'EOF'
test(plans-audit): verify archived/ subdir entries are not recursed

The implementation uses readdir non-recursively and filters by
.endsWith(".md"); a directory named "archived" is naturally excluded.
This test pins that behavior so a future refactor to recursive
listing would be caught.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Test 5 (direct-to-main short-SHA fallback)

**Files:**

- Modify: `scripts/__tests__/plans-audit.test.mjs`

- [ ] **Step 1: Add the test**

Append inside the `describe` block:

```js
it("falls back to short SHA when subject lacks (#NN)", async () => {
  const audit = await auditPlans({
    plansDir: "/fake/plans",
    readdir: async () => ["direct.md"],
    gitLog: async () => [
      {
        sha: "9cc07c5f1234567890",
        ts: tsDaysAgo(11),
        subject: "direct-to-main commit no PR",
      },
    ],
    now: () => NOW,
  });
  expect(audit.items[0].prOrSha).toBe("9cc07c5");
  expect(audit.items[0].ageLabel).toBe("11 days ago");
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run scripts/__tests__/plans-audit.test.mjs`

Expected: PASS — 5/5 (the regex match yields null when no `(#NN)` is present, and the fallback `firstCommit.sha.slice(0, 7)` produces `"9cc07c5"`).

- [ ] **Step 3: Commit**

```bash
git add scripts/__tests__/plans-audit.test.mjs
git commit -m "$(cat <<'EOF'
test(plans-audit): short-SHA fallback for direct-to-main commits

When a plan's latest commit subject lacks a (#NN) suffix (e.g., a
direct-to-main commit), prOrSha falls back to the first 7 characters
of the first-appearance SHA. Verified via a "9cc07c5" example.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Test 6 (multi-plan sort order)

**Files:**

- Modify: `scripts/__tests__/plans-audit.test.mjs`

- [ ] **Step 1: Add the test**

Append inside the `describe` block:

```js
it("sorts oldest first across multiple plans", async () => {
  const audit = await auditPlans({
    plansDir: "/fake/plans",
    readdir: async () => ["one.md", "two.md", "three.md"],
    gitLog: async ({ path }) => {
      if (path.endsWith("one.md"))
        return [{ sha: "a1", ts: tsDaysAgo(5), subject: "x (#1)" }];
      if (path.endsWith("two.md"))
        return [{ sha: "b2", ts: tsDaysAgo(10), subject: "y (#2)" }];
      if (path.endsWith("three.md"))
        return [{ sha: "c3", ts: tsDaysAgo(1), subject: "z (#3)" }];
      return [];
    },
    now: () => NOW,
  });
  expect(audit.items.map((i) => i.filename)).toEqual([
    "two.md",
    "one.md",
    "three.md",
  ]);
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run scripts/__tests__/plans-audit.test.mjs`

Expected: PASS — 6/6 (`items.sort((a, b) => b.ageDays - a.ageDays)` in the implementation handles this).

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`

Expected: **526 passed** (520 + 6 new).

- [ ] **Step 4: Commit**

```bash
git add scripts/__tests__/plans-audit.test.mjs
git commit -m "$(cat <<'EOF'
test(plans-audit): sort oldest first across multiple plans

Three plans at ages 5d / 10d / 1d must appear in the order
[10d, 5d, 1d]. Pins items.sort((a, b) => b.ageDays - a.ageDays).

This closes the 6-test matrix from the spec. Total test count:
526 (was 520 pre-feature).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire into run-assessment.mjs

**Files:**

- Modify: `scripts/run-assessment.mjs`

Three small edits in one commit: import the audit, invoke it, print the formatted block.

- [ ] **Step 1: Add the import**

Edit `scripts/run-assessment.mjs`. The CLAUDE.md audit import block ends with `} from "./claude-md-audit.mjs";` (approximately line 26). Add a new import immediately after:

```
old_string:
} from "./claude-md-audit.mjs";

new_string:
} from "./claude-md-audit.mjs";
import { auditPlans, formatAuditReport } from "./plans-audit.mjs";
```

- [ ] **Step 2: Invoke the audit**

Find this line in `scripts/run-assessment.mjs`:

```
  const claudeMdRuns = cmTargets.length ? await auditAll(cmTargets) : [];
```

(Approximately line 278.) Replace it with the two-line pair:

```
old_string:
  const claudeMdRuns = cmTargets.length ? await auditAll(cmTargets) : [];

new_string:
  const claudeMdRuns = cmTargets.length ? await auditAll(cmTargets) : [];
  const plansAudit = await auditPlans();
```

- [ ] **Step 3: Print the audit block before the final console.log**

The end of the `--print` branch looks like:

```js
    }
    console.log(lines.join("\n"));
  }
```

That closing `}` belongs to the `if (claudeMdRuns.length)` block, and the next line is the unconditional `console.log`. Add the plans audit push between them:

```
old_string:
    }
    console.log(lines.join("\n"));
  }

new_string:
    }
    lines.push("", formatAuditReport(plansAudit));
    console.log(lines.join("\n"));
  }
```

This pattern (closing `}` + `console.log(lines.join("\n"));` + closing `}`) appears once in the file. If the Edit tool reports ambiguity, Read the file around line 400-410 and disambiguate by adding 2-3 surrounding lines to the `old_string`.

- [ ] **Step 4: Smoke test**

Run: `npm run assess`

Expected: standard scoring output, followed by `CLAUDE.md health (report-only):` block (if a target is configured), followed by a `Plans audit (report-only):` block. The plans audit lists ~19 landed plans (the exact count depends on what's on `main` at execution time). Empty-state output is "Plans audit: nothing to archive."

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`

Expected: 526 passed.

- [ ] **Step 6: Run tsc**

Run: `npx tsc --noEmit`

Expected: exit 0 (`.mjs` files are not processed by tsc with the current config).

- [ ] **Step 7: Commit**

```bash
git add scripts/run-assessment.mjs
git commit -m "$(cat <<'EOF'
feat(run-assessment): print plans audit after CLAUDE.md health block

Wires scripts/plans-audit.mjs into the daily console report. The
new block appears after the CLAUDE.md health section in --print mode
and in the default run-assessment.mjs output path.

The audit runs unconditionally (no config flag); empty-state output
("Plans audit: nothing to archive.") is harmless when there's
nothing to surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Push, open PR

**Files:** None (git/gh state only)

- [ ] **Step 1: Verify branch state**

Run:

```bash
git log --oneline main..HEAD
git status --short
```

Expected: 7 commits on the branch (the spec commit `1e17baf` + 6 commits from Tasks 2–7). Working tree clean.

- [ ] **Step 2: Push the branch**

Run: `git push -u origin feat/plans-audit`

Expected: `* [new branch] feat/plans-audit -> feat/plans-audit` + tracking ref message.

- [ ] **Step 3: Open the PR**

Substitute `$CCE` with the actual ticket key captured in Task 1 Step 4.

```bash
gh pr create --base main --title "feat(plans): daily archive-candidate audit — $CCE" --body "$(cat <<'EOF'
## Summary

Adds a report-only daily audit that surfaces "landed plans not yet archived" — companion to \`scripts/claude-md-audit.mjs\`. Establishes \`docs/superpowers/plans/archived/\` as the destination convention (user moves files there manually via docs PRs).

## Spec

\`docs/superpowers/specs/2026-05-21-plans-audit-design.md\` (landed in commit \`1e17baf\` on this branch).

## What's in this PR

- **New:** \`scripts/plans-audit.mjs\` (~70 lines) with \`auditPlans()\` + \`formatAuditReport()\` and a real-git default \`gitLog\` adapter (uses \`execFileSync\`, no shell)
- **New:** \`scripts/__tests__/plans-audit.test.mjs\` with 6 tests (520 → 526 baseline)
- **Modified:** \`scripts/run-assessment.mjs\` — import + invoke + print after CLAUDE.md health block (3-line change)

## What's NOT in this PR (per spec out-of-scope)

- Specs/ directory coverage
- Dashboard surface
- Auto-move / auto-PR
- Age threshold flag
- Slack inclusion
- Plan-doc metadata frontmatter
- Stale-but-not-landed detection
- Multi-PR plan handling

## Test plan

- [x] \`npx vitest run\` shows 526 passed
- [x] \`npx tsc --noEmit\` clean
- [x] \`npm run assess\` prints the new block locally
- [x] Empty-state path covered by test 1 (no real plans dir needed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: a URL like `https://github.com/theoju/claude-code-self-assessment/pull/NN`. Capture this as `$PR`.

- [ ] **Step 4: Post Jira comment with PR link**

Request user authorization (per-action). Then:

```
mcp__plugin_atlassian_atlassian__addCommentToJiraIssue
  cloudId: f375676f-949f-4187-8adf-c9e6bbdb8458
  issueIdOrKey: $CCE
  contentFormat: markdown
  commentBody: |
    PR open for review: <PR_URL>

    Branch: `feat/plans-audit`
    Verification: 526/526 vitest pass, tsc --noEmit clean.
    Out of scope items documented in PR description.
```

(Substitute `<PR_URL>` with the URL captured in Step 3.)

---

## Task 9: (User-executed) merge + post-merge cleanup

**Files:** None (external merge action)

This task halts pending user input. Steps below describe what the user does and what verification happens after.

- [ ] **Step 1: User merges the PR from the main checkout**

User runs (from `/Users/theo/Projects/claude-extensions`):

```
gh pr merge $PR --squash --delete-branch
```

(Per CLAUDE.md `## Conventions` worktree-merge gotcha — must run from the main checkout, not from any worktree.)

- [ ] **Step 2: Verify the merge**

Run:

```bash
gh pr view $PR --json state,mergeCommit
```

Expected: `state: MERGED`; capture the squash SHA from `mergeCommit.oid`.

- [ ] **Step 3: Update local main**

Run:

```bash
git checkout main
git fetch --prune
git merge --ff-only origin/main
git log --oneline -1
```

Expected: HEAD is the new squash commit; commit subject matches the PR title.

- [ ] **Step 4: Transition $CCE to Done**

Request user authorization (per-action). Then:

```
mcp__plugin_atlassian_atlassian__transitionJiraIssue
  cloudId: f375676f-949f-4187-8adf-c9e6bbdb8458
  issueIdOrKey: $CCE
  transition: {"id": "41"}
```

(Transition id `41` = Done per the CCE workflow.)

- [ ] **Step 5: Manual smoke**

Run: `npm run assess` from the freshly-merged main.

Expected: a `Plans audit (report-only):` block appears in the output, listing landed plans not yet in `archived/`.

---

## Self-review

1. **Spec coverage:**
   - Architecture / file structure → Tasks 2 (script), 2 (test file), 7 (wire-up)
   - Detection logic → Task 2 (initial) + tests in 3, 4, 5, 6 pin behavior
   - Output format → Task 2 (`formatAuditReport`) + tests across the matrix
   - Function signature with injected deps → Task 2 Step 3 verbatim
   - 6-test matrix → Tasks 2 (×2), 3, 4, 5, 6 (×1 each)
   - CLI-only output → Task 7 wires into `lines.push`, no Slack/dashboard touched
   - `archived/` convention → Task 4 test pins behavior; no script-side creation
   - Out-of-scope list → respected; no tasks for specs, dashboard, auto-move, Slack
   - CCE-N ticket → Tasks 1, 8 (comment), 9 (transition)
   - Worktree-merge gotcha → Task 9 Step 1 references CLAUDE.md rule

2. **Placeholder scan:** No TBDs. `$CCE` and `$PR` are explicit substitution markers with the capturing step labeled. All code blocks are complete. All commit messages are quoted verbatim.

3. **Type/function consistency:**
   - `auditPlans({ plansDir, gitLog, readdir, now })` — same shape in Task 2, 3, 4, 5, 6
   - `formatAuditReport(audit)` — defined Task 2, called Task 7
   - Property names `count`, `items`, `filename`, `prOrSha`, `ageDays`, `ageLabel` — consistent throughout
   - Sort direction (`b.ageDays - a.ageDays` → oldest first) — declared Task 2, asserted Task 6
   - Test fixture (`NOW`, `tsDaysAgo`) — defined Task 2, reused in 3, 5, 6

4. **Risk check:**
   - Task 1 risk: classifier blocks on `createJiraIssue`. Mitigation: explicit user-auth ask at Step 2.
   - Task 2 risk: shell-injection surface on git path arg. Mitigation: `execFileSync` with args array, no shell interpolation.
   - Task 7 risk: `old_string` ambiguity in `run-assessment.mjs`. Mitigation: Step 3 instructions explicitly say "Read the file first and disambiguate" if the pattern matches multiple regions.
   - Task 9 risk: user runs merge from a worktree instead of the main checkout. Mitigation: explicit reference to CLAUDE.md gotcha.

---

## Success criteria

The plan succeeds when:

1. `scripts/plans-audit.mjs` exists with `auditPlans` + `formatAuditReport` exports.
2. `scripts/__tests__/plans-audit.test.mjs` contains 6 tests, all passing.
3. `npx vitest run` reports **526 passed**.
4. `npx tsc --noEmit` exits 0.
5. `npm run assess` prints a "Plans audit" block matching one of the three formats from the spec (populated / empty / direct-to-main fallback).
6. PR squash-merged on `main`; remote/local cleanup complete; $CCE transitioned to Done.
7. The `archived/` directory does NOT exist after the PR — the spec explicitly says the audit doesn't auto-create it; user moves the first plan there in a separate PR.
