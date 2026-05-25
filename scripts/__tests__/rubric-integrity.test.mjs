import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rubric = JSON.parse(
  readFileSync(join(process.cwd(), "app", "data", "rubric.json"), "utf8"),
);
const catalog = JSON.parse(
  readFileSync(
    join(process.cwd(), "app", "data", "probe-catalog.json"),
    "utf8",
  ),
);
const tipIndex = JSON.parse(
  readFileSync(
    join(process.cwd(), "app", "data", "boris-tip-index.json"),
    "utf8",
  ),
);

const actions = rubric.dimensions.flatMap((d) =>
  d.nextActions.map((a) => ({ ...a, dim: d.id })),
);

// Split a satisfiedWhen predicate into its LHS field names.
function lhsFields(predicate) {
  return predicate
    .split("&")
    .map((clause) => clause.trim().replace(/^!/, ""))
    .map((clause) => clause.split(/[<>=!~]/)[0].trim())
    .filter(Boolean);
}

// Parse every tip number out of a "Boris tip 14/73" / "tip 33+54" / "tip 67, 72" suffix.
function proseTips(text) {
  const m = text.match(/Boris tip\s+([\d/+,\s]+)/i);
  if (!m) return [];
  return [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0]));
}

function tipSet(borisTip) {
  if (borisTip == null) return [];
  return Array.isArray(borisTip) ? borisTip : [borisTip];
}

describe("rubric integrity", () => {
  it("every satisfiedWhen LHS field has a probe-catalog entry", () => {
    const missing = [];
    for (const a of actions) {
      if (!a.satisfiedWhen) continue;
      for (const f of lhsFields(a.satisfiedWhen)) {
        if (!Object.prototype.hasOwnProperty.call(catalog, f)) {
          missing.push(`${a.dim}/${a.id}: ${f}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every borisTip is an integer in 1-75", () => {
    const bad = [];
    for (const a of actions) {
      for (const n of tipSet(a.borisTip)) {
        if (!Number.isInteger(n) || n < 1 || n > 75) {
          bad.push(`${a.dim}/${a.id}: ${n}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("prose 'Boris tip N' citation matches the borisTip field", () => {
    const mismatches = [];
    for (const a of actions) {
      const prose = proseTips(a.action).sort((x, y) => x - y);
      const field = tipSet(a.borisTip).sort((x, y) => x - y);
      if (JSON.stringify(prose) !== JSON.stringify(field)) {
        mismatches.push(`${a.dim}/${a.id}: prose=[${prose}] field=[${field}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("every borisTip resolves to a known topic (informational)", () => {
    for (const a of actions) {
      for (const n of tipSet(a.borisTip)) {
        expect(tipIndex.tips[String(n)]?.topic).toBeTruthy();
      }
    }
  });
});
