// Contract tests for the redesigned `commands` criterion of the CLAUDE.md
// auditor (CCE-161, docs/superpowers/specs/2026-08-20-claude-md-commands-scorer-design.md).
//
// Every expected point value below is derived by hand from the published
// formula, NOT read back out of the implementation:
//
//   commands = min(20, ownLines * 4 + min(10, linkedLines * 2))
//
// so own lines map 1→4, 2→8, 3→12, 4→16, 5+→20, and linked lines are worth
// half and saturate at 10 points (5+ linked lines).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  countCommandLines,
  extractDocRefs,
  resolveLinkedCommands,
  scoreFile,
  auditTarget,
} from "../claude-md-audit.mjs";

const NOW = new Date("2026-08-20T09:00:00.000Z").getTime();
const days = (n) => NOW - n * 24 * 60 * 60 * 1000;

/** A fenced bash block wrapping exactly the given lines. */
const fence = (...lines) => ["```bash", ...lines, "```"].join("\n");

/** A markdown doc whose single fenced block holds exactly `n` command lines. */
const docWithCommands = (n) =>
  [
    "# Doc",
    "",
    fence(...Array.from({ length: n }, (_, i) => `npm run task-${i}`)),
    "",
  ].join("\n");

// One fenced block, five commands.
const ONE_BLOCK_FIVE = [
  "# One block",
  "",
  fence(
    "npm install",
    "npm run dev",
    "npm test",
    "git status",
    "docker build .",
  ),
  "",
].join("\n");

// The exact same five commands, split across five fenced blocks.
const FIVE_BLOCKS_ONE = [
  "# Five blocks",
  "",
  "## Install",
  "",
  fence("npm install"),
  "",
  "## Dev",
  "",
  fence("npm run dev"),
  "",
  "## Test",
  "",
  fence("npm test"),
  "",
  "## Status",
  "",
  fence("git status"),
  "",
  "## Build",
  "",
  fence("docker build ."),
  "",
].join("\n");

const NO_COMMANDS = [
  "# Prose only",
  "",
  "This file documents nothing executable.",
  "",
].join("\n");

// > MAX_LINKED_BYTES (256 KB): 30000 * len("npm test\n") == 270000 bytes.
const HUGE_DOC = [
  "```bash",
  ...Array.from({ length: 30000 }, () => "npm test"),
  "```",
  "",
].join("\n");

describe("countCommandLines", () => {
  it("counts every command line inside a single fenced block", () => {
    expect(countCommandLines(ONE_BLOCK_FIVE)).toBe(5);
  });

  it("counts the same total when those commands are split across five blocks", () => {
    expect(countCommandLines(FIVE_BLOCKS_ONE)).toBe(5);
    expect(countCommandLines(FIVE_BLOCKS_ONE)).toBe(
      countCommandLines(ONE_BLOCK_FIVE),
    );
  });

  it("ignores comments, blanks, non-tool lines, and anything outside a fence", () => {
    const mixed = [
      "# Mixed",
      "",
      "Run npm test in CI.", // prose outside a fence — not a command line
      "",
      fence(
        "# install dependencies", // comment
        "npm install", // counts
        "", // blank
        "echo done", // no tool token
        "$ npm test", // prompt stripped, counts
      ),
      "",
      "More prose mentioning docker build.", // prose outside a fence
      "",
    ].join("\n");
    expect(countCommandLines(mixed)).toBe(2);
  });

  it("strips a leading `$ ` prompt before classifying the line", () => {
    expect(countCommandLines(fence("$ pytest -q"))).toBe(1);
    // A prompt alone doesn't make a line executable.
    expect(countCommandLines(fence("$ echo hi"))).toBe(0);
    // The discriminating case: a commented-out command behind a prompt is still
    // a comment, which only holds if the `$ ` is removed before the `#` test.
    expect(countCommandLines(fence("$ # npm install"))).toBe(0);
    expect(countCommandLines(fence("$ npm install", "$ # npm run dev"))).toBe(
      1,
    );
  });

  it("counts nothing when commands are not fenced", () => {
    expect(countCommandLines("# Doc\n\nnpm install\ngit status\n")).toBe(0);
    expect(countCommandLines("")).toBe(0);
  });

  it("recognizes non-Node toolchains", () => {
    expect(
      countCommandLines(
        fence("uv run pytest", "ruff check .", "kubectl get pods"),
      ),
    ).toBe(3);
  });
});

describe("extractDocRefs", () => {
  it("extracts backticked paths, markdown links, and @imports", () => {
    const content = [
      "# Refs",
      "",
      "See `docs/commands.md` for the full list.",
      "Also [the runbook](docs/runbook.md).",
      "@docs/imported.md",
      "Relative form: `./docs/relative.md`",
      "Not markdown: `scripts/run.sh`",
      "",
    ].join("\n");
    expect(extractDocRefs(content).sort()).toEqual(
      [
        "docs/commands.md",
        "docs/imported.md",
        "docs/relative.md",
        "docs/runbook.md",
      ].sort(),
    );
  });

  it("excludes external http(s) URLs even when they end in .md", () => {
    const content = [
      "[remote](https://example.com/docs/commands.md)",
      "[legacy](http://example.com/docs/old.md)",
      "[local](docs/local.md)",
    ].join("\n");
    expect(extractDocRefs(content)).toEqual(["docs/local.md"]);
  });

  it("dedupes repeated references regardless of syntax", () => {
    const content = "See `docs/a.md`, again `docs/a.md`, and [a](docs/a.md).";
    expect(extractDocRefs(content)).toEqual(["docs/a.md"]);
  });

  it("returns [] for content with no references", () => {
    expect(extractDocRefs(NO_COMMANDS)).toEqual([]);
    expect(extractDocRefs("")).toEqual([]);
  });
});

describe("scoreFile — commands formula", () => {
  // min(20, n * 4): 1→4, 2→8, 3→12, 4→16, 5→20, and clamped above that.
  it.each([
    [1, 4],
    [2, 8],
    [3, 12],
    [4, 16],
    [5, 20],
    [6, 20],
  ])("%i own command line(s) -> %i points", (n, expected) => {
    const r = scoreFile(docWithCommands(n), days(1), NOW);
    expect(r.commandLines).toBe(n);
    expect(r.breakdown.commands).toBe(expected);
  });

  it("scores one block of five commands identically to five blocks of one (regression)", () => {
    // Under the old fence-counting scorer the single-block form scored 1*7 = 7.
    const oneBlock = scoreFile(ONE_BLOCK_FIVE, days(1), NOW);
    const fiveBlocks = scoreFile(FIVE_BLOCKS_ONE, days(1), NOW);
    expect(oneBlock.commandLines).toBe(5);
    expect(fiveBlocks.commandLines).toBe(5);
    expect(oneBlock.breakdown.commands).toBe(20);
    expect(fiveBlocks.breakdown.commands).toBe(20);
    expect(oneBlock.breakdown.commands).toBe(fiveBlocks.breakdown.commands);
  });

  // min(10, n * 2) with zero own lines: 1→2, 3→6, 5→10, and capped beyond.
  it.each([
    [0, 0],
    [1, 2],
    [3, 6],
    [5, 10],
    [9, 10],
  ])(
    "%i linked command line(s) with no own commands -> %i points",
    (linked, expected) => {
      const r = scoreFile(NO_COMMANDS, days(1), NOW, {
        linkedCommandLines: linked,
      });
      expect(r.commandLines).toBe(0);
      expect(r.linkedCommandLines).toBe(linked);
      expect(r.breakdown.commands).toBe(expected);
    },
  );

  it("credits a CLAUDE.md with zero in-file commands that links to a doc with five", () => {
    const r = scoreFile(NO_COMMANDS, days(1), NOW, { linkedCommandLines: 5 });
    expect(r.breakdown.commands).toBe(10); // not 0 — extraction is rewarded, at half weight
    expect(r.issues.some((i) => i.startsWith("commands:"))).toBe(false);
  });

  // own*4 + min(10, linked*2), clamped to 20.
  it.each([
    [2, 6, 18], // 8 + min(10, 12) = 8 + 10
    [1, 2, 8], //  4 + min(10, 4)  = 4 + 4
    [4, 3, 20], // 16 + min(10, 6) = 22 -> clamped
    [3, 0, 12], // 12 + 0
  ])(
    "%i own + %i linked command lines -> %i points",
    (own, linked, expected) => {
      const r = scoreFile(docWithCommands(own), days(1), NOW, {
        linkedCommandLines: linked,
      });
      expect(r.breakdown.commands).toBe(expected);
    },
  );

  it("flags the commands issue only when the criterion lands under 10", () => {
    expect(
      scoreFile(docWithCommands(1), days(1), NOW).issues.some((i) =>
        i.startsWith("commands:"),
      ),
    ).toBe(true);
    expect(
      scoreFile(docWithCommands(3), days(1), NOW).issues.some((i) =>
        i.startsWith("commands:"),
      ),
    ).toBe(false);
  });

  it("stays backward compatible for 2- and 3-arg callers (linked lines default to 0)", () => {
    const three = docWithCommands(3);
    const threeArg = scoreFile(three, days(1), NOW);
    expect(threeArg.breakdown.commands).toBe(12);
    expect(threeArg.linkedCommandLines).toBe(0);
    // A 3-arg call must be indistinguishable from an explicit zero.
    expect(threeArg).toEqual(
      scoreFile(three, days(1), NOW, { linkedCommandLines: 0 }),
    );
    // 2-arg call (now defaults to Date.now()) still scores commands identically.
    expect(scoreFile(three, days(1)).breakdown.commands).toBe(12);
  });

  it("treats negative or non-numeric linkedCommandLines as zero", () => {
    expect(
      scoreFile(docWithCommands(1), days(1), NOW, { linkedCommandLines: -5 })
        .breakdown.commands,
    ).toBe(4);
    expect(
      scoreFile(docWithCommands(1), days(1), NOW, {
        linkedCommandLines: "nope",
      }).breakdown.commands,
    ).toBe(4);
  });
});

describe("resolveLinkedCommands", () => {
  let base;
  let root;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "cmd-audit-"));
    root = join(base, "resolve-root");
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(join(root, "sub"), { recursive: true });
    await mkdir(join(root, "nested"), { recursive: true });

    // Outside the audited root entirely.
    await writeFile(join(base, "outside.md"), docWithCommands(3));

    await writeFile(join(root, "docs", "commands.md"), docWithCommands(5));
    await writeFile(join(root, "docs", "short.md"), docWithCommands(2));
    await writeFile(join(root, "docs", "huge.md"), HUGE_DOC);
    for (let i = 0; i < 30; i += 1) {
      await writeFile(
        join(root, "docs", `d${String(i).padStart(2, "0")}.md`),
        docWithCommands(1),
      );
    }
    // CLAUDE.md-family files: real command content, but audited on their own.
    await writeFile(join(root, "sub", "CLAUDE.md"), docWithCommands(4));
    await writeFile(join(root, "sub", ".claude.md"), docWithCommands(4));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("sums command lines across referenced docs, resolved next to the CLAUDE.md", async () => {
    const r = await resolveLinkedCommands(
      join(root, "CLAUDE.md"),
      root,
      "See `docs/commands.md` and `docs/short.md`.",
    );
    expect(r).toEqual({ linkedCommandLines: 7, linkedDocs: 2 }); // 5 + 2
  });

  it("falls back to the target root when the ref isn't next to the CLAUDE.md", async () => {
    const r = await resolveLinkedCommands(
      join(root, "nested", "CLAUDE.md"),
      root,
      "See `docs/commands.md`.",
    );
    expect(r).toEqual({ linkedCommandLines: 5, linkedDocs: 1 });
  });

  it("ignores refs that escape the target root", async () => {
    // Sanity: the escaped file really does contain command lines.
    expect(
      countCommandLines(await readFile(join(base, "outside.md"), "utf8")),
    ).toBe(3);
    const r = await resolveLinkedCommands(
      join(root, "CLAUDE.md"),
      root,
      "See `../outside.md`.",
    );
    expect(r).toEqual({ linkedCommandLines: 0, linkedDocs: 0 });
  });

  it("ignores missing files without throwing", async () => {
    const r = await resolveLinkedCommands(
      join(root, "CLAUDE.md"),
      root,
      "See `docs/does-not-exist.md` and `docs/commands.md`.",
    );
    // The missing ref contributes nothing; the real one still counts.
    expect(r).toEqual({ linkedCommandLines: 5, linkedDocs: 1 });
  });

  it("ignores external URLs", async () => {
    const r = await resolveLinkedCommands(
      join(root, "CLAUDE.md"),
      root,
      "See [remote](https://example.com/docs/commands.md).",
    );
    expect(r).toEqual({ linkedCommandLines: 0, linkedDocs: 0 });
  });

  it("skips CLAUDE.md-family files, which are audited separately", async () => {
    // Sanity: those files really do contain command lines.
    expect(
      countCommandLines(await readFile(join(root, "sub", "CLAUDE.md"), "utf8")),
    ).toBe(4);
    const r = await resolveLinkedCommands(
      join(root, "CLAUDE.md"),
      root,
      "See `sub/CLAUDE.md` and `sub/.claude.md`.",
    );
    expect(r).toEqual({ linkedCommandLines: 0, linkedDocs: 0 });
  });

  it("stops after 25 linked docs", async () => {
    const content = Array.from(
      { length: 30 },
      (_, i) => `- \`docs/d${String(i).padStart(2, "0")}.md\``,
    ).join("\n");
    expect(extractDocRefs(content)).toHaveLength(30);
    const r = await resolveLinkedCommands(
      join(root, "CLAUDE.md"),
      root,
      content,
    );
    expect(r).toEqual({ linkedCommandLines: 25, linkedDocs: 25 }); // 1 command line each
  });

  it("skips files larger than 256 KB", async () => {
    // Sanity: the oversized file is full of command lines.
    expect(countCommandLines(HUGE_DOC)).toBe(30000);
    const r = await resolveLinkedCommands(
      join(root, "CLAUDE.md"),
      root,
      "See `docs/huge.md`.",
    );
    expect(r).toEqual({ linkedCommandLines: 0, linkedDocs: 0 });
  });
});

describe("auditTarget — linked-command wiring", () => {
  let base;
  let root;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "cmd-audit-target-"));
    root = join(base, "audit-root");
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(join(root, "docs", "commands.md"), docWithCommands(5));
    await writeFile(
      join(root, "CLAUDE.md"),
      [
        "# Audit fixture",
        "",
        "All commands live in `docs/commands.md`.",
        "",
      ].join("\n"),
    );
    await writeFile(join(root, "pkg", "CLAUDE.md"), ONE_BLOCK_FIVE);
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("credits linked docs and exposes the audit trail on each file", async () => {
    const result = await auditTarget({ name: "fixture", path: root });
    expect(result.files).toHaveLength(2);

    const linked = result.files.find((f) => f.path === "CLAUDE.md");
    expect(linked.commandLines).toBe(0);
    expect(linked.linkedCommandLines).toBe(5);
    expect(linked.linkedDocs).toBe(1);
    expect(linked.breakdown.commands).toBe(10); // 0*4 + min(10, 5*2)

    const own = result.files.find((f) => f.path === join("pkg", "CLAUDE.md"));
    expect(own.commandLines).toBe(5);
    expect(own.linkedCommandLines).toBe(0);
    expect(own.linkedDocs).toBe(0);
    expect(own.breakdown.commands).toBe(20); // 5*4, clamped at 20
  });
});
