import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanHistoryJsonl } from "../_history-data.mjs";

let tmpDir;
let historyPath;

const COMMANDS = [
  "simplify",
  "btw",
  "voice",
  "clear",
  "compact",
  "fewer-permission-prompts",
  "loop",
  "focus",
  "schedule",
  "batch",
  "color",
];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "history-jsonl-"));
  historyPath = join(tmpDir, "history.jsonl");
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function entry({ display, sessionId, timestamp }) {
  return JSON.stringify({
    display,
    pastedContents: {},
    timestamp,
    project: "/tmp/x",
    sessionId,
  });
}

// Helper: ms epoch for a given ISO date
function ts(iso) {
  return new Date(iso).getTime();
}

describe("scanHistoryJsonl", () => {
  it("returns empty counts when history.jsonl is missing", async () => {
    const r = await scanHistoryJsonl({
      historyPath: join(tmpDir, "does-not-exist.jsonl"),
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackMs: 14 * 24 * 60 * 60 * 1000,
      commands: COMMANDS,
    });
    expect(r).toEqual({
      simplifyCommandUses: 0,
      btwCommandUses: 0,
      voiceCommandUses: 0,
      clearCommandUses: 0,
      compactCommandUses: 0,
      fewerPermsCommandUses: 0,
      loopCommandUses: 0,
      focusCommandUses: 0,
      scheduleCommandUses: 0,
      batchCommandUses: 0,
      colorCommandUses: 0,
    });
  });

  it("counts /btw sessions within lookback", async () => {
    writeFileSync(
      historyPath,
      [
        entry({
          display: "/btw one quick question",
          sessionId: "s1",
          timestamp: ts("2026-05-09T10:00:00Z"),
        }),
        entry({
          display: "/btw another thing",
          sessionId: "s2",
          timestamp: ts("2026-05-09T11:00:00Z"),
        }),
        entry({
          display: "hello not a command",
          sessionId: "s3",
          timestamp: ts("2026-05-09T12:00:00Z"),
        }),
      ].join("\n"),
    );
    const r = await scanHistoryJsonl({
      historyPath,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackMs: 14 * 24 * 60 * 60 * 1000,
      commands: COMMANDS,
    });
    expect(r.btwCommandUses).toBe(2);
  });

  it("deduplicates per session (3 /clear in one session = 1)", async () => {
    writeFileSync(
      historyPath,
      [
        entry({
          display: "/clear",
          sessionId: "s1",
          timestamp: ts("2026-05-09T10:00:00Z"),
        }),
        entry({
          display: "/clear",
          sessionId: "s1",
          timestamp: ts("2026-05-09T11:00:00Z"),
        }),
        entry({
          display: "/clear",
          sessionId: "s1",
          timestamp: ts("2026-05-09T12:00:00Z"),
        }),
      ].join("\n"),
    );
    const r = await scanHistoryJsonl({
      historyPath,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackMs: 14 * 24 * 60 * 60 * 1000,
      commands: COMMANDS,
    });
    expect(r.clearCommandUses).toBe(1);
  });

  it("respects timestamp cutoff (old entries excluded)", async () => {
    writeFileSync(
      historyPath,
      [
        entry({
          display: "/btw recent",
          sessionId: "recent",
          timestamp: ts("2026-05-09T10:00:00Z"),
        }),
        entry({
          display: "/btw ancient",
          sessionId: "ancient",
          timestamp: ts("2026-01-01T00:00:00Z"),
        }),
      ].join("\n"),
    );
    const r = await scanHistoryJsonl({
      historyPath,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackMs: 14 * 24 * 60 * 60 * 1000,
      commands: COMMANDS,
    });
    expect(r.btwCommandUses).toBe(1);
  });

  it("filters by exact command prefix (^/btw doesn't match /btw-other)", async () => {
    writeFileSync(
      historyPath,
      [
        entry({
          display: "/btw-other should not match",
          sessionId: "s1",
          timestamp: ts("2026-05-09T10:00:00Z"),
        }),
        entry({
          display: "/babysit-prs not /babysit",
          sessionId: "s2",
          timestamp: ts("2026-05-09T10:00:00Z"),
        }),
      ].join("\n"),
    );
    const r = await scanHistoryJsonl({
      historyPath,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackMs: 14 * 24 * 60 * 60 * 1000,
      commands: COMMANDS,
    });
    expect(r.btwCommandUses).toBe(0);
    expect(r.babysitLoopUses ?? 0).toBe(0);
  });

  it("skips malformed JSON lines gracefully", async () => {
    writeFileSync(
      historyPath,
      [
        "not json at all",
        entry({
          display: "/btw works",
          sessionId: "s1",
          timestamp: ts("2026-05-09T10:00:00Z"),
        }),
        "{broken",
        "",
        entry({
          display: "/simplify here",
          sessionId: "s2",
          timestamp: ts("2026-05-09T11:00:00Z"),
        }),
      ].join("\n"),
    );
    const r = await scanHistoryJsonl({
      historyPath,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackMs: 14 * 24 * 60 * 60 * 1000,
      commands: COMMANDS,
    });
    expect(r.btwCommandUses).toBe(1);
    expect(r.simplifyCommandUses).toBe(1);
  });

  it("does NOT map /babysit to babysitLoopUses (strict pairing preserved per V1.4)", async () => {
    writeFileSync(
      historyPath,
      [
        entry({
          display: "/babysit watch the PR",
          sessionId: "s1",
          timestamp: ts("2026-05-09T10:00:00Z"),
        }),
        entry({
          display: "/fewer-permission-prompts",
          sessionId: "s2",
          timestamp: ts("2026-05-09T10:00:00Z"),
        }),
      ].join("\n"),
    );
    const r = await scanHistoryJsonl({
      historyPath,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackMs: 14 * 24 * 60 * 60 * 1000,
      commands: COMMANDS,
    });
    expect(r.babysitLoopUses ?? 0).toBe(0);
    expect(r.fewerPermsCommandUses).toBe(1);
  });

  it("counts /color sessions — history is the only reliable source (client-side command lands as a system-type transcript entry; Boris tip 40)", async () => {
    writeFileSync(
      historyPath,
      [
        entry({
          display: "/color red",
          sessionId: "s1",
          timestamp: ts("2026-05-09T10:00:00Z"),
        }),
        entry({
          display: "/color blue",
          sessionId: "s2",
          timestamp: ts("2026-05-09T11:00:00Z"),
        }),
        // dedup: same session, two /color invocations → counts once
        entry({
          display: "/color orange",
          sessionId: "s3",
          timestamp: ts("2026-05-09T12:00:00Z"),
        }),
        entry({
          display: "/color green",
          sessionId: "s3",
          timestamp: ts("2026-05-09T13:00:00Z"),
        }),
        // hyphenated continuation must NOT match the bare command
        entry({
          display: "/color-scheme nope",
          sessionId: "s4",
          timestamp: ts("2026-05-09T14:00:00Z"),
        }),
      ].join("\n"),
    );
    const r = await scanHistoryJsonl({
      historyPath,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackMs: 14 * 24 * 60 * 60 * 1000,
      commands: COMMANDS,
    });
    // s1, s2, s3 (deduped) → 3; s4 (/color-scheme) excluded; args stripped
    expect(r.colorCommandUses).toBe(3);
  });

  it("strips plugin prefix from /plugin:cmd form", async () => {
    writeFileSync(
      historyPath,
      [
        entry({
          display: "/superpowers:focus things",
          sessionId: "s1",
          timestamp: ts("2026-05-09T10:00:00Z"),
        }),
      ].join("\n"),
    );
    const r = await scanHistoryJsonl({
      historyPath,
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackMs: 14 * 24 * 60 * 60 * 1000,
      commands: COMMANDS,
    });
    expect(r.focusCommandUses).toBe(1);
  });
});
