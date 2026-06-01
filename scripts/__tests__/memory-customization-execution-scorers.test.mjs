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
      transcriptInvocations: { btwCommandUses: 100 },
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
      transcriptInvocations: { btwCommandUses: 80, clearCommandUses: 80 },
    });
    expect(result.score).toBe(100);
    expect(result.evidence[0]).toMatch(/capped from \d+%/);
  });

  it("Test 6: history-source contributes via MAX-merge (btw)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { btwCommandUses: 5 },
      historyInvocations: { btwCommandUses: 30 },
    });
    expect(result.score).toBe(30);
  });

  it("Test 7: rewind is transcript-only (HISTORY_COMMAND_LIST excludes it)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { rewindCommandUses: 10 },
      // historyInvocations.rewindCommandUses intentionally undefined
    });
    expect(result.score).toBe(10);
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
    expect(result.gaps[0]).toMatch(/No \/btw, \/clear, \/compact, or \/rewind/);
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
    expect(result.score).toBe(52);
    expect(result.evidence[0]).toMatch(/62 session-coverage hits across 120/);
    expect(result.evidence[0]).not.toMatch(/capped/);
  });

  it("Test 10: one counter at exactly denom (boundary — no cap suffix)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { btwCommandUses: 100 },
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
      transcriptInvocations: { btwCommandUses: 37 },
    });
    expect(result.score).toBe(37);
  });
});
