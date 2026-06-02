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
