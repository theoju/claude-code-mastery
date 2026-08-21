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

  it("Test 5: cap fires when the union exceeds the denominator; evidence reports capped-from (CCE-163)", () => {
    // Under union semantics 80 + 80 no longer sums to 160 — max(80, 80) is 80,
    // which is below the denominator. The cap now guards against inconsistent
    // signals where the observed union itself exceeds the session count.
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: {
        clearCommandUses: 80,
        compactCommandUses: 80,
        memoryHygieneSessions: 150,
      },
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
      /No \/clear, \/compact, or memory-tool use in any interactive session/,
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
    // CCE-163: union, not sum. 15 /clear sessions and 8 /compact sessions may
    // overlap, so the defensible numerator is max(15, 8) = 15, not 23.
    // 15/120 = 12.5% -> 13.
    expect(result.score).toBe(13);
    expect(result.evidence[0]).toMatch(/15 of 120 interactive/);
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
      settings: { cliBtwUseCount: 42 },
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
      settings: { cliBtwUseCount: 0 },
    });
    expect(result.evidence[0]).not.toMatch(/Plus .* all-time \/btw/);
  });

  it("Test 12d: /clear ∪ /compact in numerator — union floor, not sum (CCE-79, revised CCE-163)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 10,
        interactiveOrUnknownSessionsAnalyzed: 10,
        transcriptsScanned: true,
      },
      transcriptInvocations: { clearCommandUses: 5, compactCommandUses: 3 },
    });
    // The 3 /compact sessions may be a subset of the 5 /clear sessions, so 5
    // is the tightest defensible floor: 5/10 = 50%. Summing to 8 would assert
    // an overlap fact the signals do not carry.
    expect(result.score).toBe(50);
  });

  it("Test 13: memory tooling alone lifts the score (CCE-163)", () => {
    // The whole point of the redesign: a user who manages context with a
    // knowledge graph instead of slash commands is no longer scored at zero.
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: {
        memoryToolSessionCount: 40,
        memoryHygieneSessions: 40,
      },
    });
    expect(result.score).toBe(40);
    expect(result.evidence[0]).toMatch(/memory tools 40/);
    expect(result.gaps).toHaveLength(0);
  });

  it("Test 14: a session using all three mechanisms counts once (CCE-163)", () => {
    // Union, not sum. One session with /clear + /compact + a memory tool
    // contributes 1 to a 10-session denominator, not 3.
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 10,
        interactiveOrUnknownSessionsAnalyzed: 10,
        transcriptsScanned: true,
      },
      transcriptInvocations: {
        clearCommandUses: 1,
        compactCommandUses: 1,
        memoryToolSessionCount: 1,
        memoryHygieneSessions: 1,
      },
    });
    expect(result.score).toBe(10);
  });

  it("Test 15: observed union wins when it exceeds every part (CCE-163)", () => {
    // Disjoint mechanisms: 5 /clear sessions and 4 tooling sessions with no
    // overlap give an observed union of 9, which must beat max(5, 4).
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: {
        clearCommandUses: 5,
        memoryToolSessionCount: 4,
        memoryHygieneSessions: 9,
      },
    });
    expect(result.score).toBe(9);
  });

  it("Test 16: every session managing context scores exactly 100, never more (CCE-163)", () => {
    const result = EXECUTION_SCORERS.memory({
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: {
        clearCommandUses: 100,
        compactCommandUses: 100,
        memoryToolSessionCount: 100,
        memoryHygieneSessions: 100,
      },
    });
    expect(result.score).toBe(100);
    expect(result.evidence[0]).not.toMatch(/capped/);
  });

  it("Test 17: auto-compact is evidence only — decision (A), CCE-163", () => {
    const base = {
      insights: {
        interactiveSessionsAnalyzed: 100,
        interactiveOrUnknownSessionsAnalyzed: 100,
        transcriptsScanned: true,
      },
      transcriptInvocations: { memoryHygieneSessions: 30 },
    };
    const without = EXECUTION_SCORERS.memory(base);
    const with_ = EXECUTION_SCORERS.memory({
      ...base,
      settings: { autoCompactWindow: 400000 },
    });
    // Same score: configuration must not move the ratio or the target, or two
    // users with identical behavior would score differently.
    expect(with_.score).toBe(without.score);
    expect(with_.evidence[0]).toMatch(
      /Auto-compact configured \(CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000\)/,
    );
    expect(without.evidence[0]).not.toMatch(/Auto-compact configured/);
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
