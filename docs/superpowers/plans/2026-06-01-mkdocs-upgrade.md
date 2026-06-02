# MkDocs Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `theoju/claude-code-self-assessment` engineering-docs-agent integration from `framework: none` to `framework: mkdocs`, scaffold a Material-theme mkdocs site at `https://theoju.github.io/claude-code-self-assessment/`, add a GitHub Pages publish workflow, and migrate existing docs verbatim with no rotted path references anywhere in the source tree.

**Architecture:** Two independent workflows — the existing `docs-agent-nightly.yml` (Claude orchestrator, opens PRs) and a new `docs-agent-pages.yml` (mkdocs build → upload → deploy-pages). Dependency order matters: scaffold must exist locally and pass `mkdocs build --strict` before the config gets flipped to `framework: mkdocs`, because the flip activates the publish-verifier stage of the nightly. Test-first: three vitest files assert the new scaffold exists, no stale path references remain anywhere, and config.yml matches the mkdocs contract.

**Tech Stack:** MkDocs 1.6.1 + Material theme 9.5.49, `awesome-pages` + `literate-nav` plugins, `pymdown-extensions` for mermaid + admonitions, GitHub Pages deploy via `actions/configure-pages@v6` + `actions/upload-pages-artifact@v5` + `actions/deploy-pages@v5`, validation via existing Vitest suite.

**Spec:** `docs/superpowers/specs/2026-06-01-mkdocs-upgrade-design.md`

**Ticket:** CCE-XX — resolve to real key before opening PR (search existing CCE backlog first; likely a new ticket).

---

## File Structure

### New files (6)

| Path                                     | Purpose                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| `mkdocs.yml`                             | Site config (Material theme, plugins, markdown extensions) |
| `requirements-docs.txt`                  | Pinned Python deps for mkdocs build                        |
| `.github/workflows/docs-agent-pages.yml` | GitHub Pages build + deploy workflow                       |
| `docs/site-src/index.md`                 | Site landing page (hand-authored, one-time)                |
| `docs/site-src/SUMMARY.md`               | Literate-nav ordering                                      |
| `docs/site-src/whats-new.md`             | Stub the agent populates over time                         |

### New test files (3)

| Path                                              | Purpose                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `scripts/__tests__/docs-mkdocs-scaffold.test.mjs` | Asserts scaffold files exist with correct content                                                                   |
| `scripts/__tests__/docs-path-migration.test.mjs`  | Asserts no stale `docs/(ship-pattern\|self-assessment\|boris-tips\|tip-classification\|images)` refs in source tree |
| `scripts/__tests__/docs-config-mkdocs.test.mjs`   | Asserts `.engineering-docs-agent/config.yml` flipped to mkdocs contract                                             |

### Modified files (6)

| Path                                 | Change                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `.engineering-docs-agent/config.yml` | 5 field flips (framework, whats_new_file, lens_paths.core, base_url, build_workflow) + comment rewrite |
| `.gitignore`                         | Append `/site/`                                                                                        |
| `README.md`                          | 3 path refs updated (line 9 image, line 133 self-assessment, line 145 ship-pattern)                    |
| `CLAUDE.md`                          | 2 path refs updated (line 272 docs/images/, line 439 docs/ship-pattern.md)                             |
| `app/data/rubric.json`               | 1 path ref updated (line ~21, ship-pattern.md reference)                                               |
| `app/docs/ship-pattern/page.tsx`     | 2 spots updated (runtime path line 14 + display string line 33)                                        |

### File moves (5, via `git mv`)

- `docs/boris-tips-reference-2026-05-10.md` → `docs/site-src/boris-tips-reference-2026-05-10.md`
- `docs/self-assessment.md` → `docs/site-src/self-assessment.md`
- `docs/ship-pattern.md` → `docs/site-src/ship-pattern.md`
- `docs/tip-classification-2026-05-10.md` → `docs/site-src/tip-classification-2026-05-10.md`
- `docs/images/` → `docs/site-src/images/` (recursive)

### Left in place (NOT moved)

- `docs/superpowers/specs/` — design history, stays out of the published site
- `docs/superpowers/plans/` — plan history, stays out of the published site

---

## Phase 1 — Test infrastructure (TDD red phase)

Three tests get written first. All three will FAIL until implementation tasks land. This is the TDD discipline: red → green → commit.

### Task 1: Path-migration scan test (TDD red)

**Files:**

- Create: `scripts/__tests__/docs-path-migration.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/scripts/__tests__/docs-path-migration.test.mjs`:

```javascript
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

// Source files that may have referenced the moved docs paths.
// We scan tracked files only (ignores node_modules, .next, etc.).
function trackedFiles() {
  return execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

// After the migration, NO file should reference docs/<moved>.md or docs/images/
// EXCEPT:
//   - the moved files themselves (now under docs/site-src/)
//   - docs/superpowers/{specs,plans}/ historical documents (frozen-in-time)
//   - this test file (which contains the search patterns)
//   - the spec/plan that describe the migration itself
const ALLOW = [
  /^docs\/site-src\//,
  /^docs\/superpowers\/specs\//,
  /^docs\/superpowers\/plans\//,
  /^scripts\/__tests__\/docs-path-migration\.test\.mjs$/,
];

const STALE_PATTERNS = [
  /\bdocs\/ship-pattern\.md\b/,
  /\bdocs\/self-assessment\.md\b/,
  /\bdocs\/boris-tips-reference-2026-05-10\.md\b/,
  /\bdocs\/tip-classification-2026-05-10\.md\b/,
  /\bdocs\/images\//,
];

describe("docs path migration — no stale references", () => {
  it("no tracked file outside the allow-list references moved docs paths", () => {
    const offenders = [];
    for (const file of trackedFiles()) {
      if (ALLOW.some((re) => re.test(file))) continue;
      let body;
      try {
        body = readFileSync(join(REPO_ROOT, file), "utf8");
      } catch {
        continue;
      }
      for (const pat of STALE_PATTERNS) {
        if (pat.test(body)) {
          offenders.push(`${file}: matched ${pat}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run scripts/__tests__/docs-path-migration.test.mjs
```

Expected: FAIL — many offenders listed (`README.md`, `CLAUDE.md`, `app/data/rubric.json`, `app/docs/ship-pattern/page.tsx` at minimum).

- [ ] **Step 3: Commit the red test**

```bash
git add scripts/__tests__/docs-path-migration.test.mjs
git commit -m "test(docs): add path-migration scan (red) — CCE-XX

Asserts no tracked file outside the allow-list references the
moved docs paths. Will fail until Tasks 9-14 land path updates."
```

---

### Task 2: Scaffold-file existence test (TDD red)

**Files:**

- Create: `scripts/__tests__/docs-mkdocs-scaffold.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/scripts/__tests__/docs-mkdocs-scaffold.test.mjs`:

```javascript
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

describe("mkdocs scaffold — files exist", () => {
  it("mkdocs.yml exists with required keys", () => {
    const p = join(REPO_ROOT, "mkdocs.yml");
    expect(existsSync(p)).toBe(true);
    const body = readFileSync(p, "utf8");
    expect(body).toMatch(/^site_name:\s*Claude Code Self-Assessment$/m);
    expect(body).toMatch(
      /^site_url:\s*https:\/\/theoju\.github\.io\/claude-code-self-assessment\/$/m,
    );
    expect(body).toMatch(/^docs_dir:\s*docs\/site-src$/m);
    expect(body).toMatch(/^site_dir:\s*site$/m);
    expect(body).toMatch(/name:\s*material/);
    expect(body).toMatch(/awesome-pages/);
    expect(body).toMatch(/literate-nav/);
    // Negative: must NOT pull in Python-only plugins
    expect(body).not.toMatch(/mkdocstrings/);
    expect(body).not.toMatch(/gen-files/);
  });

  it("requirements-docs.txt pins mkdocs and material", () => {
    const p = join(REPO_ROOT, "requirements-docs.txt");
    expect(existsSync(p)).toBe(true);
    const body = readFileSync(p, "utf8");
    expect(body).toMatch(/^mkdocs==1\.6\.1$/m);
    expect(body).toMatch(/^mkdocs-material==9\.5\.49$/m);
    expect(body).toMatch(/^mkdocs-awesome-pages-plugin==/m);
    expect(body).toMatch(/^mkdocs-literate-nav==/m);
    expect(body).toMatch(/^pymdown-extensions==/m);
    expect(body).not.toMatch(/playwright/);
    expect(body).not.toMatch(/mkdocstrings/);
  });

  it("docs/site-src/ scaffold files exist", () => {
    const dir = join(REPO_ROOT, "docs", "site-src");
    expect(existsSync(join(dir, "index.md"))).toBe(true);
    expect(existsSync(join(dir, "SUMMARY.md"))).toBe(true);
    expect(existsSync(join(dir, "whats-new.md"))).toBe(true);
  });

  it("SUMMARY.md lists migrated pages in editorial order", () => {
    const body = readFileSync(
      join(REPO_ROOT, "docs", "site-src", "SUMMARY.md"),
      "utf8",
    );
    const order = [
      "index.md",
      "self-assessment.md",
      "ship-pattern.md",
      "boris-tips-reference-2026-05-10.md",
      "tip-classification-2026-05-10.md",
      "whats-new.md",
    ];
    let lastIdx = -1;
    for (const name of order) {
      const idx = body.indexOf(name);
      expect(idx, `${name} missing from SUMMARY.md`).toBeGreaterThan(-1);
      expect(idx, `${name} out of order in SUMMARY.md`).toBeGreaterThan(
        lastIdx,
      );
      lastIdx = idx;
    }
  });

  it("docs-agent-pages.yml workflow exists with required steps", () => {
    const p = join(REPO_ROOT, ".github", "workflows", "docs-agent-pages.yml");
    expect(existsSync(p)).toBe(true);
    const body = readFileSync(p, "utf8");
    expect(body).toMatch(/^name:\s*docs-agent-pages$/m);
    expect(body).toMatch(/actions\/configure-pages@v6/);
    expect(body).toMatch(/enablement:\s*true/);
    expect(body).toMatch(/actions\/upload-pages-artifact@v5/);
    expect(body).toMatch(/actions\/deploy-pages@v5/);
    expect(body).toMatch(/mkdocs build --strict/);
    expect(body).toMatch(/pages:\s*write/);
    expect(body).toMatch(/id-token:\s*write/);
    expect(body).toMatch(/group:\s*pages/);
  });

  it("migrated docs files live under docs/site-src/", () => {
    const dir = join(REPO_ROOT, "docs", "site-src");
    expect(existsSync(join(dir, "self-assessment.md"))).toBe(true);
    expect(existsSync(join(dir, "ship-pattern.md"))).toBe(true);
    expect(existsSync(join(dir, "boris-tips-reference-2026-05-10.md"))).toBe(
      true,
    );
    expect(existsSync(join(dir, "tip-classification-2026-05-10.md"))).toBe(
      true,
    );
    expect(
      existsSync(join(dir, "images", "self-assessment-dashboard.png")),
    ).toBe(true);
  });

  it("originals no longer exist at the old docs/ root", () => {
    const dir = join(REPO_ROOT, "docs");
    expect(existsSync(join(dir, "self-assessment.md"))).toBe(false);
    expect(existsSync(join(dir, "ship-pattern.md"))).toBe(false);
    expect(existsSync(join(dir, "boris-tips-reference-2026-05-10.md"))).toBe(
      false,
    );
    expect(existsSync(join(dir, "tip-classification-2026-05-10.md"))).toBe(
      false,
    );
    expect(existsSync(join(dir, "images"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run scripts/__tests__/docs-mkdocs-scaffold.test.mjs
```

Expected: FAIL — all 7 cases fail (no scaffold files exist yet).

- [ ] **Step 3: Commit the red test**

```bash
git add scripts/__tests__/docs-mkdocs-scaffold.test.mjs
git commit -m "test(docs): add mkdocs scaffold existence checks (red) — CCE-XX

Asserts mkdocs.yml + requirements-docs.txt + docs/site-src/
stubs + Pages workflow exist with required content. Also
asserts moved files are at the new paths and originals are
gone. Will pass once Tasks 4-10 land scaffold + moves."
```

---

### Task 3: Config-flip test (TDD red)

**Files:**

- Create: `scripts/__tests__/docs-config-mkdocs.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/scripts/__tests__/docs-config-mkdocs.test.mjs`:

```javascript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

// We don't pull in a YAML parser as a new dep just for this test —
// the config is small enough to validate with regex. (Plugin-side
// jsonschema validation runs against the same file in CI on every
// nightly; this test is the local-side fast contract check.)
function readConfig() {
  return readFileSync(
    join(REPO_ROOT, ".engineering-docs-agent", "config.yml"),
    "utf8",
  );
}

describe(".engineering-docs-agent/config.yml — mkdocs contract", () => {
  it("framework is mkdocs", () => {
    expect(readConfig()).toMatch(/^\s*framework:\s*mkdocs\s*$/m);
  });

  it("framework is NOT 'none' (regression guard)", () => {
    expect(readConfig()).not.toMatch(/^\s*framework:\s*none\s*$/m);
  });

  it("whats_new_file points at docs/site-src/whats-new.md", () => {
    expect(readConfig()).toMatch(
      /^\s*whats_new_file:\s*docs\/site-src\/whats-new\.md\s*$/m,
    );
  });

  it("lens_paths.core points at docs/site-src/", () => {
    expect(readConfig()).toMatch(/^\s*core:\s*docs\/site-src\/\s*$/m);
  });

  it("publishing.base_url is the GitHub Pages URL", () => {
    expect(readConfig()).toMatch(
      /^\s*base_url:\s*https:\/\/theoju\.github\.io\/claude-code-self-assessment\/\s*$/m,
    );
  });

  it("publishing.build_workflow is docs-agent-pages.yml", () => {
    expect(readConfig()).toMatch(
      /^\s*build_workflow:\s*docs-agent-pages\.yml\s*$/m,
    );
  });

  it("publishing.base_url is NOT null (regression guard)", () => {
    expect(readConfig()).not.toMatch(/^\s*base_url:\s*null\s*$/m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run scripts/__tests__/docs-config-mkdocs.test.mjs
```

Expected: FAIL — all 7 cases fail (config still has framework=none, base_url=null, etc.).

- [ ] **Step 3: Commit the red test**

```bash
git add scripts/__tests__/docs-config-mkdocs.test.mjs
git commit -m "test(docs): add mkdocs config-flip contract (red) — CCE-XX

Asserts .engineering-docs-agent/config.yml flipped to the
mkdocs contract (framework, whats_new_file, lens_paths.core,
publishing.base_url, publishing.build_workflow). Will pass
once Task 15 lands the flips."
```

---

## Phase 2 — Scaffold creation (TDD green phase, part 1)

### Task 4: Create `mkdocs.yml`

**Files:**

- Create: `mkdocs.yml`

- [ ] **Step 1: Write the file**

Create `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/mkdocs.yml`:

```yaml
site_name: Claude Code Self-Assessment
site_url: https://theoju.github.io/claude-code-self-assessment/
repo_url: https://github.com/theoju/claude-code-self-assessment
docs_dir: docs/site-src
site_dir: site

theme:
  name: material
  features:
    - navigation.tabs
    - navigation.sections
    - navigation.indexes
    - navigation.top
    - toc.follow
    - search.suggest
    - content.code.copy

plugins:
  - search
  - awesome-pages
  - literate-nav:
      nav_file: SUMMARY.md

markdown_extensions:
  - admonition
  - attr_list
  - md_in_html
  - tables
  - toc:
      permalink: true
  - pymdownx.highlight
  - pymdownx.superfences:
      custom_fences:
        - name: mermaid
          class: mermaid
          format: !!python/name:pymdownx.superfences.fence_code_format
  - pymdownx.details
```

- [ ] **Step 2: Run scaffold test to check progress**

```bash
npx vitest run scripts/__tests__/docs-mkdocs-scaffold.test.mjs -t "mkdocs.yml exists"
```

Expected: PASS (1 case). The other scaffold-test cases still fail (other files don't exist yet).

- [ ] **Step 3: Commit**

```bash
git add mkdocs.yml
git commit -m "feat(docs): add mkdocs.yml (Material theme, minimal plugins) — CCE-XX

Dropped mkdocstrings/gen-files (Python-only, useless for TS).
site_url trailing slash kept for canonical link resolution.
pymdownx.superfences enables mermaid fences."
```

---

### Task 5: Create `requirements-docs.txt`

**Files:**

- Create: `requirements-docs.txt`

- [ ] **Step 1: Write the file**

Create `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/requirements-docs.txt`:

```
mkdocs==1.6.1
mkdocs-material==9.5.49
mkdocs-awesome-pages-plugin==2.10.1
mkdocs-literate-nav==0.6.3
pymdown-extensions==10.11.2
```

- [ ] **Step 2: Run scaffold test**

```bash
npx vitest run scripts/__tests__/docs-mkdocs-scaffold.test.mjs -t "requirements-docs.txt"
```

Expected: PASS (1 case).

- [ ] **Step 3: Commit**

```bash
git add requirements-docs.txt
git commit -m "feat(docs): pin mkdocs deps in requirements-docs.txt — CCE-XX

Versions from the engineering-docs-agent dogfood, battle-tested
against mkdocs 1.6.1. No playwright (not needed), no
mkdocstrings (Python-only), no gen-files."
```

---

### Task 6: Create `docs/site-src/index.md` (landing page)

**Files:**

- Create: `docs/site-src/index.md`

- [ ] **Step 1: Write the file**

Create `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/docs/site-src/index.md`:

```markdown
# Claude Code Self-Assessment

A personal dashboard that scores your Claude Code usage against
[Boris Cherny's 87 workflow tips](https://howborisusesclaudecode.com)
and a two-axis Self-Assessment rubric. All scoring is local — no
telemetry, no external service, nothing leaves your machine unless
you enable the Slack notifier.

## Read next

- **[Self-Assessment](self-assessment.md)** — the full scorer guide
  (how the two axes are computed, what each dimension measures, how
  the trend history works).
- **[Ship Pattern](ship-pattern.md)** — the recommended `/ship` slash
  command shape (8-stage personal shipping chain).
- **Reference** — full tip catalog and classification breakdown.
- **[What's New](whats-new.md)** — release notes and recent changes
  (curated by the engineering-docs-agent).

## Project links

- Source: <https://github.com/theoju/claude-code-self-assessment>
- README: <https://github.com/theoju/claude-code-self-assessment/blob/main/README.md>
```

- [ ] **Step 2: Run scaffold test**

```bash
npx vitest run scripts/__tests__/docs-mkdocs-scaffold.test.mjs -t "docs/site-src/ scaffold files exist"
```

Expected: still FAIL (SUMMARY.md and whats-new.md not yet created).

- [ ] **Step 3: Commit**

```bash
git add docs/site-src/index.md
git commit -m "feat(docs): add mkdocs site-src/index.md landing page — CCE-XX"
```

---

### Task 7: Create `docs/site-src/SUMMARY.md` (literate-nav ordering)

**Files:**

- Create: `docs/site-src/SUMMARY.md`

- [ ] **Step 1: Write the file**

Create `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/docs/site-src/SUMMARY.md`:

```markdown
- [Home](index.md)
- [Self-Assessment](self-assessment.md)
- [Ship Pattern](ship-pattern.md)
- Reference
  - [Boris Tips](boris-tips-reference-2026-05-10.md)
  - [Tip Classification](tip-classification-2026-05-10.md)
- [What's New](whats-new.md)
```

- [ ] **Step 2: Run scaffold test**

```bash
npx vitest run scripts/__tests__/docs-mkdocs-scaffold.test.mjs -t "SUMMARY.md lists migrated pages"
```

Expected: PASS (1 case).

- [ ] **Step 3: Commit**

```bash
git add docs/site-src/SUMMARY.md
git commit -m "feat(docs): add SUMMARY.md for literate-nav ordering — CCE-XX"
```

---

### Task 8: Create `docs/site-src/whats-new.md` (agent-populated stub)

**Files:**

- Create: `docs/site-src/whats-new.md`

- [ ] **Step 1: Write the file**

Create `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/docs/site-src/whats-new.md`:

```markdown
# What's New

The engineering-docs-agent appends entries here on each nightly run
when it detects merged work worth surfacing in a user-facing
changelog. Most entries are written by the agent and reviewed via
the `docs-agent/YYYY-MM-DD` PR.

<!-- The first authored entry will land below on the first nightly
     after the mkdocs upgrade ships. -->
```

- [ ] **Step 2: Run scaffold test (full file)**

```bash
npx vitest run scripts/__tests__/docs-mkdocs-scaffold.test.mjs
```

Expected: scaffold-files-exist case now PASSES. Workflow-file case still FAILS (next task). Migrated-files cases still FAIL (Task 9). Originals-gone cases still FAIL (Task 9).

- [ ] **Step 3: Commit**

```bash
git add docs/site-src/whats-new.md
git commit -m "feat(docs): add whats-new.md stub for agent population — CCE-XX

Required because .engineering-docs-agent/config.yml declares
whats_new_file. The agent appends entries on each nightly."
```

---

### Task 9: Create `.github/workflows/docs-agent-pages.yml`

**Files:**

- Create: `.github/workflows/docs-agent-pages.yml`

- [ ] **Step 1: Write the file**

Create `/Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/.github/workflows/docs-agent-pages.yml`:

```yaml
name: docs-agent-pages

# Builds the mkdocs site and deploys to GitHub Pages.
# Fires only when docs sources actually change (path filter below) +
# manual workflow_dispatch. configure-pages@v6 with enablement: true
# enables Pages programmatically on the first run.

on:
  push:
    branches: [main]
    paths:
      - "docs/site-src/**"
      - "mkdocs.yml"
      - "requirements-docs.txt"
      - ".github/workflows/docs-agent-pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/configure-pages@v6
        with:
          enablement: true
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - name: Build site
        run: |
          pip install -r requirements-docs.txt
          mkdocs build --strict
      - name: Write .nojekyll so Pages serves the artifact as-is
        run: touch site/.nojekyll
      - uses: actions/upload-pages-artifact@v5
        with:
          path: site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 2: Run scaffold test**

```bash
npx vitest run scripts/__tests__/docs-mkdocs-scaffold.test.mjs -t "docs-agent-pages.yml"
```

Expected: PASS (1 case).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/docs-agent-pages.yml
git commit -m "feat(ci): add docs-agent-pages workflow for GitHub Pages deploy — CCE-XX

configure-pages@v6 with enablement: true means no manual
Settings UI click on first run. mkdocs build --strict fails on
broken links + missing nav refs. concurrency group pages
serializes deploys."
```

---

## Phase 3 — File moves & path-reference updates (TDD green phase, part 2)

### Task 10: Move docs files via `git mv`

**Files:**

- Move: `docs/boris-tips-reference-2026-05-10.md` → `docs/site-src/boris-tips-reference-2026-05-10.md`
- Move: `docs/self-assessment.md` → `docs/site-src/self-assessment.md`
- Move: `docs/ship-pattern.md` → `docs/site-src/ship-pattern.md`
- Move: `docs/tip-classification-2026-05-10.md` → `docs/site-src/tip-classification-2026-05-10.md`
- Move: `docs/images/` → `docs/site-src/images/`

- [ ] **Step 1: Move all five via git mv**

```bash
cd /Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration
git mv docs/boris-tips-reference-2026-05-10.md docs/site-src/boris-tips-reference-2026-05-10.md
git mv docs/self-assessment.md docs/site-src/self-assessment.md
git mv docs/ship-pattern.md docs/site-src/ship-pattern.md
git mv docs/tip-classification-2026-05-10.md docs/site-src/tip-classification-2026-05-10.md
git mv docs/images docs/site-src/images
```

- [ ] **Step 2: Verify git tracks renames**

```bash
git status --short
```

Expected: five entries each of the shape `R  docs/foo.md -> docs/site-src/foo.md` (or `R100` indicating 100% similarity = pure rename).

- [ ] **Step 3: Run scaffold test**

```bash
npx vitest run scripts/__tests__/docs-mkdocs-scaffold.test.mjs
```

Expected: migrated-files-exist case PASSES; originals-no-longer-exist case PASSES. Full scaffold test now green.

- [ ] **Step 4: Commit the moves**

```bash
git commit -m "refactor(docs): move docs/*.md + images/ into docs/site-src/ — CCE-XX

git mv preserves rename history. docs/superpowers/{specs,plans}/
stay in place (out of the published site)."
```

---

### Task 11: Fix image references in the moved `self-assessment.md`

**Files:**

- Modify: `docs/site-src/self-assessment.md`

The migrated `self-assessment.md` references images via paths that were relative to `docs/` but now need to be relative to `docs/site-src/`. The image now lives at `docs/site-src/images/`, so a relative ref of `images/self-assessment-dashboard.png` works from a file in `docs/site-src/`.

- [ ] **Step 1: Find current image references**

```bash
grep -nE 'images/[a-z0-9-]+\.(png|jpg|svg)' docs/site-src/self-assessment.md
```

If no matches: skip to Step 4 (no image refs to fix). If matches exist with old `../images/` or `docs/images/` form, proceed.

- [ ] **Step 2: Rewrite refs**

Manual targeted Edit per line — if any line contains `docs/images/X.png` or `../images/X.png`, change to `images/X.png` (relative to the file's new location). Use the Edit tool with explicit old/new strings rather than sed to avoid over-matching.

Example Edit invocation pattern (one per ref found in Step 1):

```
Edit tool:
  file_path: /Users/theo/Projects/claude-extensions/.claude/worktrees/engineering-docs-agent-integration/docs/site-src/self-assessment.md
  old_string: ![alt](docs/images/foo.png)
  new_string: ![alt](images/foo.png)
```

- [ ] **Step 3: Verify all image refs now resolve relative to site-src**

```bash
grep -nE 'images/[a-z0-9-]+\.(png|jpg|svg)' docs/site-src/*.md
```

Expected: every match starts with `images/` (no `docs/images/`, no `../images/`).

- [ ] **Step 4: Commit if changed; otherwise skip**

```bash
git add docs/site-src/self-assessment.md
git commit -m "fix(docs): rewrite image refs relative to docs/site-src/ — CCE-XX

mkdocs resolves image links relative to the markdown file. After
the move, refs like docs/images/x.png break under mkdocs build
--strict. Now images/x.png — site-src is the docs_dir root."
```

(If `grep` found no matches in Step 1, skip commit and move to Task 12.)

---

### Task 12: Update path refs in `README.md`

**Files:**

- Modify: `README.md` lines 9, 133, 145

- [ ] **Step 1: Read current state**

```bash
grep -n 'docs/' README.md | head -20
```

Confirm three target refs at lines 9, 133, 145.

- [ ] **Step 2: Update line 9 (image)**

Use Edit:

```
old_string: ](docs/images/self-assessment-dashboard.png)
new_string: ](docs/site-src/images/self-assessment-dashboard.png)
```

- [ ] **Step 3: Update line 133 (self-assessment.md)**

Use Edit:

```
old_string: [`docs/self-assessment.md`](docs/self-assessment.md)
new_string: [`docs/site-src/self-assessment.md`](docs/site-src/self-assessment.md)
```

- [ ] **Step 4: Update line 145 (ship-pattern.md)**

Use Edit:

```
old_string: [`docs/ship-pattern.md`](docs/ship-pattern.md)
new_string: [`docs/site-src/ship-pattern.md`](docs/site-src/ship-pattern.md)
```

- [ ] **Step 5: Run path-migration test for README progress**

```bash
npx vitest run scripts/__tests__/docs-path-migration.test.mjs
```

Expected: still FAILS but with one fewer offender (README.md no longer appears). Other files (CLAUDE.md, rubric.json, page.tsx) still listed.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs(readme): update 3 path refs after docs/ → docs/site-src/ move — CCE-XX

Image asset + self-assessment.md link + ship-pattern.md link
all needed retargeting. README stays at the repo root (NOT
part of the mkdocs site), so these are GitHub-rendered links."
```

---

### Task 13: Update path refs in `CLAUDE.md`

**Files:**

- Modify: `CLAUDE.md` lines ~272 and ~439

- [ ] **Step 1: Find exact line content**

```bash
grep -n 'docs/' CLAUDE.md | grep -v 'docs/superpowers/' | grep -v 'docs/ship-pattern/page.tsx'
```

Expected output (line numbers may drift slightly):

- Line 272-ish: `- Committed README/doc assets live in \`docs/images/\`. The \`.gitignore\``
- Line 439-ish: `\`docs/ship-pattern.md\` Stage 7 — the \`/ship\` command transitions`

- [ ] **Step 2: Update `docs/images/` ref**

Use Edit:

```
old_string: Committed README/doc assets live in `docs/images/`. The `.gitignore`
new_string: Committed README/doc assets live in `docs/site-src/images/`. The `.gitignore`
```

- [ ] **Step 3: Update `docs/ship-pattern.md` ref**

Use Edit:

```
old_string: `docs/ship-pattern.md` Stage 7 — the `/ship` command transitions
new_string: `docs/site-src/ship-pattern.md` Stage 7 — the `/ship` command transitions
```

- [ ] **Step 4: Re-run path-migration test**

```bash
npx vitest run scripts/__tests__/docs-path-migration.test.mjs
```

Expected: still FAILS but CLAUDE.md gone from offenders list. Only rubric.json + page.tsx remain.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): retarget 2 doc-path refs to docs/site-src/ — CCE-XX

Project memory should track the move so future-Claude reading
CLAUDE.md gets the current paths. Line 77's app/docs/ship-pattern/
page.tsx is the app path, not a docs path — left untouched."
```

---

### Task 14: Update path ref in `app/data/rubric.json`

**Files:**

- Modify: `app/data/rubric.json` line ~21

- [ ] **Step 1: Find exact content**

```bash
grep -n 'docs/ship-pattern.md' app/data/rubric.json
```

- [ ] **Step 2: Update the ref**

Use Edit:

```
old_string: docs/ship-pattern.md for a reference design
new_string: docs/site-src/ship-pattern.md for a reference design
```

Note: the same line also references `docs/superpowers/specs/2026-05-09-ship-slash-command-design.md` — that one does NOT move, leave it alone.

- [ ] **Step 3: Re-run path-migration test**

```bash
npx vitest run scripts/__tests__/docs-path-migration.test.mjs
```

Expected: rubric.json gone from offenders. Only page.tsx remains.

- [ ] **Step 4: Commit**

```bash
git add app/data/rubric.json
git commit -m "data(rubric): retarget ship-pattern.md ref to docs/site-src/ — CCE-XX"
```

---

### Task 15: Update `app/docs/ship-pattern/page.tsx` (2 spots)

**Files:**

- Modify: `app/docs/ship-pattern/page.tsx` line 14 (runtime) + line 33 (display string)

- [ ] **Step 1: Update line 14 (runtime path read)**

Use Edit:

```
old_string:   const path = join(process.cwd(), "docs", "ship-pattern.md");
new_string:   const path = join(process.cwd(), "docs", "site-src", "ship-pattern.md");
```

- [ ] **Step 2: Update line 33 (display string)**

Use Edit:

```
old_string:           <span className="mono">docs/ship-pattern.md</span>
new_string:           <span className="mono">docs/site-src/ship-pattern.md</span>
```

- [ ] **Step 3: Run path-migration test (should now be GREEN)**

```bash
npx vitest run scripts/__tests__/docs-path-migration.test.mjs
```

Expected: PASS — `offenders` array empty.

- [ ] **Step 4: Run all docs tests together**

```bash
npx vitest run scripts/__tests__/docs-mkdocs-scaffold.test.mjs scripts/__tests__/docs-path-migration.test.mjs
```

Expected: scaffold test fully PASS, path-migration test PASS.

- [ ] **Step 5: Commit**

```bash
git add app/docs/ship-pattern/page.tsx
git commit -m "app(docs): retarget ship-pattern page to docs/site-src/ — CCE-XX

Two spots: runtime readFile path + the literal mono-font display
string shown in the page header. No behavior change."
```

---

## Phase 4 — Config flip & ignores

### Task 16: Flip `.engineering-docs-agent/config.yml` to mkdocs contract

**Files:**

- Modify: `.engineering-docs-agent/config.yml`

This task activates the publish-verifier stage of the nightly. All scaffold tasks must be done first.

- [ ] **Step 1: Re-read current config**

```bash
cat .engineering-docs-agent/config.yml
```

- [ ] **Step 2: Replace the whole `docs:` block**

Use Edit to swap five field values + rewrite the leading comment:

```
old_string:
# engineering-docs-agent host config for theoju/claude-code-self-assessment (CCE-57).
#
# Host type: Next.js + TypeScript dashboard. No static-site generator;
# docs are plain markdown rendered by GitHub at
# https://github.com/theoju/claude-code-self-assessment/blob/main/docs/.
# See docs/host-onboarding/framework-none.md in the plugin repo for what
# this means (what runs, what skips, how to upgrade to mkdocs).

docs:
  framework: none
  source_dir: docs
  whats_new_file: docs/whats-new.md
  agent_editable_paths:
    - "docs/**"
  lens_paths:
    core: docs/

new_string:
# engineering-docs-agent host config for theoju/claude-code-self-assessment (CCE-57).
#
# Host type: Next.js + TypeScript dashboard with a mkdocs-Material docs
# site published to GitHub Pages. The site source lives at docs/site-src/
# and is built by .github/workflows/docs-agent-pages.yml on every push
# to main that touches docs/site-src/**, mkdocs.yml, requirements-docs.txt,
# or the workflow itself.

docs:
  framework: mkdocs
  source_dir: docs
  whats_new_file: docs/site-src/whats-new.md
  agent_editable_paths:
    - "docs/**"
  lens_paths:
    core: docs/site-src/
```

- [ ] **Step 3: Replace the `publishing:` block**

Use Edit to swap base_url + build_workflow + rewrite the leading comment:

```
old_string:
publishing:
  # framework: none → no GitHub Pages publish workflow exists or is
  # expected. The publish-verifier stage skips with `verify_skipped` in
  # partial_reasons. If you later scaffold mkdocs and add a deploy
  # workflow, swap framework to mkdocs and fill in base_url + build_workflow.
  base_url: null
  build_workflow: null
  url_map_rule: standard
  verify_timeout_seconds: 60

new_string:
publishing:
  # framework: mkdocs → publish-verifier checks the build_workflow ran
  # for the current HEAD on main and that base_url + each lens page is
  # reachable within verify_timeout_seconds. A failed verification adds
  # `verify_failed` to partial_reasons but does not block the run.
  base_url: https://theoju.github.io/claude-code-self-assessment/
  build_workflow: docs-agent-pages.yml
  url_map_rule: standard
  verify_timeout_seconds: 60
```

- [ ] **Step 4: Run config-flip test**

```bash
npx vitest run scripts/__tests__/docs-config-mkdocs.test.mjs
```

Expected: PASS — all 7 cases green.

- [ ] **Step 5: Commit**

```bash
git add .engineering-docs-agent/config.yml
git commit -m "feat(docs-agent): flip config.yml to mkdocs contract — CCE-XX

framework: none → mkdocs. whats_new_file + lens_paths.core
retargeted at docs/site-src/. publishing.base_url + build_workflow
populated. Activates the publish-verifier stage of the nightly.

Comment blocks rewritten to describe the current state, not the
old upgrade path."
```

---

### Task 17: Add `/site/` to `.gitignore`

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Read current `.gitignore` to find the right anchor**

```bash
cat .gitignore
```

The file has no "Build outputs" section. The cleanest anchor is the
existing `node_modules\n.next\nnext-env.d.ts` block at the very top
(other build/output artifacts like `.next` already live there).

- [ ] **Step 2: Append `/site/` after the `.next` block**

Use Edit:

```
old_string:
node_modules
.next
next-env.d.ts

new_string:
node_modules
.next
next-env.d.ts
site/
```

(Note: no leading slash needed since `.next` doesn't use one either.
Match the existing style.)

- [ ] **Step 2b (optional): also ignore `.venv-docs/` if you created one in Task 18**

If the venv directory is going to live in the repo for local dev,
add it too. Otherwise skip.

```
old_string:
node_modules
.next
next-env.d.ts
site/

new_string:
node_modules
.next
next-env.d.ts
site/
.venv-docs/
```

- [ ] **Step 3: Verify**

```bash
grep -nE '^site/$' .gitignore
```

Expected: one match.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore(gitignore): ignore site/ (local mkdocs build output) — CCE-XX"
```

---

## Phase 5 — End-to-end verification

### Task 18: Local mkdocs build — strict mode

**Files:** (none modified; verification only)

- [ ] **Step 1: Create a Python venv and install deps**

```bash
python3 -m venv .venv-docs
source .venv-docs/bin/activate
pip install -r requirements-docs.txt
```

Expected: clean install, all pinned versions resolve.

- [ ] **Step 2: Run mkdocs build --strict**

```bash
mkdocs build --strict
```

Expected: exit 0. The build produces `site/` (ignored by git). If it fails:

1. **Broken inter-doc link** — a migrated `.md` references `[x](./foo)` without `.md`. Fix the link in the migrated file (Edit), re-run.
2. **Missing nav file** — SUMMARY.md references a file that doesn't exist (typo). Fix SUMMARY.md.
3. **Broken image link** — an image ref still uses the old path. Re-run Task 11's grep to catch missed refs.

Iterate Step 2 until clean. Commit fixes individually as `fix(docs): ...` if you had to make them.

- [ ] **Step 3: Spot-check via mkdocs serve**

```bash
mkdocs serve
# in another terminal:
curl -sI http://127.0.0.1:8000/ | head -3
curl -sI http://127.0.0.1:8000/self-assessment/ | head -3
curl -sI http://127.0.0.1:8000/ship-pattern/ | head -3
curl -sI http://127.0.0.1:8000/images/self-assessment-dashboard.png | head -3
```

Expected: each returns `HTTP/1.0 200` or `HTTP/2 200`. Kill the server (Ctrl+C in its terminal).

- [ ] **Step 4: Deactivate venv (cleanup)**

```bash
deactivate
```

(The venv stays on disk but is gitignored via Task 17's `/site/` — and `.venv-docs/` should also be ignored. Check:)

```bash
git status --short | grep -E '(site|venv)'
```

Expected: empty (no untracked venv or site dir polluting status). If `.venv-docs/` appears, add it to `.gitignore` in a follow-up edit and commit.

- [ ] **Step 5: Commit any fixes you made during iteration**

If you committed nothing in Step 2's iteration loop, skip. Otherwise, the fixes are already committed individually — proceed.

---

### Task 19: Dashboard dev-server smoke test (`/docs/ship-pattern`)

**Files:** (none modified; verification only)

- [ ] **Step 1: Start the Next.js dev server**

```bash
npm run dev
```

Wait for `▲ Next.js ... ready`.

- [ ] **Step 2: Verify the in-app docs page still loads**

In another terminal:

```bash
curl -sI http://localhost:3737/docs/ship-pattern | head -3
```

Expected: `HTTP/1.1 200 OK`.

If 404: the path edit in Task 15 missed. Check `app/docs/ship-pattern/page.tsx` line 14.

- [ ] **Step 3: Verify the page body contains the rendered markdown**

```bash
curl -s http://localhost:3737/docs/ship-pattern | grep -c '<h'
```

Expected: ≥1 (the markdown headings are rendered as HTML).

- [ ] **Step 4: Kill the dev server**

Ctrl+C in the dev-server terminal.

- [ ] **Step 5: No commit (verification only)**

---

### Task 20: Full test suite + lint

**Files:** (none modified; verification only)

- [ ] **Step 1: Run vitest (unit + integration)**

```bash
npx vitest run
```

Expected: all tests PASS. The three new docs-related test files contribute new passing cases. Total count should be `previous + 17 or so` new cases.

If any new failures unrelated to docs work appear, investigate before proceeding — could be flake or could be a real regression.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: clean. Any new lint issues in the modified `app/docs/ship-pattern/page.tsx` would surface here.

- [ ] **Step 3: Run playwright e2e**

```bash
npm run test:e2e
```

Expected: same green as pre-change. No new scaffold-related tests, but the existing E2E suite should not regress.

- [ ] **Step 4: No commit (verification only). Plan complete; ready for /ship.**

---

## Summary of commits this plan produces

In TDD order:

1. `test(docs): add path-migration scan (red) — CCE-XX`
2. `test(docs): add mkdocs scaffold existence checks (red) — CCE-XX`
3. `test(docs): add mkdocs config-flip contract (red) — CCE-XX`
4. `feat(docs): add mkdocs.yml (Material theme, minimal plugins) — CCE-XX`
5. `feat(docs): pin mkdocs deps in requirements-docs.txt — CCE-XX`
6. `feat(docs): add mkdocs site-src/index.md landing page — CCE-XX`
7. `feat(docs): add SUMMARY.md for literate-nav ordering — CCE-XX`
8. `feat(docs): add whats-new.md stub for agent population — CCE-XX`
9. `feat(ci): add docs-agent-pages workflow for GitHub Pages deploy — CCE-XX`
10. `refactor(docs): move docs/*.md + images/ into docs/site-src/ — CCE-XX`
11. `fix(docs): rewrite image refs relative to docs/site-src/ — CCE-XX` (only if image-ref grep found matches)
12. `docs(readme): update 3 path refs after docs/ → docs/site-src/ move — CCE-XX`
13. `docs(claude-md): retarget 2 doc-path refs to docs/site-src/ — CCE-XX`
14. `data(rubric): retarget ship-pattern.md ref to docs/site-src/ — CCE-XX`
15. `app(docs): retarget ship-pattern page to docs/site-src/ — CCE-XX`
16. `feat(docs-agent): flip config.yml to mkdocs contract — CCE-XX`
17. `chore(gitignore): ignore /site/ (local mkdocs build output) — CCE-XX`
    18-20: verification only (no commits unless fixes were needed)

Total: 16-17 commits + 0-N fix commits in the build-clean loop.

After Task 20 passes, the branch is shippable. Run `/ship` to commit/push (if anything outstanding), open the PR, run code-review, and update the linked Jira ticket.

---

## Notes for the executor

- **TDD discipline:** Tasks 1-3 write tests BEFORE Tasks 4-17 implement them. Resist the temptation to combine — separate commits make the failure surface visible in git history.
- **No batching files into one commit beyond what the task structure groups.** Each task is a logical unit.
- **Path placeholders:** every code block uses absolute paths to this worktree. Don't `cd` — run from the worktree root.
- **CCE-XX:** replace with the resolved Jira key in every commit message. If unresolved at execution time, use `CCE-XX` as a literal placeholder and update once the ticket is filed.
- **If a step fails:** don't paper over with a workaround. Diagnose root cause (the spec's CLAUDE.md "trust but verify" rule applies here too). The plan's verification gates exist to catch real problems.
