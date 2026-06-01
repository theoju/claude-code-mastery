import { describe, it, expect } from "vitest";
import { makeSignals, makeRubric } from "./_fixtures.mjs";
import { scoreAll } from "../score.mjs";
import { rankNextActions } from "../rank-next-actions.mjs";
import { buildSignalsSummary } from "../run-assessment.mjs";

describe("rankNextActions integration with scoreAll output", () => {
  it("produces ≤10 ranked entries from a real scored result", () => {
    const rubric = makeRubric();
    const signals = makeSignals();
    const signalsSummary = buildSignalsSummary(signals);
    const scored = scoreAll(rubric, signals);
    const scoreMap = new Map(scored.scores.map((s) => [s.id, s]));
    const ranked = rankNextActions(rubric, scoreMap, signalsSummary, 10);
    expect(Array.isArray(ranked)).toBe(true);
    expect(ranked.length).toBeLessThanOrEqual(10);
    if (ranked.length > 0) {
      expect(ranked[0]).toMatchObject({
        dimId: expect.any(String),
        actionId: expect.any(String),
        rank: expect.any(Number),
      });
    }
  });

  it("ranking is stable across two identical runs (determinism)", () => {
    const rubric = makeRubric();
    const signals = makeSignals();
    const signalsSummary = buildSignalsSummary(signals);
    const scored = scoreAll(rubric, signals);
    const scoreMap = new Map(scored.scores.map((s) => [s.id, s]));
    const a = rankNextActions(rubric, scoreMap, signalsSummary, 10);
    const b = rankNextActions(rubric, scoreMap, signalsSummary, 10);
    expect(a).toEqual(b);
  });
});
