import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluatePredicate } from "../predicate.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("evaluatePredicate — operator coverage", () => {
  it(">= : true above and at boundary; false below", () => {
    expect(evaluatePredicate("x>=5", { x: 5 })).toBe(true);
    expect(evaluatePredicate("x>=5", { x: 14 })).toBe(true);
    expect(evaluatePredicate("x>=5", { x: 4 })).toBe(false);
  });

  it("> : strict — false at boundary", () => {
    expect(evaluatePredicate("x>5", { x: 5 })).toBe(false);
    expect(evaluatePredicate("x>5", { x: 6 })).toBe(true);
  });

  it("<= and <", () => {
    expect(evaluatePredicate("x<=5", { x: 5 })).toBe(true);
    expect(evaluatePredicate("x<5", { x: 5 })).toBe(false);
    expect(evaluatePredicate("x<5", { x: 4 })).toBe(true);
  });

  it("missing numeric signal: comparisons NaN-guard to false", () => {
    // Mirrors app/lib/assessment.ts: when the LHS path resolves to undefined,
    // Number(undefined) is NaN, the NaN guard short-circuits, and the
    // comparison returns false regardless of operator direction. This
    // diverges from the rubric $schema comment's "missing → 0" wording but
    // matches the canonical TS behavior — fixing the wording is rubric
    // doc-work, not a scorer change.
    expect(evaluatePredicate("x>=1", {})).toBe(false);
    expect(evaluatePredicate("x<=0", {})).toBe(false);
  });

  it("= : exact equality (string and numeric)", () => {
    expect(evaluatePredicate("x=foo", { x: "foo" })).toBe(true);
    expect(evaluatePredicate("x=foo", { x: "bar" })).toBe(false);
    expect(evaluatePredicate("x=5", { x: 5 })).toBe(true);
  });

  it("= : alternation with |", () => {
    expect(evaluatePredicate("x=foo|bar|baz", { x: "bar" })).toBe(true);
    expect(evaluatePredicate("x=foo|bar|baz", { x: "qux" })).toBe(false);
  });

  it("!= : not-equals", () => {
    expect(evaluatePredicate("x!=foo", { x: "bar" })).toBe(true);
    expect(evaluatePredicate("x!=foo", { x: "foo" })).toBe(false);
    expect(evaluatePredicate("x!=foo", {})).toBe(true);
  });

  it("~ : array-of-strings regex match (case-insensitive)", () => {
    expect(
      evaluatePredicate("skills~^ship$", { skills: ["ship", "verify"] }),
    ).toBe(true);
    expect(evaluatePredicate("skills~^SHIP$", { skills: ["ship"] })).toBe(true);
    expect(evaluatePredicate("skills~^xyz$", { skills: ["ship"] })).toBe(false);
  });

  it("~ : non-array LHS returns false", () => {
    expect(evaluatePredicate("skills~^ship$", { skills: "ship" })).toBe(false);
  });

  it("~ : unparseable regex returns false (never throws)", () => {
    expect(evaluatePredicate("skills~[", { skills: ["ship"] })).toBe(false);
  });

  it("! : negation of truthy and falsy paths", () => {
    expect(evaluatePredicate("!x", { x: 0 })).toBe(true);
    expect(evaluatePredicate("!x", { x: 5 })).toBe(false);
    expect(evaluatePredicate("!missing", {})).toBe(true);
  });

  it("& : AND across two atoms", () => {
    expect(evaluatePredicate("x>0 & y>0", { x: 5, y: 5 })).toBe(true);
    expect(evaluatePredicate("x>0 & y>0", { x: 5, y: 0 })).toBe(false);
  });

  it("& : AND across three atoms", () => {
    expect(evaluatePredicate("x>0 & y>0 & z>0", { x: 1, y: 1, z: 1 })).toBe(
      true,
    );
    expect(evaluatePredicate("x>0 & y>0 & z>0", { x: 1, y: 1, z: 0 })).toBe(
      false,
    );
  });

  it("bare path : truthy check", () => {
    expect(evaluatePredicate("flag", { flag: true })).toBe(true);
    expect(evaluatePredicate("count", { count: 14 })).toBe(true);
    expect(evaluatePredicate("count", { count: 0 })).toBe(false);
    expect(evaluatePredicate("name", { name: "" })).toBe(false);
    expect(evaluatePredicate("missing", {})).toBe(false);
  });

  it("nested path: a.b.c", () => {
    expect(evaluatePredicate("a.b.c=ok", { a: { b: { c: "ok" } } })).toBe(true);
    expect(evaluatePredicate("a.b.c", { a: { b: { c: 5 } } })).toBe(true);
    expect(evaluatePredicate("a.b.c", { a: {} })).toBe(false);
  });

  it("empty / whitespace expression returns false", () => {
    expect(evaluatePredicate("", {})).toBe(false);
    expect(evaluatePredicate("   ", {})).toBe(false);
  });

  it("named regression: loopCommandUses=14 satisfies loopCommandUses>=1", () => {
    expect(
      evaluatePredicate("loopCommandUses>=1", { loopCommandUses: 14 }),
    ).toBe(true);
  });
});

describe("evaluatePredicate — rubric integration", () => {
  it("every satisfiedWhen in production rubric parses without throwing", () => {
    const rubricPath = join(here, "..", "..", "app", "data", "rubric.json");
    const rubric = JSON.parse(readFileSync(rubricPath, "utf8"));
    for (const dim of rubric.dimensions || []) {
      for (const na of dim.nextActions || []) {
        if (na.satisfiedWhen) {
          expect(
            () => evaluatePredicate(na.satisfiedWhen, {}),
            `predicate "${na.satisfiedWhen}" on ${dim.id}/${na.id} threw`,
          ).not.toThrow();
        }
      }
    }
  });
});
