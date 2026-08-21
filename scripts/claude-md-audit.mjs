// Deterministic CLAUDE.md auditor. Pure: (target) -> { score, grade, files[], issues[] }.
// Mirrors the claude-md-improver rubric (commands / architecture / patterns /
// conciseness / currency / actionability) with weights 20/20/15/15/15/15 = 100.
// commands = executable command LINES (not fenced-block count), with half-weight
// credit for commands in linked rule/doc files. See
// docs/superpowers/specs/2026-08-20-claude-md-commands-scorer-design.md
//
// Report-only: never writes to CLAUDE.md files. Designed to run headless from
// the morning launchd routine alongside the existing assessment scorer.

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";

const FILE_NAMES = new Set(["CLAUDE.md", ".claude.md", ".claude.local.md"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".turbo",
  ".vercel",
  ".cache",
]);
const STALE_DAYS = 90;
const FRESH_DAYS = 30;
const VERBOSE_LINES = 400;
const THIN_LINES = 15;
const MAX_DEPTH = 6;

// commands criterion: points per executable command line found in the file
// itself, and per line found in a linked rule/doc file (half weight, capped).
const OWN_COMMAND_POINTS = 4;
const LINKED_COMMAND_POINTS = 2;
const LINKED_COMMAND_CAP = 10;
const MAX_LINKED_DOCS = 25;
const MAX_LINKED_BYTES = 256 * 1024;

export function expandHome(p) {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

async function findClaudeMdFiles(root) {
  const found = [];
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) {
          queue.push({ dir: full, depth: depth + 1 });
        }
      } else if (e.isFile() && FILE_NAMES.has(e.name)) {
        found.push(full);
      }
    }
  }
  return found;
}

export function gradeFor(score) {
  if (score >= 90) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  return "F";
}

/**
 * Return the body text under a heading (everything until the next heading of
 * same or higher level, or EOF). Used to verify that "## Architecture" has
 * actual content beneath it, not just a bare heading.
 */
export function sectionBody(content, headingPattern) {
  const re = new RegExp(`^(#{1,6})\\s+(${headingPattern})\\b.*$`, "im");
  const m = content.match(re);
  if (!m) return null;
  const startLevel = m[1].length;
  const startIdx = m.index + m[0].length;
  const rest = content.slice(startIdx);
  const next = rest.match(new RegExp(`^#{1,${startLevel}}\\s`, "m"));
  const body = next ? rest.slice(0, next.index) : rest;
  return body.trim();
}

// Stale-version markers — if a CLAUDE.md still references these, it has rotted
// regardless of how recently the mtime was touched.
const STALE_VERSION_PATTERNS = [
  /\bClaude\s*3(\.\d+)?\b/i,
  /\bSonnet\s*3(\.\d+)?\b/i,
  /\bOpus\s*3(\.\d+)?\b/i,
  /\bclaude\.json\b/i, // legacy config file name
];

// A "specific reference" — backticks, file paths, or fenced code — proves a
// gotcha/notes entry isn't just generic prose.
const SPECIFIC_REF =
  /(`[^`]+`|\b[\w./-]+\.(?:js|ts|tsx|mjs|json|md|sh|py|go|rs)\b|\bnpm\s+\w+|\bgh\s+\w+|\bvitest\b)/;

// Tool tokens that mark a fenced line as an executable command. Deliberately
// broad — a Python-first repo documenting `uv run pytest` is as well-documented
// as a Node repo documenting `npm test`.
const TOOL_TOKEN =
  /\b(?:npm|pnpm|yarn|bun|npx|deno|node|cargo|go run|go test|python3?|pytest|uv|pip|poetry|make|next|vitest|jest|playwright|docker|docker-compose|kubectl|helm|terraform|vercel|gh|git|ruff|mypy|eslint|prettier|alembic|prefect|psql|curl)\b/;

/**
 * Count executable command LINES inside fenced blocks.
 *
 * Counting lines rather than fences is the whole point: consolidating three
 * command blocks into one well-organized block used to cost 14 of 20 points
 * with the content unchanged, which rewarded fragmentation over clarity.
 */
export function countCommandLines(content) {
  let inFence = false;
  let count = 0;
  for (const raw of String(content ?? "").split("\n")) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) continue;
    const line = raw.trim().replace(/^\$\s+/, "");
    if (!line || line.startsWith("#")) continue;
    if (TOOL_TOKEN.test(line)) count += 1;
  }
  return count;
}

// Markdown references to sibling docs, in the three syntaxes a CLAUDE.md uses:
// backticked path, markdown link, and @import.
const DOC_REF = /`([\w./@-]+\.md)`|\]\(([^)\s]+\.md)\)|(?:^|\s)@([\w./-]+\.md)\b/g;

/**
 * Relative `.md` paths referenced from a CLAUDE.md. External URLs are dropped;
 * resolution and existence checks happen in auditTarget (the I/O boundary).
 */
export function extractDocRefs(content) {
  const out = new Set();
  for (const m of String(content ?? "").matchAll(DOC_REF)) {
    const ref = m[1] || m[2] || m[3];
    if (!ref || /^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) continue;
    out.add(ref.replace(/^\.\//, ""));
  }
  return [...out];
}

/**
 * Sum command lines across the `.md` files a CLAUDE.md points at. Bounded:
 * inside the target root only, .md only, capped file count and size.
 */
export async function resolveLinkedCommands(claudeMdPath, root, content) {
  const refs = extractDocRefs(content);
  const seen = new Set();
  let lines = 0;
  let docs = 0;
  for (const ref of refs) {
    if (docs >= MAX_LINKED_DOCS) break;
    for (const base of [dirname(claudeMdPath), root]) {
      const full = resolve(base, ref);
      const rel = relative(root, full);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
      if (seen.has(full) || FILE_NAMES.has(basename(full))) continue;
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size > MAX_LINKED_BYTES) continue;
      seen.add(full);
      docs += 1;
      try {
        lines += countCommandLines(await readFile(full, "utf8"));
      } catch {
        /* unreadable — no credit, no crash */
      }
      break;
    }
  }
  return { linkedCommandLines: lines, linkedDocs: docs };
}

export function scoreFile(content, mtimeMs, now = Date.now(), opts = {}) {
  const lines = content.split("\n");
  const headings = lines.filter((l) => /^#{1,6}\s/.test(l));
  const ageDays = Math.max(0, (now - mtimeMs) / (1000 * 60 * 60 * 24));
  const issues = [];

  // commands (20): executable command LINES, plus half-weight credit for
  // commands living in linked rule/doc files. Extracting commands into
  // `.claude/rules/*.md` or `docs/*.md` is good practice and no longer zeroes
  // this score; it is still worth less than in-file commands, because an agent
  // reading only CLAUDE.md never sees them.
  const ownCommandLines = countCommandLines(content);
  const linkedCommandLines = Math.max(0, Number(opts.linkedCommandLines) || 0);
  const commands = Math.min(
    20,
    ownCommandLines * OWN_COMMAND_POINTS +
      Math.min(LINKED_COMMAND_CAP, linkedCommandLines * LINKED_COMMAND_POINTS)
  );
  if (commands < 10) {
    issues.push("commands: few executable commands (in file or linked docs)");
  }

  // architecture (20): explicit heading AND substantive body underneath.
  // An empty "## Architecture" heading no longer earns 20 points.
  const archHeadingPat =
    "architecture|structure|layout|directory|key files?|project structure";
  const archBody = sectionBody(content, archHeadingPat);
  let architecture;
  if (archBody && archBody.length >= 80) {
    architecture = 20;
  } else if (archBody) {
    architecture = 10;
    issues.push("architecture: section is thin (<80 chars of body)");
  } else if (headings.length >= 3) {
    architecture = 10;
  } else {
    architecture = 0;
  }
  if (architecture < 15) issues.push("architecture: no Architecture/Structure section");

  // non-obvious patterns (15): gotchas section must contain at least one
  // specific reference (backticks, file paths, or tooling commands). Generic
  // prose like "don't break things" no longer scores 15/15.
  const gotchaPat = "gotchas?|pitfalls?|caveats?|warnings?|notes?|conventions?";
  const gotchaBody = sectionBody(content, gotchaPat);
  let patterns;
  if (gotchaBody && SPECIFIC_REF.test(gotchaBody)) {
    patterns = 15;
  } else if (gotchaBody) {
    patterns = 8;
    issues.push("patterns: Gotchas section has no specific tool/file references");
  } else {
    patterns = 5;
  }
  if (patterns < 10) issues.push("patterns: no Gotchas/Notes section");

  // conciseness (15): penalize > VERBOSE_LINES; penalize very thin
  let conciseness = 15;
  if (lines.length > VERBOSE_LINES) {
    conciseness = 5;
    issues.push(`conciseness: ${lines.length} lines (>${VERBOSE_LINES})`);
  } else if (lines.length < THIN_LINES) {
    conciseness = 5;
    issues.push("conciseness: very thin");
  }

  // currency (15): mtime <= 30d -> 15, <= 90d -> 10, > 90d -> 0
  // Plus: stale version mentions cap currency at 5, regardless of mtime —
  // a freshly-touched file pointing at "Claude 3.5 Sonnet" is not current.
  let currency = ageDays <= FRESH_DAYS ? 15 : ageDays <= STALE_DAYS ? 10 : 0;
  const staleHits = STALE_VERSION_PATTERNS.filter((p) => p.test(content));
  if (staleHits.length > 0) {
    currency = Math.min(currency, 5);
    issues.push(
      `currency: stale version mentions (${staleHits.length}) — refresh model/config references`
    );
  }
  if (currency < 10) issues.push(`currency: last edited ${Math.round(ageDays)}d ago`);

  // actionability (15): bullet density relative to headings + imperative verb hits
  const bulletLines = lines.filter((l) => /^\s*[-*]\s/.test(l)).length;
  const imperatives = (content.match(/\b(run|use|prefer|avoid|never|always|don'?t|do not)\b/gi) || []).length;
  const actionability = Math.min(
    15,
    Math.round((bulletLines / Math.max(1, headings.length)) * 3) + Math.min(8, imperatives)
  );
  if (actionability < 8) issues.push("actionability: low imperative density");

  const score = commands + architecture + patterns + conciseness + currency + actionability;
  return {
    score,
    breakdown: { commands, architecture, patterns, conciseness, currency, actionability },
    issues,
    commandLines: ownCommandLines,
    linkedCommandLines,
    lineCount: lines.length,
    ageDays: Math.round(ageDays),
  };
}

export async function auditTarget({ name, path }) {
  const resolved = expandHome(path);
  if (!resolved || !existsSync(resolved)) {
    return { name: name || path, path: resolved, error: "path not found", files: [], score: null, grade: "F" };
  }
  const paths = await findClaudeMdFiles(resolved);
  const files = [];
  for (const p of paths) {
    let content, st;
    try {
      [content, st] = await Promise.all([readFile(p, "utf8"), stat(p)]);
    } catch {
      continue;
    }
    const { linkedCommandLines, linkedDocs } = await resolveLinkedCommands(p, resolved, content);
    const r = scoreFile(content, st.mtimeMs, Date.now(), { linkedCommandLines });
    files.push({ path: relative(resolved, p), ...r, linkedDocs, grade: gradeFor(r.score) });
  }
  if (files.length === 0) {
    return { name: name || path, path: resolved, missing: true, files: [], score: null, grade: "F" };
  }
  const avg = Math.round(files.reduce((a, f) => a + f.score, 0) / files.length);
  return { name: name || path, path: resolved, files, score: avg, grade: gradeFor(avg) };
}

export async function auditAll(targets = []) {
  return Promise.all(targets.map(auditTarget));
}

// Canonical criterion labels and weights. Ordered for display.
export const CRITERIA = [
  { key: "commands", label: "Commands/workflows", max: 20 },
  { key: "architecture", label: "Architecture clarity", max: 20 },
  { key: "patterns", label: "Non-obvious patterns", max: 15 },
  { key: "conciseness", label: "Conciseness", max: 15 },
  { key: "currency", label: "Currency", max: 15 },
  { key: "actionability", label: "Actionability", max: 15 },
];

// Project-detail-free aggregate over runs[]. Safe to print to Slack or share publicly.
// Counts unscoreable runs (missing CLAUDE.md, path errors) without naming them.
// Averages each rubric criterion across all scored files for a more meaningful headline.
export function summarize(runs = []) {
  const scoreable = runs.filter((r) => typeof r.score === "number");
  const missing = runs.filter((r) => r.missing).length;
  const errors = runs.filter((r) => r.error).length;
  const files = scoreable.flatMap((r) => r.files);
  const distribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const f of files) distribution[f.grade] = (distribution[f.grade] || 0) + 1;
  const avg = files.length
    ? Math.round(files.reduce((a, f) => a + f.score, 0) / files.length)
    : null;
  const avgBreakdown = files.length
    ? Object.fromEntries(
        CRITERIA.map(({ key }) => [
          key,
          Math.round(files.reduce((a, f) => a + (f.breakdown?.[key] ?? 0), 0) / files.length),
        ])
      )
    : null;
  return {
    targets: runs.length,
    targetsScored: scoreable.length,
    targetsMissing: missing,
    targetsError: errors,
    files: files.length,
    avgScore: avg,
    avgGrade: avg == null ? null : gradeFor(avg),
    distribution,
    avgBreakdown,
  };
}
