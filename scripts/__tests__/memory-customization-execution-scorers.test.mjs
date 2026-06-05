import { describe, it, expect } from "vitest";
import { EXECUTION_SCORERS, GAP_REASONS } from "../score.mjs";

describe("EXECUTION_SCORERS.memory (CCE-76)", () => {
  it("Test 1: returns unavailable(NO_INSIGHTS) when s.insights is missing", () => {
    const result = EXECUTION_SCORERS.memory({});
    expect(result.score).toBeNull();
    expect(result.gapReason).toBe(GAP_REASONS.NO_INSIGHTS);
  });

  it("Test 2: returns unavailable(NO_TRANSCRIPTS) when transcripts not scanned", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: false,
      },
    });
    expect(result.score).toBeNull();
    expect(result.gapReason).toBe(GAP_REASONS.NO_TRANSCRIPTS);
  });

  it("Test 3: returns unavailable(NO_SESSIONS) when interactiveOrUnknownSessionsAnalyzed is 0", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 0,
        interactiveOrUnknownSessionsAnalyzed: 0,
        transcriptsScanned: true,
      },
    });
    expect(result.score).toBeNull();
    expect(result.gapReason).toBe(GAP_REASONS.NO_SESSIONS);
  });

  it("Test 4: perfect ratio at session coverage = 1.0", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { clearCommandUses: 100 },
    });
    expect(result.score).toBe(100);
  });

  it("Test 5: cap fires when sum exceeds denominator; evidence reports capped-from", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { clearCommandUses: 80, compactCommandUses: 80 },
    });
    expect(result.score).toBe(100);
    expect(result.evidence[0]).toMatch(/capped from \d+%/);
  });

  it("Test 6: history-source contributes via MAX-merge (clear)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { clearCommandUses: 5 },
      historyInvocations: { clearCommandUses: 30 },
    });
    expect(result.score).toBe(30);
  });

  it("Test 7: /rewind no longer contributes to numerator (CCE-79)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { rewindCommandUses: 10 },
    });
    expect(result.score).toBe(0);
  });

  it("Test 8: zero-signal produces gap message", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: {},
    });
    expect(result.score).toBe(0);
    expect(result.gaps[0]).toMatch(
      /No \/clear or \/compact in any interactive session/,
    );
  });

  it("Test 9: realistic mixed input (author baseline)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 120,
        interactiveOrUnknownSessionsAnalyzed: 120,
        transcriptsScanned: true,
      },
      transcriptInvocations: {
        btwCommandUses: 39,
        clearCommandUses: 15,
        compactCommandUses: 8,
        rewindCommandUses: 0,
      },
    });
    expect(result.score).toBe(19);
    expect(result.evidence[0]).toMatch(/23 session-coverage hits across 120/);
    expect(result.evidence[0]).not.toMatch(/capped/);
  });

  it("Test 10: one counter at exactly denom (boundary — no cap suffix)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { clearCommandUses: 100 },
    });
    expect(result.score).toBe(100);
    expect(result.evidence[0]).not.toMatch(/capped/);
  });

  it("Test 11: partial coverage", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { clearCommandUses: 37 },
    });
    expect(result.score).toBe(37);
  });

  it("Test 12a: numerator excludes /btw and /rewind (CCE-79)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: {
        btwCommandUses: 100,
        rewindCommandUses: 100,
        clearCommandUses: 0,
        compactCommandUses: 0,
      },
    });
    expect(result.score).toBe(0);
  });

  it("Test 12b: /btw cumulative surfaces as evidence text (CCE-79)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { clearCommandUses: 5 },
      signalsSummary: { cliBtwUseCountAllTime: 42 },
    });
    expect(result.evidence[0]).toMatch(
      /Plus 42 all-time \/btw invocations \(cumulative, not in ratio\)/,
    );
  });

  it("Test 12c: /btw evidence text omitted when cliBtwUseCountAllTime is 0 (CCE-79)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { clearCommandUses: 5 },
      signalsSummary: { cliBtwUseCountAllTime: 0 },
    });
    expect(result.evidence[0]).not.toMatch(/Plus .* all-time \/btw/);
  });

  it("Test 12d: /clear + /compact in numerator (regression, CCE-79)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 10,
        interactiveOrUnknownSessionsAnalyzed: 10,
        transcriptsScanned: true,
      },
      transcriptInvocations: { clearCommandUses: 5, compactCommandUses: 3 },
    });
    expect(result.score).toBe(80);
  });

  it("Test 12e: cap behavior preserved on narrowed numerator (CCE-79)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 10,
        interactiveOrUnknownSessionsAnalyzed: 10,
        transcriptsScanned: true,
      },
      transcriptInvocations: { clearCommandUses: 15, compactCommandUses: 15 },
    });
    expect(result.score).toBe(100);
    expect(result.evidence[0]).toMatch(/capped from \d+%/);
  });

  it("Test 12f: rubric memory target is 60 (CCE-79)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const rubric = JSON.parse(
      readFileSync(resolve(__dirname, "../../app/data/rubric.json"), "utf8"),
    );
    const memDim = rubric.dimensions.find((d) => d.id === "memory");
    expect(memDim.target).toBe(60);
  });
});

describe("EXECUTION_SCORERS.customization (CCE-76)", () => {
  it("Test 12: perfect ratio", () => {
    const result = EXECUTION_SCORERS.customization({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { colorCommandUses: 100 },
    });
    expect(result.score).toBe(100);
  });

  it("Test 13: cap fires; evidence reports capped-from", () => {
    const result = EXECUTION_SCORERS.customization({
      insights: {
        interactiveSessionsAnalyzed: 10,
        interactiveOrUnknownSessionsAnalyzed: 10,
        transcriptsScanned: true,
      },
      transcriptInvocations: {
        colorCommandUses: 10,
        voiceCommandUses: 10,
        focusCommandUses: 10,
      },
    });
    expect(result.score).toBe(100);
    expect(result.evidence[0]).toMatch(/capped from \d+%/);
  });

  it("Test 14: zero-signal produces gap message", () => {
    const result = EXECUTION_SCORERS.customization({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: {},
    });
    expect(result.score).toBe(0);
    expect(result.gaps[0]).toMatch(/No \/color, \/voice, or \/focus/);
  });

  it("Test 15: realistic mixed input (author baseline)", () => {
    const result = EXECUTION_SCORERS.customization({
      insights: {
        interactiveSessionsAnalyzed: 120,
        interactiveOrUnknownSessionsAnalyzed: 120,
        transcriptsScanned: true,
      },
      transcriptInvocations: {
        colorCommandUses: 3,
        voiceCommandUses: 0,
        focusCommandUses: 1,
      },
    });
    expect(result.score).toBe(3);
  });
});

describe("EXECUTION_SCORERS universe contract (CCE-76)", () => {
  it("Test 16: memory + customization both expose __universe === 'interactive_or_unknown'", () => {
    expect(EXECUTION_SCORERS.memory.__universe).toBe("interactive_or_unknown");
    expect(EXECUTION_SCORERS.customization.__universe).toBe(
      "interactive_or_unknown",
    );
  });
});
