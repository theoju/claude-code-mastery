import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSubstantive, detectTerminalSetup } from "../signals.mjs";

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
