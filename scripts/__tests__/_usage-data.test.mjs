import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  withinWindow,
  cutoffFromLookback,
  loadSessionMeta,
  loadFacetsMap,
  buildTranscriptIndex,
  scanTranscriptModes,
  classifySessionKind,
} from "../_usage-data.mjs";

let tmpHome;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "usage-data-test-"));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("cutoffFromLookback", () => {
  it("returns null for null lookback (full history)", () => {
    expect(cutoffFromLookback("2026-05-09T00:00:00Z", null)).toBeNull();
  });

  it("returns null for undefined lookback", () => {
    expect(cutoffFromLookback("2026-05-09T00:00:00Z", undefined)).toBeNull();
  });

  it("subtracts N days in ms from now", () => {
    const now = "2026-05-09T00:00:00Z";
    const cutoff = cutoffFromLookback(now, 7);
    expect(cutoff).toBe(Date.parse(now) - 7 * 86_400_000);
  });

  it("throws when now is unparseable", () => {
    expect(() => cutoffFromLookback("garbage", 7)).toThrow(/invalid now/);
  });
});

describe("withinWindow", () => {
  it("includes any time when cutoff is null (full history)", () => {
    expect(withinWindow("2020-01-01T00:00:00Z", null)).toBe(true);
  });

  it("includes timestamps at or after cutoff", () => {
    const cutoff = Date.parse("2026-05-01T00:00:00Z");
    expect(withinWindow("2026-05-09T00:00:00Z", cutoff)).toBe(true);
    expect(withinWindow("2026-05-01T00:00:00Z", cutoff)).toBe(true);
  });

  it("excludes timestamps before cutoff", () => {
    const cutoff = Date.parse("2026-05-01T00:00:00Z");
    expect(withinWindow("2026-04-30T23:59:59Z", cutoff)).toBe(false);
  });

  it("returns false for missing or unparseable startTime", () => {
    expect(withinWindow(null, 0)).toBe(false);
    expect(withinWindow("not-a-date", 0)).toBe(false);
  });
});

describe("loadSessionMeta", () => {
  it("returns [] when usage-data/session-meta is missing", async () => {
    expect(await loadSessionMeta(tmpHome)).toEqual([]);
  });

  it("loads valid session-meta JSONs and skips invalid ones", async () => {
    const dir = join(tmpHome, "usage-data", "session-meta");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "a.json"),
      JSON.stringify({ session_id: "a", start_time: "2026-05-01T00:00:00Z" }),
    );
    writeFileSync(join(dir, "broken.json"), "{not valid");
    writeFileSync(join(dir, "no-id.json"), JSON.stringify({ foo: "bar" }));

    const meta = await loadSessionMeta(tmpHome);
    expect(meta.map((m) => m.session_id)).toEqual(["a"]);
  });
});

describe("loadFacetsMap", () => {
  it("returns empty Map when facets dir is missing", async () => {
    const map = await loadFacetsMap(tmpHome);
    expect(map.size).toBe(0);
  });

  it("indexes facets by session_id", async () => {
    const dir = join(tmpHome, "usage-data", "facets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "a.json"),
      JSON.stringify({ session_id: "a", session_type: "multi_task" }),
    );
    writeFileSync(
      join(dir, "b.json"),
      JSON.stringify({ session_id: "b", session_type: "single" }),
    );

    const map = await loadFacetsMap(tmpHome);
    expect(map.get("a").session_type).toBe("multi_task");
    expect(map.get("b").session_type).toBe("single");
  });
});

describe("buildTranscriptIndex", () => {
  it("returns empty Map when projects/ is missing", async () => {
    const idx = await buildTranscriptIndex(tmpHome);
    expect(idx.size).toBe(0);
  });

  it("indexes one transcript per session_id", async () => {
    const projects = join(tmpHome, "projects");
    mkdirSync(join(projects, "p1"), { recursive: true });
    writeFileSync(join(projects, "p1", "sess-A.jsonl"), "");
    writeFileSync(join(projects, "p1", "sess-B.jsonl"), "");

    const idx = await buildTranscriptIndex(tmpHome);
    expect(idx.get("sess-A")).toContain("p1");
    expect(idx.get("sess-A")).toContain("sess-A.jsonl");
    expect(idx.size).toBe(2);
  });

  it("deduplicates a session_id appearing in multiple project dirs (first-wins)", async () => {
    // p-aaa is alphabetically first, so its copy of sess-X wins.
    const projects = join(tmpHome, "projects");
    mkdirSync(join(projects, "p-aaa"), { recursive: true });
    mkdirSync(join(projects, "p-zzz"), { recursive: true });
    writeFileSync(join(projects, "p-aaa", "sess-X.jsonl"), "");
    writeFileSync(join(projects, "p-zzz", "sess-X.jsonl"), "");

    const idx = await buildTranscriptIndex(tmpHome);
    expect(idx.get("sess-X")).toContain("p-aaa");
    expect(idx.get("sess-X")).not.toContain("p-zzz");
  });
});

describe("scanTranscriptModes", () => {
  let path;

  beforeEach(() => {
    path = join(tmpHome, "transcript.jsonl");
  });

  it("collects permissionMode, attributionSkill, worktree-state, and ★ Insight from a transcript", async () => {
    const lines = [
      JSON.stringify({ permissionMode: "auto" }),
      JSON.stringify({ permissionMode: "plan" }),
      JSON.stringify({ type: "worktree-state", id: "wt-1" }),
      JSON.stringify({ attributionSkill: "frontend-design" }),
      JSON.stringify({
        type: "assistant",
        content: "Some output ★ Insight ─── here",
      }),
    ];
    writeFileSync(path, lines.join("\n"));

    const r = await scanTranscriptModes(path);
    expect(r.modes.has("auto")).toBe(true);
    expect(r.modes.has("plan")).toBe(true);
    expect(r.hasWorktreeState).toBe(true);
    expect(r.skills.has("frontend-design")).toBe(true);
    expect(r.learningModeMatches).toBe(1);
  });

  it("ignores malformed lines and continues", async () => {
    const lines = [
      "{not json",
      JSON.stringify({ permissionMode: "auto" }),
      "",
      JSON.stringify({ permissionMode: "bypassPermissions" }),
    ];
    writeFileSync(path, lines.join("\n"));

    const r = await scanTranscriptModes(path);
    expect(r.modes.has("auto")).toBe(true);
    expect(r.modes.has("bypassPermissions")).toBe(true);
  });

  it("returns empty result for empty file", async () => {
    writeFileSync(path, "");
    const r = await scanTranscriptModes(path);
    expect(r.modes.size).toBe(0);
    expect(r.skills.size).toBe(0);
    expect(r.hasWorktreeState).toBe(false);
    expect(r.learningModeMatches).toBe(0);
  });

  it("only counts ★ Insight on assistant-typed entries", async () => {
    const lines = [
      JSON.stringify({ type: "user", content: "★ Insight is just text" }),
      JSON.stringify({
        type: "assistant",
        content: "★ Insight ─── real one",
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.learningModeMatches).toBe(1);
  });

  it("counts opus vs total assistant turns", async () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-opus-4-7" },
      }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-opus-4-7" },
      }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-haiku-4-5" },
      }),
      JSON.stringify({ type: "user" }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.assistantTurns).toBe(3);
    expect(r.opusAssistantTurns).toBe(2);
  });

  // Mode equivalents from skill invocations. The Planning Setup scorer already
  // credits the user for having superpowers (brainstorming, writing-plans,
  // executing-plans) — see score.mjs:288. The Execution scorer needs the
  // matching signal so a user whose planning ritual is `/superpowers:*`
  // doesn't score 0 just because they don't press shift+tab+enter.
  it("detects /superpowers:writing-plans as plan-mode-equivalent", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: {
          content:
            "<command-name>/superpowers:writing-plans</command-name> plan this",
        },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("plan")).toBe(true);
  });

  it("detects /superpowers:brainstorming as plan-mode-equivalent", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: {
          content: "<command-name>/superpowers:brainstorming</command-name>",
        },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("plan")).toBe(true);
  });

  it("detects /superpowers:executing-plans as plan-mode-equivalent", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: {
          content: "<command-name>/superpowers:executing-plans</command-name>",
        },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("plan")).toBe(true);
  });

  it("detects /superpowers:subagent-driven-development as plan-mode-equivalent", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: {
          content:
            "<command-name>/superpowers:subagent-driven-development</command-name>",
        },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("plan")).toBe(true);
  });

  it("detects /ultraplan as plan-mode-equivalent", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: "<command-name>/ultraplan</command-name>" },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("plan")).toBe(true);
  });

  it("detects planning skill markup without leading slash", async () => {
    // /btw audit showed some commands log without the leading slash.
    const lines = [
      JSON.stringify({
        type: "user",
        message: {
          content: "<command-name>superpowers:brainstorming</command-name>",
        },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("plan")).toBe(true);
  });

  it("does NOT add 'plan' mode for arbitrary skills", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: "<command-name>/superpowers:loop</command-name>" },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("plan")).toBe(false);
  });

  it("detects /thariq-skills as learning-mode-equivalent", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: "<command-name>/thariq-skills</command-name>" },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("learning")).toBe(true);
  });

  it("detects /boris as learning-mode-equivalent", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: "<command-name>/boris</command-name>" },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("learning")).toBe(true);
  });

  it("detects learning skill markup without leading slash", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: "<command-name>boris</command-name>" },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("learning")).toBe(true);
  });

  it("does NOT add 'learning' mode for arbitrary skills", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: "<command-name>/some-other-skill</command-name>" },
      }),
    ];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("learning")).toBe(false);
  });

  it("native permissionMode='plan' still works alongside skill detection", async () => {
    const lines = [JSON.stringify({ permissionMode: "plan" })];
    writeFileSync(path, lines.join("\n"));
    const r = await scanTranscriptModes(path);
    expect(r.modes.has("plan")).toBe(true);
  });
});

describe("classifySessionKind", () => {
  it("classifies a transcript under .../subagents/agent-*.jsonl as subagent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kind-"));
    const subDir = join(dir, "abc-session", "subagents");
    mkdirSync(subDir, { recursive: true });
    const path = join(subDir, "agent-deadbeef.jsonl");
    writeFileSync(path, "");
    expect(await classifySessionKind(path)).toBe("subagent");
  });

  it("classifies a transcript with entrypoint=cli as interactive_cli", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kind-"));
    const path = join(dir, "session.jsonl");
    writeFileSync(
      path,
      JSON.stringify({
        type: "user",
        entrypoint: "cli",
        userType: "external",
      }) + "\n",
    );
    expect(await classifySessionKind(path)).toBe("interactive_cli");
  });

  it("classifies entrypoint=claude-desktop as interactive_cli", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kind-"));
    const path = join(dir, "session.jsonl");
    writeFileSync(
      path,
      JSON.stringify({ type: "user", entrypoint: "claude-desktop" }) + "\n",
    );
    expect(await classifySessionKind(path)).toBe("interactive_cli");
  });

  it("classifies entrypoint=sdk-cli in observer-sessions dir as observer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kind-"));
    const projectDir = join(dir, "-Users-theo--claude-mem-observer-sessions");
    mkdirSync(projectDir, { recursive: true });
    const path = join(projectDir, "session.jsonl");
    writeFileSync(
      path,
      JSON.stringify({ type: "user", entrypoint: "sdk-cli" }) + "\n",
    );
    expect(await classifySessionKind(path)).toBe("observer");
  });

  it("classifies entrypoint=sdk-cli outside observer dir as sdk_orchestrated", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kind-"));
    const projectDir = join(dir, "-Users-theo-Projects-engineering-docs-agent");
    mkdirSync(projectDir, { recursive: true });
    const path = join(projectDir, "session.jsonl");
    writeFileSync(
      path,
      JSON.stringify({ type: "user", entrypoint: "sdk-cli" }) + "\n",
    );
    expect(await classifySessionKind(path)).toBe("sdk_orchestrated");
  });

  it("returns 'unknown' when no entrypoint is found within first 5 lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kind-"));
    const path = join(dir, "session.jsonl");
    writeFileSync(
      path,
      Array.from({ length: 5 }, (_, i) =>
        JSON.stringify({ type: "noise", n: i }),
      ).join("\n") + "\n",
    );
    expect(await classifySessionKind(path)).toBe("unknown");
  });

  it("returns 'unknown' for an empty file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kind-"));
    const path = join(dir, "session.jsonl");
    writeFileSync(path, "");
    expect(await classifySessionKind(path)).toBe("unknown");
  });
});
