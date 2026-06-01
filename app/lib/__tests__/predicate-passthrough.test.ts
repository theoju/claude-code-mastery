import { describe, it, expect } from "vitest";
import { evaluatePredicate as fromTs } from "@/app/lib/assessment";
// @ts-expect-error — .mjs has no type declarations; this is intentional
import { evaluatePredicate as fromMjs } from "@/scripts/predicate.mjs";

describe("evaluatePredicate — TS/MJS passthrough", () => {
  it("TS export is reference-equal to the MJS source", () => {
    expect(fromTs).toBe(fromMjs);
  });
});
