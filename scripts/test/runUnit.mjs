// Spawns vitest with V8 coverage and parses the resulting JSON summary.

import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Runs unit tests (everything except scripts/__tests__/integration) with V8 coverage.
export async function runUnitWithCoverage(repoRoot, { print = false } = {}) {
  await mkdir(join(repoRoot, "coverage"), { recursive: true });
  const resultsPath = join(repoRoot, "coverage", "vitest-unit.json");
  const args = [
    "vitest",
    "run",
    "--coverage",
    "--exclude=**/__tests__/integration/**",
    "--reporter=json",
    `--outputFile=${resultsPath}`,
  ];
  const start = Date.now();
  const exitCode = await spawnAndStream("npx", args, repoRoot, print);
  const durationMs = Date.now() - start;
  const tests = await readVitestJson(resultsPath);
  const coverage = await readCoverageSummary(join(repoRoot, "coverage", "coverage-summary.json"));
  return { durationMs, exitCode, tests, coverage };
}

// Runs integration tests only (real fs, tmp dirs, no coverage instrumentation needed).
export async function runIntegration(repoRoot, { print = false } = {}) {
  await mkdir(join(repoRoot, "coverage"), { recursive: true });
  const resultsPath = join(repoRoot, "coverage", "vitest-integration.json");
  const args = [
    "vitest",
    "run",
    "scripts/__tests__/integration",
    "--reporter=json",
    `--outputFile=${resultsPath}`,
  ];
  const start = Date.now();
  const exitCode = await spawnAndStream("npx", args, repoRoot, print);
  const durationMs = Date.now() - start;
  const tests = await readVitestJson(resultsPath);
  return { durationMs, exitCode, tests };
}

function spawnAndStream(cmd, args, cwd, print) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: print ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    if (!print) {
      child.stdout?.on("data", () => {});
      child.stderr?.on("data", () => {});
    }
    child.on("close", (code) => resolve(code ?? 0));
  });
}

async function readVitestJson(path) {
  if (!existsSync(path)) return { total: 0, passed: 0, failed: 0 };
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return {
      total: raw.numTotalTests ?? 0,
      passed: raw.numPassedTests ?? 0,
      failed: raw.numFailedTests ?? 0,
    };
  } catch {
    return { total: 0, passed: 0, failed: 0 };
  }
}

async function readCoverageSummary(path) {
  if (!existsSync(path)) return { lines: 0, branches: 0, functions: 0, statements: 0 };
  try {
    const summary = JSON.parse(await readFile(path, "utf8"));
    const t = summary.total || {};
    return {
      lines: t.lines?.pct ?? 0,
      branches: t.branches?.pct ?? 0,
      functions: t.functions?.pct ?? 0,
      statements: t.statements?.pct ?? 0,
    };
  } catch {
    return { lines: 0, branches: 0, functions: 0, statements: 0 };
  }
}

// Re-export for diagnostics in the orchestrator
export { spawnAndStream };
