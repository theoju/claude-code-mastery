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

  // Spec negative test 3: framework=mkdocs ACTIVATES (not just declared).
  // A half-flipped state — framework: mkdocs but base_url: null — passes
  // the individual checks above but fails the joint contract. Assert all
  // three publishing fields are populated in one test so the failure
  // message says "config is half-flipped" rather than "base_url is null".
  it("framework=mkdocs implies base_url AND build_workflow are both populated", () => {
    const body = readConfig();
    const isMkdocs = /^\s*framework:\s*mkdocs\s*$/m.test(body);
    if (!isMkdocs) return; // base_url check already covered above
    expect(
      body,
      "framework: mkdocs requires non-null publishing.base_url",
    ).not.toMatch(/^\s*base_url:\s*null\s*$/m);
    expect(
      body,
      "framework: mkdocs requires non-null publishing.build_workflow",
    ).not.toMatch(/^\s*build_workflow:\s*null\s*$/m);
    expect(body).toMatch(/^\s*base_url:\s*https?:\/\//m);
    expect(body).toMatch(/^\s*build_workflow:\s*[a-z][a-z0-9._-]*\.ya?ml\s*$/m);
  });

  // Regression guard: lens_paths.core must NOT include docs/superpowers
  // (specs stay outside the published site per spec non-goal #7).
  it("lens_paths.core does NOT include docs/superpowers (specs stay private)", () => {
    expect(readConfig()).not.toMatch(/^\s*core:\s*docs\/superpowers/m);
    expect(readConfig()).not.toMatch(/^\s*core:\s*docs\/?\s*$/m);
  });
});
