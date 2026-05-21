// Deterministic plans-directory auditor. Pure: (deps) -> { count, items }.
// Report-only: never moves files. Designed to run headless from the morning
// launchd routine alongside scripts/claude-md-audit.mjs.

import { readdir as fsReaddir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function realGitLog({ path }) {
  try {
    const out = execFileSync(
      "git",
      ["log", "main", "--format=%H %ct %s", "--", path],
      { cwd: ROOT, encoding: "utf-8" },
    );
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const idx1 = line.indexOf(" ");
        if (idx1 < 0) return null;
        const idx2 = line.indexOf(" ", idx1 + 1);
        if (idx2 < 0) return null;
        const ts = Number(line.slice(idx1 + 1, idx2));
        if (Number.isNaN(ts)) return null;
        return { sha: line.slice(0, idx1), ts, subject: line.slice(idx2 + 1) };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

const defaults = {
  plansDir: join(ROOT, "docs/superpowers/plans"),
  gitLog: realGitLog,
  readdir: fsReaddir,
  now: () => new Date(),
};

export async function auditPlans(deps = {}) {
  const { plansDir, gitLog, readdir, now } = { ...defaults, ...deps };

  let entries;
  try {
    entries = await readdir(plansDir);
  } catch {
    return { count: 0, items: [] };
  }

  const items = [];
  const nowMs = now().getTime();

  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const relPath = `docs/superpowers/plans/${name}`;
    const log = await gitLog({ path: relPath });
    if (log.length === 0) continue;

    // git log default order is reverse-chronological (newest first):
    //   log[0]              -> most recent commit (used for PR-number extraction)
    //   log[log.length - 1] -> oldest commit (used for first-appearance + age)
    const firstCommit = log[log.length - 1];
    const latestCommit = log[0];

    const prMatch = latestCommit.subject.match(/\(#(\d+)\)/);
    const prOrSha = prMatch ? `#${prMatch[1]}` : firstCommit.sha.slice(0, 7);

    const ageDays = Math.floor(
      (nowMs - firstCommit.ts * 1000) / (1000 * 60 * 60 * 24),
    );
    const ageLabel =
      ageDays === 0
        ? "today"
        : ageDays === 1
          ? "1 day ago"
          : `${ageDays} days ago`;

    items.push({ filename: name, prOrSha, ageDays, ageLabel });
  }

  items.sort((a, b) => b.ageDays - a.ageDays);
  return { count: items.length, items };
}

export function formatAuditReport(audit) {
  if (audit.count === 0) return "Plans audit: nothing to archive.";
  const lines = [
    "Plans audit (report-only):",
    `  Landed plans not yet archived: ${audit.count}`,
  ];
  const longestName = Math.max(...audit.items.map((i) => i.filename.length));
  for (const i of audit.items) {
    lines.push(
      `    ${i.filename.padEnd(longestName)}  ${i.prOrSha.padStart(6)}  ${i.ageLabel}`,
    );
  }
  return lines.join("\n");
}
