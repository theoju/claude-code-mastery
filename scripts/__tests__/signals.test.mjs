import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isSubstantive,
  detectTerminalSetup,
  detectCoworkDispatch,
  detectOpus47Awareness,
  detectBtwUseCount,
  detectPlanModeRecencyDays,
  detectSkillsUsedRecently,
} from "../signals.mjs";

let tmp;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "signals-test-"));
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function write(name, content) {
  const p = join(tmp, name);
  await writeFile(p, content, "utf8");
  return p;
}

describe("isSubstantive", () => {
  it("rejects an empty file", async () => {
    const p = await write("empty.md", "");
    expect(await isSubstantive(p)).toBe(false);
  });

  it("rejects a heading-only file", async () => {
    const p = await write("titles.md", "# Title\n## Subtitle\n### Another\n");
    expect(await isSubstantive(p)).toBe(false);
  });

  it("rejects frontmatter-only stubs", async () => {
    const p = await write(
      "frontmatter.md",
      "---\nname: stub\ndescription: x\n---\n",
    );
    expect(await isSubstantive(p)).toBe(false);
  });

  it("rejects a TODO placeholder", async () => {
    const p = await write("todo.md", "# Skill\nTODO write this\n");
    expect(await isSubstantive(p)).toBe(false);
  });

  it("rejects substantive prose with no action verbs", async () => {
    const p = await write(
      "prose.md",
      "Here is some lengthy text describing the philosophy of the universe and the cosmos in great detail without saying anything imperative.",
    );
    expect(await isSubstantive(p)).toBe(false);
  });

  it("accepts a real skill with body and an action verb", async () => {
    const p = await write(
      "real.md",
      "---\nname: ship\n---\n\n# Ship\n\nRun the test suite, then commit and push the result. Always verify in the browser before yielding.",
    );
    expect(await isSubstantive(p)).toBe(true);
  });

  it("accepts a command with imperative content", async () => {
    const p = await write(
      "command.md",
      "Use this command to deploy. Always run the smoke test first and never skip the verification step.",
    );
    expect(await isSubstantive(p)).toBe(true);
  });

  it("returns false for a non-existent path", async () => {
    expect(await isSubstantive(join(tmp, "does-not-exist.md"))).toBe(false);
  });
});

describe("detectTerminalSetup (tip 11)", () => {
  it("true when deepLinkTerminal is a non-empty string", () => {
    expect(detectTerminalSetup({ deepLinkTerminal: "iTerm" })).toBe(true);
  });
  it("true when optionAsMetaKeyInstalled is exactly true", () => {
    expect(detectTerminalSetup({ optionAsMetaKeyInstalled: true })).toBe(true);
  });
  it("false on empty/missing config", () => {
    expect(detectTerminalSetup({ deepLinkTerminal: "" })).toBe(false);
    expect(detectTerminalSetup({})).toBe(false);
    expect(detectTerminalSetup(null)).toBe(false);
  });
});

describe("cliConfig adoption detectors", () => {
  const NOW = Date.parse("2026-05-26T00:00:00.000Z");

  it("detectCoworkDispatch reads hasUsedAgentsFleet", () => {
    expect(detectCoworkDispatch({ hasUsedAgentsFleet: true })).toBe(true);
    expect(detectCoworkDispatch({ hasUsedAgentsFleet: false })).toBe(false);
    expect(detectCoworkDispatch({})).toBe(false);
    expect(detectCoworkDispatch(null)).toBe(false);
  });

  it("detectOpus47Awareness is true when release notes or launch seen", () => {
    expect(detectOpus47Awareness({ opus47LaunchSeenCount: 12 })).toBe(true);
    expect(detectOpus47Awareness({ unpinOpus47LaunchEffort: true })).toBe(true);
    expect(detectOpus47Awareness({ lastReleaseNotesSeen: "2.1.150" })).toBe(
      true,
    );
    expect(detectOpus47Awareness({})).toBe(false);
    expect(detectOpus47Awareness(null)).toBe(false);
  });

  it("detectBtwUseCount reads the counter, defaults 0", () => {
    expect(detectBtwUseCount({ btwUseCount: 36 })).toBe(36);
    expect(detectBtwUseCount({})).toBe(0);
    expect(detectBtwUseCount(null)).toBe(0);
  });

  it("detectPlanModeRecencyDays returns whole days since lastPlanModeUse", () => {
    const ts = "2026-05-23T00:00:00.000Z"; // 3 days before NOW
    expect(detectPlanModeRecencyDays({ lastPlanModeUse: ts }, NOW)).toBe(3);
    expect(detectPlanModeRecencyDays({}, NOW)).toBeNull();
    expect(detectPlanModeRecencyDays(null, NOW)).toBeNull();
  });

  it("detectSkillsUsedRecently counts skills used within 30 days", () => {
    const cfg = {
      skillUsage: {
        a: { lastUsedAt: "2026-05-20T00:00:00.000Z" }, // 6 days
        b: { lastUsedAt: "2026-03-01T00:00:00.000Z" }, // >30 days
        c: { lastUsedAt: "2026-05-25T00:00:00.000Z" }, // 1 day
      },
    };
    expect(detectSkillsUsedRecently(cfg, NOW)).toBe(2);
    expect(detectSkillsUsedRecently({}, NOW)).toBe(0);
    expect(detectSkillsUsedRecently(null, NOW)).toBe(0);
  });
});
