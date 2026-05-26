import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSignalsSummary } from "../run-assessment.mjs";
import { makeSignals } from "./_fixtures.mjs";

// Guards the five live counts cited in the probe tracker's "Validated against"
// header against the real files, so a stale number fails CI instead of riding
// along in a PR (the CLAUDE.md "keep the probe tracker in sync" rule, machine-
// enforced). The header format is therefore a tested contract.

const root = process.cwd();
const J = (...p) => JSON.parse(readFileSync(join(root, ...p), "utf8"));

const tipIndex = J("app", "data", "boris-tip-index.json");
const rubric = J("app", "data", "rubric.json");
const catalog = J("app", "data", "probe-catalog.json");

const tracker = readFileSync(
  join(
    root,
    "docs",
    "superpowers",
    "specs",
    "2026-05-25-probe-implementation-status.md",
  ),
  "utf8",
);

// Pull a single integer out of the tracker header by the prose that surrounds
// it. Returns null when that phrase is absent (header reworded past the regex)
// so the check fails loudly rather than silently passing.
function cited(re) {
  const m = tracker.match(re);
  return m ? Number(m[1]) : null;
}

// [label, header regex, live-derived value].
//
// signalsSummary is derived by INVOKING buildSignalsSummary — never by parsing
// its source. A regex over the function body silently under-counts shorthand
// properties (e.g. `hookEvents,`), the exact bug that briefly put a wrong 65 in
// this header. The runtime object is the only ground truth.
const counts = [
  ["tips", /\((\d+)\s+tips\)/, Object.keys(tipIndex.tips).length],
  ["dimensions", /\((\d+)\s+dimensions\b/, rubric.dimensions.length],
  [
    "next-actions",
    // Anchored to the "dimensions / N next-actions" context so a future doc
    // edit that mentions a next-action count earlier in the prose can't shift
    // the target.
    /dimensions\s*\/\s*(\d+)\s+next-actions/,
    rubric.dimensions.flatMap((d) => d.nextActions).length,
  ],
  [
    "probes",
    /\((\d+)\s+probes\b/,
    Object.keys(catalog).filter((k) => k !== "_meta").length,
  ],
  [
    "signalsSummary keys",
    /\((\d+)\s+`signalsSummary`\s+keys\)/,
    Object.keys(buildSignalsSummary(makeSignals())).length,
  ],
];

describe("probe tracker header counts", () => {
  for (const [label, re, derived] of counts) {
    it(`cites the live ${label} count`, () => {
      const n = cited(re);
      expect(
        n,
        `tracker header must cite "${label}" in a form the regex matches`,
      ).not.toBeNull();
      expect(n, `header says ${n} ${label}; live value is ${derived}`).toBe(
        derived,
      );
    });
  }
});
