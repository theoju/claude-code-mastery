import { describe, it, expect } from "vitest";
import { deriveHeadline, type Assessment, type Dimension } from "../assessment";

function dim(overrides: Partial<Dimension> = {}): Dimension {
  return {
    id: "x",
    title: "Test",
    weight: 1,
    target: 80,
    rawTarget: 80,
    rubricArea: "test",
    borisTips: "1",
    nextActions: [],
    score: 50,
    rawScore: 50,
    tier: "developing",
    trend: "flat",
    evidence: [],
    gaps: [],
    summary: "",
    executionScore: null,
    executionRawScore: null,
    executionEvidence: [],
    executionGaps: [],
    gapReason: null,
    ...overrides,
  };
}

function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    capturedAt: "2026-05-09T00:00:00.000Z",
    overall: 75,
    targetOverall: 90,
    executionOverall: null,
    user: "Test",
    dimensions: [],
    signalsSummary: {},
    rankedNextActions: [],
    insights: null,
    claudeMd: null,
    ...overrides,
  };
}

describe("deriveHeadline", () => {
  it("labels strength by setup tier (advanced)", () => {
    const r = deriveHeadline(
      assessment({ overall: 95, signalsSummary: { plugins: 33 } }),
    );
    expect(r.strengthLabel).toBe("advanced on platform setup");
  });

  it("labels strength by setup tier (solid)", () => {
    const r = deriveHeadline(assessment({ overall: 75 }));
    expect(r.strengthLabel).toBe("solid on platform setup");
  });

  it("labels strength by setup tier (developing/starter)", () => {
    const r = deriveHeadline(assessment({ overall: 45 }));
    // Tier label is interpolated for non-advanced/non-solid tiers.
    expect(r.strengthLabel).toMatch(
      /(developing|starter|not-touched) on platform setup/,
    );
  });

  it("includes plugin/hook/skill/memory bits in strengthDetails when present", () => {
    const r = deriveHeadline(
      assessment({
        overall: 90,
        signalsSummary: {
          plugins: 33,
          hookTotalCount: 4,
          personalSkills: 2,
          projectsWithMemory: 2,
        },
      }),
    );
    expect(r.strengthDetails).toContain("33 plugins");
    expect(r.strengthDetails).toContain("4 configured hooks");
    expect(r.strengthDetails).toContain("2 personal skills");
    expect(r.strengthDetails).toContain("memory across 2 projects");
  });

  it("strengthDetails is empty string when no signals are set", () => {
    const r = deriveHeadline(assessment({ overall: 50, signalsSummary: {} }));
    expect(r.strengthDetails).toBe("");
  });

  it("Δ ≥ 15 between setup and exec produces 'tools installed but under-firing'", () => {
    const r = deriveHeadline(
      assessment({
        overall: 84,
        executionOverall: 57,
        dimensions: [
          dim({
            id: "verification",
            title: "Verification — The #1 Tip",
            executionScore: 18,
          }),
          dim({
            id: "permissions",
            title: "Permissions & Safety",
            executionScore: 52,
          }),
        ],
      }),
    );
    expect(r.weaknessDetails).toContain("tools installed but under-firing");
  });

  it("Δ ≥ 15 names lowest-execution dims (sorted, capped at 2)", () => {
    const r = deriveHeadline(
      assessment({
        overall: 90,
        executionOverall: 30,
        dimensions: [
          dim({ id: "a", title: "Alpha", executionScore: 18 }),
          dim({ id: "b", title: "Beta", executionScore: 25 }),
          dim({ id: "c", title: "Gamma", executionScore: 40 }),
          dim({ id: "d", title: "Delta", executionScore: 80 }), // above 50, excluded
        ],
      }),
    );
    expect(r.weaknessDetails).toContain("alpha 18/100");
    expect(r.weaknessDetails).toContain("beta 25/100");
    expect(r.weaknessDetails).not.toContain("delta");
  });

  it("Δ < 15 falls back to weakest-setup-dim path", () => {
    const r = deriveHeadline(
      assessment({
        overall: 70,
        executionOverall: 65,
        dimensions: [
          dim({
            id: "weak",
            title: "Weak Dim",
            tier: "starter",
            score: 30,
            weight: 3,
          }),
        ],
        signalsSummary: {
          personalCommands: 0,
          personalAgents: 0,
          personalSkills: 0,
        },
      }),
    );
    expect(r.weaknessDetails).toContain("zero personal");
  });

  it("Δ < 15 with no weak setup dims uses developing-edges fallback", () => {
    const r = deriveHeadline(
      assessment({
        overall: 95,
        executionOverall: 92,
        dimensions: [dim({ tier: "advanced", score: 95 })],
      }),
    );
    expect(r.weaknessLabel).toContain("developing");
    expect(r.weaknessDetails).toContain("habit");
  });

  it("no execution data: skips delta path entirely", () => {
    const r = deriveHeadline(
      assessment({
        overall: 70,
        executionOverall: null,
        dimensions: [
          dim({
            id: "weak",
            title: "Weak Dim",
            tier: "starter",
            score: 30,
            weight: 3,
          }),
        ],
      }),
    );
    // Should not reference exec/Δ language; falls into weakest-setup-dim path.
    expect(r.weaknessDetails).not.toContain("under-firing");
  });

  it("era-aware closer: 4.6-era effortLevel triggers carry-over message", () => {
    const r = deriveHeadline(
      assessment({
        overall: 90,
        signalsSummary: {
          effortLevel: "high",
          autoCompactWindow: undefined,
        },
      }),
    );
    expect(r.closer).toContain("4.6-era");
    expect(r.closer).toContain("high");
  });

  it("era-aware closer: full 4.7 tuning triggers habit-shift message", () => {
    const r = deriveHeadline(
      assessment({
        overall: 90,
        signalsSummary: {
          effortLevel: "xhigh",
          autoCompactWindow: 400000,
        },
      }),
    );
    expect(r.closer).toContain("habit shifts");
    expect(r.closer).not.toContain("4.6-era");
  });

  it("era-aware closer: missing autoCompactWindow keeps carry-over framing even at xhigh", () => {
    const r = deriveHeadline(
      assessment({
        overall: 90,
        signalsSummary: {
          effortLevel: "xhigh",
          autoCompactWindow: undefined,
        },
      }),
    );
    expect(r.closer).toContain("4.6-era");
  });
});
