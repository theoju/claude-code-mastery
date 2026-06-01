import { describe, it, expect } from "vitest";
import { rankNextActions } from "../rank-next-actions.mjs";

const fixtureRubric = {
  dimensions: [
    {
      id: "scheduled",
      weight: 2,
      nextActions: [
        {
          id: "babysit-loop",
          action: "Start with one loop — Boris tip 48",
          effort: "5min",
          borisTip: 48,
          satisfiedWhen: "loopCommandUses>=1",
        },
        {
          id: "promote-routine",
          action: "Promote repeating patterns to a Routine — Boris tip 61",
          effort: "30min",
          borisTip: 61,
          satisfiedWhen: "scheduleCommandUses>=1",
        },
      ],
    },
    {
      id: "automation",
      weight: 3,
      nextActions: [
        {
          id: "formatter-hook",
          action: "Add a PostToolUse formatter hook — Boris tip 7",
          effort: "15min",
          borisTip: 7,
          satisfiedWhen: "hasFormatterHook",
        },
      ],
    },
    {
      id: "remote",
      weight: 1,
      nextActions: [
        {
          id: "ios-task",
          action: "Try the iOS app — coaching",
          effort: "5min",
          // no satisfiedWhen → unpredicated coaching, axis defaults to "either"
        },
        {
          id: "missing-action-text",
          // no action field → malformed, must be skipped
          effort: "5min",
        },
      ],
    },
  ],
};

const makeScoreMap = (overrides = {}) =>
  new Map([
    ["scheduled", { score: 75, executionScore: 100 }],
    ["automation", { score: 89, executionScore: null }],
    ["remote", { score: 87, executionScore: 100 }],
    ...Object.entries(overrides),
  ]);

describe("rankNextActions", () => {
  it("returns ranked list sorted by weight*deficit desc", () => {
    const signals = {
      loopCommandUses: 0, // babysit-loop NOT satisfied
      scheduleCommandUses: 0, // promote-routine NOT satisfied
      hasFormatterHook: false, // formatter-hook NOT satisfied
    };
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    // ranks: scheduled actions = 2 * 25 = 50 each
    //        automation formatter-hook = 3 * 11 = 33
    //        remote ios-task = 1 * 13 = 13
    expect(result[0].rank).toBe(50);
    expect(result[1].rank).toBe(50);
    expect(result[2].rank).toBe(33);
    expect(result[3].rank).toBe(13);
    expect(result).toHaveLength(4);
  });

  it("NAMED REGRESSION: loopCommandUses=14 excludes babysit-loop action", () => {
    const signals = {
      loopCommandUses: 14, // SATISFIES "loopCommandUses>=1"
      scheduleCommandUses: 0,
      hasFormatterHook: false,
    };
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    const ids = result.map((a) => a.actionId);
    expect(ids).not.toContain("babysit-loop");
    expect(ids).toContain("promote-routine");
  });

  it("unpredicated action stays regardless of signals", () => {
    const signals = {
      loopCommandUses: 14,
      scheduleCommandUses: 14,
      hasFormatterHook: true,
    };
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    const ids = result.map((a) => a.actionId);
    expect(ids).toEqual(["ios-task"]);
  });

  it("malformed action (missing action text) is silently skipped", () => {
    const signals = {};
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    const ids = result.map((a) => a.actionId);
    expect(ids).not.toContain("missing-action-text");
  });

  it("respects limit slicing", () => {
    const signals = {};
    expect(
      rankNextActions(fixtureRubric, makeScoreMap(), signals, 2),
    ).toHaveLength(2);
    expect(
      rankNextActions(fixtureRubric, makeScoreMap(), signals, 0),
    ).toHaveLength(0);
  });

  it("tie-breaking is deterministic: rank → axis → weight → dimId → actionId", () => {
    const signals = {};
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    // Both scheduled actions have rank=50, axis=platform, weight=2.
    // Tie-break falls to dimId then actionId — both share dimId=scheduled,
    // so actionId ascending: babysit-loop < promote-routine.
    expect(result[0].actionId).toBe("babysit-loop");
    expect(result[1].actionId).toBe("promote-routine");
  });

  it("each entry carries required fields", () => {
    const signals = {};
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    for (const entry of result) {
      expect(entry).toMatchObject({
        dimId: expect.any(String),
        actionId: expect.any(String),
        axis: expect.any(String),
        weight: expect.any(Number),
        deficit: expect.any(Number),
        rank: expect.any(Number),
        action: expect.any(String),
        effort: expect.any(String),
      });
    }
  });

  it("axis defaults: predicated → platform; unpredicated → either", () => {
    const signals = {};
    const result = rankNextActions(fixtureRubric, makeScoreMap(), signals, 10);
    const formatter = result.find((a) => a.actionId === "formatter-hook");
    const ios = result.find((a) => a.actionId === "ios-task");
    expect(formatter.axis).toBe("platform");
    expect(ios.axis).toBe("either");
  });

  it("dim missing from scoreMap is skipped, not crashed", () => {
    const partialMap = new Map([
      ["automation", { score: 89, executionScore: null }],
    ]);
    const result = rankNextActions(fixtureRubric, partialMap, {}, 10);
    // Only automation actions appear (scheduled and remote skipped).
    expect(result.every((a) => a.dimId === "automation")).toBe(true);
  });

  it("axis ordering buckets unknown axis values with 'either' (tier 2)", () => {
    // Spec-pinning regression for the internal axisOrder() mapping.
    // platform=0, execution=1, either=2 — and anything else also falls to 2,
    // so an unknown axis sorts adjacent to "either", not ahead of "platform".
    const fixture = {
      dimensions: [
        {
          id: "a",
          weight: 1,
          nextActions: [
            { id: "platform-action", action: "p", axis: "platform" },
            { id: "unknown-action", action: "u", axis: "novel-tier" },
          ],
        },
      ],
    };
    const scoreMap = new Map([["a", { score: 50, executionScore: 50 }]]);
    const result = rankNextActions(fixture, scoreMap, {}, 10);
    // Both rank=1*50=50; axis tiebreak: platform(0) before novel-tier(2).
    expect(result.map((r) => r.actionId)).toEqual([
      "platform-action",
      "unknown-action",
    ]);
  });
});
