import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatherShipJournal, stageRanInEntry } from "../signals.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ship-journal-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeJournal(lines) {
  writeFileSync(join(dir, "journal.jsonl"), lines.join("\n"));
}

describe("gatherShipJournal", () => {
  it("returns zeros when journal file is missing", async () => {
    const r = await gatherShipJournal({
      journalPath: join(dir, "missing.jsonl"),
      now: new Date("2026-05-10T00:00:00Z"),
      lookbackDays: 14,
    });
    expect(r).toEqual({
      stage2Count: 0,
      simplifyStageCount: 0,
      totalRuns: 0,
      lastRunAt: null,
    });
  });

  it("counts stage===2 entries within lookback window", async () => {
    writeJournal([
      `{"ts":"2026-05-10T01:00:00Z","stage":2,"kind":"verify"}`,
      `{"ts":"2026-05-10T02:00:00Z","stage":2,"kind":"verify"}`,
      `{"ts":"2026-04-01T00:00:00Z","stage":2,"kind":"verify"}`,
      `{"ts":"2026-05-10T03:00:00Z","stage":1,"kind":"test"}`,
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.stage2Count).toBe(2);
  });

  it("counts outcome==='shipped' entries as totalRuns", async () => {
    writeJournal([
      `{"ts":"2026-05-10T01:00:00Z","outcome":"shipped","pr":1}`,
      `{"ts":"2026-05-10T02:00:00Z","outcome":"halted"}`,
      `{"ts":"2026-05-10T03:00:00Z","outcome":"shipped","pr":2}`,
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.totalRuns).toBe(2);
    expect(r.lastRunAt).toBe("2026-05-10T03:00:00Z");
  });

  it("skips malformed lines without throwing", async () => {
    writeJournal([
      `{"ts":"2026-05-10T01:00:00Z","stage":2}`,
      `not json`,
      ``,
      `{"ts":"2026-05-10T02:00:00Z","stage":2}`,
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.stage2Count).toBe(2);
  });

  // --- CCE-72 fixture tests ----------------------------------------------

  it("Test 1: singular entry.stage===3 counts toward simplifyStageCount", async () => {
    writeJournal([`{"ts":"2026-05-10T01:00:00Z","stage":3}`]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.simplifyStageCount).toBe(1);
    expect(r.stage2Count).toBe(0);
  });

  it("Test 2: legacy-numeric stages_run [0,1,2,3,4,5,6,7] counts both verify and simplify", async () => {
    writeJournal([
      `{"ts":"2026-05-10T01:00:00Z","outcome":"shipped","stages_run":[0,1,2,3,4,5,6,7]}`,
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.stage2Count).toBe(1);
    expect(r.simplifyStageCount).toBe(1);
  });

  it("Test 3: new-string stages_run counts both verify and simplify", async () => {
    writeJournal([
      `{"ts":"2026-05-10T01:00:00Z","outcome":"shipped","stages_run":["pre-flight","test","verify-agent","simplify","code-review","commit","push-pr","jira-update"]}`,
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.stage2Count).toBe(1);
    expect(r.simplifyStageCount).toBe(1);
  });

  it("Test 4: mixed-format journal sums correctly across all three formats", async () => {
    writeJournal([
      `{"ts":"2026-05-10T01:00:00Z","stage":2}`,
      `{"ts":"2026-05-10T02:00:00Z","outcome":"shipped","stages_run":[0,1,2,3]}`,
      `{"ts":"2026-05-10T03:00:00Z","outcome":"shipped","stages_run":["simplify"]}`,
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.stage2Count).toBe(2);
    expect(r.simplifyStageCount).toBe(2);
  });

  it("Test 5: regression — singular stage===2 entries continue to count", async () => {
    writeJournal([
      `{"ts":"2026-05-10T01:00:00Z","stage":2}`,
      `{"ts":"2026-05-10T02:00:00Z","stage":2}`,
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 14,
    });
    expect(r.stage2Count).toBe(2);
    expect(r.simplifyStageCount).toBe(0);
  });

  it("Test 6: entries outside the lookback window are excluded for both counters", async () => {
    writeJournal([
      `{"ts":"2026-04-01T00:00:00Z","stage":3}`,
      `{"ts":"2026-05-10T05:00:00Z","stage":3}`,
    ]);
    const r = await gatherShipJournal({
      journalPath: join(dir, "journal.jsonl"),
      now: new Date("2026-05-10T12:00:00Z"),
      lookbackDays: 30,
    });
    expect(r.simplifyStageCount).toBe(1);
  });
});

describe("stageRanInEntry", () => {
  it("matches singular entry.stage equal to legacy number", () => {
    expect(stageRanInEntry({ stage: 3 }, 3, "simplify")).toBe(true);
  });

  it("matches singular entry.stage===0 (pre-flight, falsy-but-valid)", () => {
    // Guards against a future refactor to `if (entry.stage)` truthy-check.
    expect(stageRanInEntry({ stage: 0 }, 0, "pre-flight")).toBe(true);
  });

  it("rejects singular entry.stage that does not equal legacy number", () => {
    expect(stageRanInEntry({ stage: 99 }, 3, "simplify")).toBe(false);
  });

  it("matches legacy-numeric stages_run array containing legacy number", () => {
    expect(stageRanInEntry({ stages_run: [0, 1, 3, 4] }, 3, "simplify")).toBe(
      true,
    );
  });

  it("matches new-string stages_run array containing new name", () => {
    expect(
      stageRanInEntry(
        { stages_run: ["test", "verify-agent", "simplify"] },
        3,
        "simplify",
      ),
    ).toBe(true);
  });

  it("rejects string '3' against integer 3 (type-strict includes)", () => {
    expect(stageRanInEntry({ stages_run: ["3"] }, 3, "simplify")).toBe(false);
  });

  it("returns false for null / non-object / missing-fields input without throwing", () => {
    expect(stageRanInEntry(null, 3, "simplify")).toBe(false);
    expect(stageRanInEntry(undefined, 3, "simplify")).toBe(false);
    expect(stageRanInEntry("not-an-object", 3, "simplify")).toBe(false);
    expect(stageRanInEntry({}, 3, "simplify")).toBe(false);
    expect(stageRanInEntry({ stages_run: "not-an-array" }, 3, "simplify")).toBe(
      false,
    );
  });
});
