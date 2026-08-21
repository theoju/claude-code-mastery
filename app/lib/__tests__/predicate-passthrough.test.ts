import { describe, it, expect } from "vitest";
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
// Imported straight from the .mjs source on purpose — the TS re-export must be
// reference-equal to it (see CLAUDE.md "DSL evaluator has one source").
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

describe("evaluatePredicate — TS/MJS passthrough", () => {
  it("TS export is reference-equal to the MJS source", () => {
    expect(fromTs).toBe(fromMjs);
  });
});
