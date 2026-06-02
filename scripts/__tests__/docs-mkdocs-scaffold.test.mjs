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

  // Test rigor agent finding T4: SUMMARY.md entries that don't resolve
  // to a real file pass mkdocs build for the file existing, but the nav
  // entry is dead. Catch dead nav entries before --strict mode does.
  it("every SUMMARY.md page link resolves to a real file under docs/site-src/", () => {
    const dir = join(REPO_ROOT, "docs", "site-src");
    const body = readFileSync(join(dir, "SUMMARY.md"), "utf8");
    const matches = [...body.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]);
    expect(
      matches.length,
      "SUMMARY.md should have at least one .md link",
    ).toBeGreaterThan(0);
    for (const rel of matches) {
      expect(
        existsSync(join(dir, rel)),
        `SUMMARY.md references ${rel} but docs/site-src/${rel} does not exist`,
      ).toBe(true);
    }
  });

  // Test rigor agent finding T6: rubric.json edited by hand in Task 14.
  // A stray comma would only fail at runtime / next assess.
  it("app/data/rubric.json remains valid JSON after path-ref edit", () => {
    const p = join(REPO_ROOT, "app", "data", "rubric.json");
    expect(existsSync(p)).toBe(true);
    expect(() => JSON.parse(readFileSync(p, "utf8"))).not.toThrow();
  });

  // Spec negative test 1: specs don't ship to the site.
  // Pre-merge enforceable as "config.yml lens_paths.core does NOT include
  // docs/superpowers" AND "docs/site-src/superpowers/ does not exist".
  it("docs/site-src/superpowers/ does NOT exist (specs stay outside the site)", () => {
    expect(existsSync(join(REPO_ROOT, "docs", "site-src", "superpowers"))).toBe(
      false,
    );
  });

  // Spec negative test 2: Pages workflow ignores non-docs pushes.
  // Walk the workflow YAML's on.push.paths list and assert every entry
  // is docs-related — no scripts/**, no app/**, no package.json.
  it("docs-agent-pages.yml on.push.paths only includes docs-related globs", () => {
    const p = join(REPO_ROOT, ".github", "workflows", "docs-agent-pages.yml");
    const body = readFileSync(p, "utf8");
    // Extract the paths block. The format is:
    //   on:
    //     push:
    //       branches: [main]
    //       paths:
    //         - "docs/site-src/**"
    //         - "mkdocs.yml"
    //         ...
    const pathsBlock = body.match(/paths:\n((?:\s*-\s*"[^"]+"\n)+)/);
    expect(
      pathsBlock,
      "docs-agent-pages.yml should declare on.push.paths",
    ).not.toBeNull();
    const paths = [...pathsBlock[1].matchAll(/-\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(paths.length).toBeGreaterThan(0);
    const allowedPrefixes = [
      "docs/site-src/",
      "mkdocs.yml",
      "requirements-docs.txt",
      ".github/workflows/docs-agent-pages",
    ];
    for (const path of paths) {
      const ok = allowedPrefixes.some((prefix) => path.startsWith(prefix));
      expect(
        ok,
        `docs-agent-pages.yml on.push.paths includes "${path}" which is not docs-related`,
      ).toBe(true);
    }
  });
});
