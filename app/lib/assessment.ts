import { join } from "node:path";
import { readJson } from "./_read-json";

export type Tier =
  | "not-touched"
  | "starter"
  | "developing"
  | "solid"
  | "advanced";
export type Trend = "new" | "flat" | "improving" | "slipping";

export type Effort = "5min" | "15min" | "30min" | "1hr" | "2hr";

export interface NextAction {
  id: string;
  action: string;
  effort: Effort;
  requires?: string[];
  /**
   * Predicate evaluated against `signalsSummary`. When true, the action is
   * already done — filtered from priority lists and shown ✓ done on the
   * dimension page. Grammar: see evaluatePredicate.
   */
  satisfiedWhen?: string;
  /** Computed at load time from satisfiedWhen + signalsSummary. */
  satisfied?: boolean;
}

export interface RubricDimension {
  id: string;
  title: string;
  weight: number;
  target: number;
  rubricArea: string;
  borisTips: string;
  nextActions: NextAction[];
}

export interface ScoredDimension {
  id: string;
  // Normalized to per-dim target (rawScore / rawTarget × 100, clamped 0-100).
  // 100 = "you've hit the rubric's target for this dimension."
  score: number;
  rawScore: number;
  tier: Tier;
  evidence: string[];
  gaps: string[];
  executionScore: number | null;
  executionRawScore: number | null;
  executionEvidence: string[];
  executionGaps: string[];
  gapReason: string | null;
}

export interface Dimension
  extends Omit<RubricDimension, "target">, ScoredDimension {
  trend: Trend;
  summary: string;
  // After normalization, each dimension's effective target is 100. The raw
  // rubric target is preserved as `rawTarget` for display annotation.
  target: number;
  rawTarget: number;
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface ClaudeMdFile {
  path: string;
  score: number;
  grade: Grade;
  lineCount: number;
  ageDays: number;
  breakdown: {
    commands: number;
    architecture: number;
    patterns: number;
    conciseness: number;
    currency: number;
    actionability: number;
  };
  issues: string[];
}

export interface ClaudeMdRun {
  name: string;
  path: string;
  score: number | null;
  grade: Grade;
  files: ClaudeMdFile[];
  missing?: boolean;
  error?: string;
}

export type CriterionKey =
  | "commands"
  | "architecture"
  | "patterns"
  | "conciseness"
  | "currency"
  | "actionability";

export interface CriterionDef {
  key: CriterionKey;
  label: string;
  max: number;
}

export const CRITERIA: CriterionDef[] = [
  { key: "commands", label: "Commands/workflows", max: 20 },
  { key: "architecture", label: "Architecture clarity", max: 20 },
  { key: "patterns", label: "Non-obvious patterns", max: 15 },
  { key: "conciseness", label: "Conciseness", max: 15 },
  { key: "currency", label: "Currency", max: 15 },
  { key: "actionability", label: "Actionability", max: 15 },
];

export interface ClaudeMdSummary {
  targets: number;
  targetsScored: number;
  targetsMissing: number;
  targetsError: number;
  files: number;
  avgScore: number | null;
  avgGrade: Grade | null;
  distribution: Record<Grade, number>;
  avgBreakdown: Record<CriterionKey, number> | null;
}

export interface ClaudeMdReport {
  mode: "report-only";
  auditedAt: string;
  summary: ClaudeMdSummary;
  runs: ClaudeMdRun[];
}

export interface Insights {
  sessionsAnalyzed?: number;
  sessionsByKind?: {
    interactive_cli: number;
    sdk_orchestrated: number;
    observer: number;
    subagent: number;
    unknown: number;
  };
  interactiveSessionsAnalyzed?: number;
  [key: string]: unknown;
}

export interface Assessment {
  capturedAt: string;
  overall: number;
  targetOverall: number;
  executionOverall: number | null;
  user: string | null;
  dimensions: Dimension[];
  signalsSummary: Record<string, unknown>;
  insights: Insights | null;
  claudeMd: ClaudeMdReport | null;
}

// ---------------------------------------------------------------------------
// Predicate engine — satisfiedWhen DSL
// ---------------------------------------------------------------------------
// Canonical implementation lives in scripts/predicate.mjs so Node-side
// callers (run-assessment.mjs, etc.) and the Next.js dashboard share one
// source of truth. Do not duplicate — see app/lib/__tests__/predicate-passthrough.test.ts.
import { evaluatePredicate } from "../../scripts/predicate.mjs";
export { evaluatePredicate };

// ---------------------------------------------------------------------------

const DATA_DIR = join(process.cwd(), "app", "data");
const RUBRIC_PATH = join(DATA_DIR, "rubric.json");
const ASSESSMENT_PATH = join(DATA_DIR, "assessment.json");

const SUMMARIES: Record<string, string> = {
  automation:
    "Highest-leverage gap. You have the ecosystem's building blocks but may not have authored your own. Boris's 'if you do it 2×/day, turn it into a skill' rule compounds fastest here.",
  permissions:
    "You are trading safety for ergonomics if the dangerous-skip flag is on. Auto mode gives near-identical UX with a classifier backstop — strictly better.",
  "model-effort":
    "Settings tuned for 4.6-era defaults cost you reasoning depth on 4.7. Three small edits (xhigh, max-when-hard, compact window) align you with how the model was designed to run.",
  parallel:
    "Parallelism depends more on habit than tooling — spinning up multiple sessions by default rather than serializing work.",
  verification:
    "Boris calls verification the #1 tip for a reason. Tighten the closing ritual and you'll see measurable quality lift.",
  memory:
    "Memory discipline compounds. The knob worth turning is auto-compact window; the habit worth building is converting corrections into CLAUDE.md rules per project.",
  planning:
    "Planning infra is advanced when superpowers is installed. The remaining lift is behavioral: trust delegation over line-by-line guidance.",
  integrations:
    "Surface-area work is largely done. Close the last mile by installing CLIs the plugins depend on.",
  customization:
    "Baseline polish. Treat these as Friday-afternoon work unless parallel sessions make color-coding urgent.",
  scheduled:
    "The newest high-leverage features live here. Requires the permissions/auto-mode gap to be fixed first for full value.",
  remote:
    "iMessage is a good start. Everything else is optional unless you already work off-laptop.",
  learning:
    "Fully dialed in if explanatory mode is active. No action required beyond occasional use.",
};

export function tierFor(score: number): Tier {
  if (score >= 85) return "advanced";
  if (score >= 70) return "solid";
  if (score >= 55) return "developing";
  if (score >= 30) return "starter";
  return "not-touched";
}

export async function loadAssessment(): Promise<Assessment> {
  const rubric = (await readJson<{ dimensions: RubricDimension[] }>(
    RUBRIC_PATH,
  )) || {
    dimensions: [],
  };
  // Older assessment.json files may not have executionOverall or insights;
  // loader backfills via ?? null below to satisfy the strict in-memory type.
  const scored = await readJson<{
    capturedAt: string;
    overall: number;
    targetOverall: number;
    executionOverall?: number | null;
    user: string | null;
    scores: ScoredDimension[];
    trends: Record<string, Trend>;
    signalsSummary: Record<string, unknown>;
    insights?: Insights | null;
    claudeMd?: ClaudeMdReport | null;
  }>(ASSESSMENT_PATH);

  if (!scored) {
    return {
      capturedAt: new Date().toISOString(),
      overall: 0,
      targetOverall: 100,
      executionOverall: null,
      insights: null,
      user: null,
      dimensions: rubric.dimensions.map((d) => ({
        ...d,
        score: 0,
        rawScore: 0,
        target: 100,
        rawTarget: d.target,
        tier: "not-touched",
        trend: "new",
        evidence: [
          "No assessment.json yet — run /self-assessment or `node scripts/run-assessment.mjs`.",
        ],
        gaps: [],
        executionScore: null,
        executionRawScore: null,
        executionEvidence: [],
        executionGaps: [],
        gapReason: null,
        summary: SUMMARIES[d.id] || "",
      })),
      signalsSummary: {},
      claudeMd: null,
    };
  }

  const dimensions: Dimension[] = rubric.dimensions.map((d) => {
    const s = scored.scores.find((x) => x.id === d.id);
    const nextActions = d.nextActions.map((a) => ({
      ...a,
      satisfied: a.satisfiedWhen
        ? evaluatePredicate(a.satisfiedWhen, scored.signalsSummary)
        : false,
    }));
    return {
      ...d,
      nextActions,
      score: s?.score ?? 0,
      rawScore: s?.rawScore ?? 0,
      target: 100,
      rawTarget: d.target,
      tier: s ? tierFor(s.score) : "not-touched",
      trend: scored.trends[d.id] ?? "new",
      evidence: s?.evidence ?? [],
      gaps: s?.gaps ?? [],
      executionScore: s?.executionScore ?? null,
      executionRawScore: s?.executionRawScore ?? null,
      executionEvidence: s?.executionEvidence ?? [],
      executionGaps: s?.executionGaps ?? [],
      gapReason: s?.gapReason ?? null,
      summary: SUMMARIES[d.id] || "",
    };
  });

  return {
    capturedAt: scored.capturedAt,
    overall: scored.overall,
    targetOverall: scored.targetOverall,
    executionOverall: scored.executionOverall ?? null,
    user: scored.user,
    dimensions,
    signalsSummary: scored.signalsSummary,
    insights: scored.insights ?? null,
    claudeMd: scored.claudeMd ?? null,
  };
}

export function gradeColor(grade: Grade | null): string {
  switch (grade) {
    case "A":
      return "text-[color:var(--color-good)]";
    case "B":
      return "text-[color:var(--color-accent)]";
    case "C":
      return "text-[color:var(--color-warn)]";
    case "D":
    case "F":
      return "text-[color:var(--color-bad)]";
    default:
      return "text-[color:var(--color-mute)]";
  }
}

export interface OverallStats {
  byTier: Record<Tier, number>;
  priorityActions: Array<{
    dimensionId: string;
    title: string;
    action: NextAction;
    weight: number;
    deficit: number;
  }>;
}

// Δ ≥ 15 between Setup and Execution = "tools installed, not firing" diagnostic.
// Mirrors the EXECUTION_DELTA_HIGHLIGHT constant used by app/page.tsx.
const HEADLINE_DELTA_THRESHOLD = 15;

export interface HeadlineRead {
  strengthLabel: string;
  strengthDetails: string;
  weaknessLabel: string;
  weaknessDetails: string;
  closer: string;
}

export function deriveHeadline(assessment: Assessment): HeadlineRead {
  const ss = assessment.signalsSummary as {
    plugins?: number;
    personalAgents?: number;
    personalCommands?: number;
    personalSkills?: number;
    hookTotalCount?: number;
    effortLevel?: string;
    autoCompactWindow?: number;
    projectsWithMemory?: number;
  };
  const setup = assessment.overall;
  const exec = assessment.executionOverall;
  const delta = exec == null ? null : setup - exec;
  const setupTier = tierFor(setup);
  const execTier = exec == null ? null : tierFor(exec);

  const strengthLabel =
    setupTier === "advanced"
      ? "advanced on platform setup"
      : setupTier === "solid"
        ? "solid on platform setup"
        : `${setupTier} on platform setup`;

  const strengthBits: string[] = [];
  if (ss.plugins) strengthBits.push(`${ss.plugins} plugins`);
  if ((ss.hookTotalCount ?? 0) > 0)
    strengthBits.push(`${ss.hookTotalCount} configured hooks`);
  if ((ss.personalSkills ?? 0) > 0)
    strengthBits.push(`${ss.personalSkills} personal skills`);
  if ((ss.projectsWithMemory ?? 0) > 0)
    strengthBits.push(`memory across ${ss.projectsWithMemory} projects`);
  const advancedDims = assessment.dimensions
    .filter((d) => d.tier === "advanced")
    .map((d) => d.title.split("—")[0].trim().toLowerCase());
  if (advancedDims.length)
    strengthBits.push(`advanced ${advancedDims.slice(0, 2).join(" + ")}`);
  const strengthDetails = strengthBits.length
    ? `(${strengthBits.join(", ")})`
    : "";

  // Weakness: the dominant signal is either the Setup-vs-Execution gap or the
  // weakest setup dims. The gap wins when it's large — that's the diagnostic
  // case the rubric is built to flag.
  let weaknessLabel: string;
  let weaknessDetails: string;
  if (delta != null && delta >= HEADLINE_DELTA_THRESHOLD) {
    weaknessLabel = `${execTier} on observed practice`;
    const lowExecDims = assessment.dimensions
      .filter((d) => d.executionScore != null && d.executionScore < 50)
      .sort((a, b) => (a.executionScore ?? 0) - (b.executionScore ?? 0))
      .slice(0, 2)
      .map(
        (d) =>
          `${d.title.split("—")[0].trim().toLowerCase()} ${d.executionScore}/100`,
      );
    weaknessDetails = lowExecDims.length
      ? `— tools installed but under-firing in sessions: ${lowExecDims.join(", ")}`
      : `— tools installed but under-firing in sessions (Δ ${delta} between setup and execution)`;
  } else {
    const weakSetup = assessment.dimensions
      .filter((d) => d.tier === "starter" || d.tier === "not-touched")
      .sort((a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score))
      .slice(0, 2);
    if (weakSetup.length) {
      weaknessLabel = `${weakSetup[0].tier} on codified workflow`;
      const empties: string[] = [];
      if ((ss.personalCommands ?? 0) === 0) empties.push("commands");
      if ((ss.personalAgents ?? 0) === 0) empties.push("agents");
      if ((ss.personalSkills ?? 0) === 0) empties.push("skills");
      weaknessDetails = empties.length
        ? `— zero personal ${empties.join(" or ")}`
        : `— ${weakSetup.map((d) => d.title.split("—")[0].trim().toLowerCase()).join(" + ")} need attention`;
    } else {
      weaknessLabel = "developing on a few execution edges";
      weaknessDetails = "— small gaps in habit, not in tooling";
    }
  }

  // Closer: name the era-shift if effort/compact are still 4.6-era, otherwise
  // point at the single highest-leverage action.
  const era46 =
    (ss.effortLevel && ss.effortLevel !== "xhigh") || !ss.autoCompactWindow;
  const closer = era46
    ? `Carrying 4.6-era model settings (effort: ${ss.effortLevel ?? "unset"}) into the 4.7 era. The biggest wins are a handful of small configuration edits.`
    : "The biggest wins are habit shifts, not configuration — the platform is already where it needs to be.";

  return {
    strengthLabel,
    strengthDetails,
    weaknessLabel,
    weaknessDetails,
    closer,
  };
}

export function computeStats(dims: Dimension[]): OverallStats {
  const byTier: Record<Tier, number> = {
    "not-touched": 0,
    starter: 0,
    developing: 0,
    solid: 0,
    advanced: 0,
  };
  dims.forEach((d) => (byTier[d.tier] += 1));

  const priorityActions = dims
    .flatMap((d) =>
      d.nextActions.map((a) => ({
        dimensionId: d.id,
        title: d.title,
        action: a,
        weight: d.weight,
        deficit: d.target - d.score,
      })),
    )
    .filter((a) => a.deficit > 0)
    .filter((a) => !a.action.satisfied)
    .sort((a, b) => b.weight * b.deficit - a.weight * a.deficit)
    .slice(0, 6);

  return { byTier, priorityActions };
}

export function tierColor(tier: Tier): string {
  switch (tier) {
    case "advanced":
      return "text-[color:var(--color-good)]";
    case "solid":
      return "text-[color:var(--color-accent)]";
    case "developing":
      return "text-[color:var(--color-warn)]";
    case "starter":
      return "text-[color:var(--color-bad)]";
    case "not-touched":
      return "text-[color:var(--color-mute)]";
  }
}

export function tierLabel(tier: Tier): string {
  return tier.replace("-", " ");
}

export function trendGlyph(t: Trend): string {
  switch (t) {
    case "improving":
      return "↗";
    case "slipping":
      return "↘";
    case "flat":
      return "→";
    case "new":
      return "✦";
  }
}
