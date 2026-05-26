import Link from "next/link";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluatePredicate } from "@/app/lib/assessment";
import PageNav from "@/app/components/PageNav";

export const dynamic = "force-static";
export const metadata = {
  title: "Probes — Claude Code Self-Assessment",
};

type SourceKey =
  | "settings"
  | "filesystem"
  | "plugins"
  | "transcripts"
  | "history";

interface CatalogEntry {
  source: SourceKey;
  path: string;
  description: string;
}

interface RubricAction {
  id?: string;
  action: string;
  effort?: string;
  satisfiedWhen?: string;
}

interface RubricDimension {
  id: string;
  title: string;
  nextActions?: RubricAction[];
}

interface ProbeRow {
  dimId: string;
  actionId: string;
  actionText: string;
  predicate: string;
  signal: string;
  catalog: CatalogEntry | null;
  satisfied: boolean;
  currentValue: unknown;
}

// `axis` mirrors the probe tracker's taxonomy: P (config) for settings /
// filesystem / plugins, P* (behavior) for transcript- and history-derived
// usage signals. There is no E (Execution) source here — cooked-telemetry
// signals aren't predicate-backed, so they never appear as probes.
const SOURCE_META: Record<
  SourceKey,
  { title: string; blurb: string; order: number; axis: "P" | "P*" }
> = {
  settings: {
    title: "settings.json & CLI config",
    blurb:
      "Root-level config fields and derived booleans from hooks/permissions. Plus ~/.claude.json runtime state (MCP servers, browser/remote opt-ins).",
    order: 1,
    axis: "P",
  },
  filesystem: {
    title: "~/.claude filesystem",
    blurb:
      "Personal-assets filesystem scans of agents, commands, skills, and project memory.",
    order: 2,
    axis: "P",
  },
  plugins: {
    title: "Plugins & external tools",
    blurb:
      "enabledPlugins map (anchored regex match) plus PATH detection for external CLIs.",
    order: 3,
    axis: "P",
  },
  transcripts: {
    title: "Transcripts (projects/*/*.jsonl)",
    blurb:
      "Session-derived behavioral signals computed by scanning past assistant turns. Requires --include-transcripts.",
    order: 4,
    axis: "P*",
  },
  history: {
    title: "Shell command history (~/.claude/history.jsonl)",
    blurb:
      "Typed slash commands recorded by Claude Code. MAX-merged with transcript scans since /btw is side-channel and never lands in projects/*/*.jsonl.",
    order: 5,
    axis: "P*",
  },
};

function extractPrimarySignal(predicate: string): string {
  const firstAtom = predicate.split("&")[0].trim().replace(/^!/, "").trim();
  const opMatch = firstAtom.match(/^([a-zA-Z_]+)/);
  return opMatch ? opMatch[1] : firstAtom;
}

function loadJson<T>(relPath: string): T {
  return JSON.parse(
    readFileSync(join(process.cwd(), "app", "data", relPath), "utf8"),
  ) as T;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.length <= 3) return `[${v.join(", ")}]`;
    return `[${v.slice(0, 2).join(", ")}, …${v.length - 2} more]`;
  }
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 77) + "…" : v;
  return String(v);
}

export default function ProbesPage() {
  const rubric = loadJson<{ dimensions: RubricDimension[] }>("rubric.json");
  const assessment = loadJson<{
    capturedAt?: string;
    signalsSummary: Record<string, unknown>;
    insights?: {
      sessionsByKind?: {
        interactive_cli: number;
        sdk_orchestrated: number;
        observer: number;
        subagent: number;
        unknown: number;
      };
      interactiveSessionsAnalyzed?: number;
    } | null;
  }>("assessment.json");
  const insights = assessment.insights ?? null;
  const catalogRaw =
    loadJson<Record<string, CatalogEntry | object>>("probe-catalog.json");
  const catalog: Record<string, CatalogEntry> = Object.fromEntries(
    Object.entries(catalogRaw).filter(([k]) => !k.startsWith("_")),
  ) as Record<string, CatalogEntry>;

  const sig = assessment.signalsSummary;

  const probes: ProbeRow[] = [];
  let coachingCount = 0;
  for (const dim of rubric.dimensions) {
    for (const a of dim.nextActions ?? []) {
      if (!a.satisfiedWhen) {
        coachingCount += 1;
        continue;
      }
      const signal = extractPrimarySignal(a.satisfiedWhen);
      probes.push({
        dimId: dim.id,
        actionId: a.id ?? signal,
        actionText: a.action,
        predicate: a.satisfiedWhen,
        signal,
        catalog: catalog[signal] ?? null,
        satisfied: evaluatePredicate(a.satisfiedWhen, sig),
        currentValue: sig[signal],
      });
    }
  }

  const groups = new Map<SourceKey | "unclassified", ProbeRow[]>();
  for (const p of probes) {
    const key: SourceKey | "unclassified" = p.catalog?.source ?? "unclassified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const orderedSources: Array<SourceKey | "unclassified"> = [
    "settings",
    "filesystem",
    "plugins",
    "transcripts",
    "history",
    "unclassified",
  ];

  const totalSat = probes.filter((p) => p.satisfied).length;
  const captured = assessment.capturedAt
    ? new Date(assessment.capturedAt)
        .toISOString()
        .slice(0, 16)
        .replace("T", " ")
    : "unknown";

  return (
    <main className="max-w-[1200px] mx-auto px-8 py-12">
      <PageNav current="probes" />
      <header className="mb-12 border-b border-[color:var(--color-line)] pb-8">
        <div className="flex items-baseline gap-3 text-xs uppercase tracking-[0.15em] text-[color:var(--color-mute)] mb-3">
          <span>Claude Code Self-Assessment</span>
          <span>·</span>
          <span>Probes</span>
          <span>·</span>
          <span className="mono">
            {probes.length} checks · {Object.keys(SOURCE_META).length} sources
          </span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight mb-3">
          Every predicate, every signal.
        </h1>
        <p className="text-[color:var(--color-mute)] max-w-3xl leading-relaxed">
          {probes.length} predicate-backed checks across{" "}
          {Object.keys(SOURCE_META).length} data sources. Each next-action with
          a{" "}
          <span className="mono text-[color:var(--color-text)]">
            satisfiedWhen
          </span>{" "}
          predicate is a probe; the predicate evaluates against this run&apos;s{" "}
          <span className="mono text-[color:var(--color-text)]">
            signalsSummary
          </span>{" "}
          snapshot. Unpredicated actions ({coachingCount}) are behavioral
          coaching that can&apos;t be auto-detected.
        </p>
        <p className="text-xs text-[color:var(--color-mute)] max-w-3xl leading-relaxed mt-3">
          <span className="mono text-[color:var(--color-text)]">axis P</span>{" "}
          (config — settings / filesystem / plugins) ·{" "}
          <span className="mono text-[color:var(--color-text)]">axis P*</span>{" "}
          (behavior — transcripts / shell history). Both feed the{" "}
          <strong>Platform Setup</strong> score. Execution-axis signals (cooked
          telemetry) aren&apos;t predicate-backed and drive the dashboard radar,
          not this page.
        </p>
      </header>

      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm mb-12 border-b border-[color:var(--color-line)] pb-6">
        <Stat label="Probes satisfied">
          <strong className="text-[color:var(--color-good)]">{totalSat}</strong>
          <span className="text-[color:var(--color-mute)]">
            {" "}
            / {probes.length}
          </span>
        </Stat>
        <Stat label="Last assessed">
          <span className="mono text-xs">{captured} UTC</span>
        </Stat>
        <Stat label="Unpredicated">
          <strong>{coachingCount}</strong>
          <span className="text-[color:var(--color-mute)] text-xs">
            {" "}
            coaching actions
          </span>
        </Stat>
      </div>

      {insights?.sessionsByKind && (
        <section aria-labelledby="kinds-heading" className="mb-14">
          <div className="flex items-baseline gap-3 mb-2 border-b border-[color:var(--color-line)] pb-2">
            <span className="text-[color:var(--color-mute)] mono text-xs">
              §
            </span>
            <h2
              id="kinds-heading"
              className="text-base font-semibold tracking-tight"
            >
              Session kinds in window
            </h2>
            <span className="ml-auto mono text-xs text-[color:var(--color-mute)]">
              {insights.interactiveSessionsAnalyzed ??
                insights.sessionsByKind.interactive_cli}
              {" / "}
              {Object.values(insights.sessionsByKind).reduce(
                (a, b) => a + b,
                0,
              )}
              {" interactive"}
            </span>
          </div>
          <p className="text-xs text-[color:var(--color-mute)] mb-4 leading-relaxed max-w-3xl">
            Posture scorers (auto mode, plan mode, learning) divide by{" "}
            <span className="mono text-[color:var(--color-text)]">
              interactive_cli
            </span>{" "}
            only. Volume scorers (integrations, scheduled, remote) divide by all
            sessions. Surfacing the census here makes future telemetry drift
            self-diagnosable.
          </p>
          <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Object.entries(insights.sessionsByKind).map(([kind, count]) => (
              <div
                key={kind}
                className="bg-[color:var(--color-card,rgba(255,255,255,0.02))] border border-[color:var(--color-line)] rounded-sm px-3 py-2"
              >
                <dt className="mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-mute)] mb-1">
                  {kind}
                </dt>
                <dd className="mono text-2xl font-semibold tracking-tight">
                  {count}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {orderedSources.map((source) => {
        const rows = groups.get(source);
        if (!rows || rows.length === 0) return null;
        rows.sort((a, b) => a.signal.localeCompare(b.signal));
        const meta =
          source === "unclassified"
            ? {
                title: "Unclassified",
                blurb:
                  "These probes weren't found in app/data/probe-catalog.json. Add an entry keyed by the signal name to populate path + description.",
              }
            : SOURCE_META[source];
        const sat = rows.filter((r) => r.satisfied).length;
        const orderLabel =
          source === "unclassified" ? "?" : String(SOURCE_META[source].order);
        const axisLabel =
          source === "unclassified" ? null : SOURCE_META[source].axis;
        return (
          <section key={source} className="mb-14">
            <div className="flex items-baseline gap-3 mb-2 border-b border-[color:var(--color-line)] pb-2">
              <span className="text-[color:var(--color-mute)] mono text-xs">
                § {orderLabel}
              </span>
              <h2 className="text-base font-semibold tracking-tight">
                {meta.title}
              </h2>
              {axisLabel && (
                <span
                  className="mono text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 border border-[color:var(--color-line)] rounded-sm text-[color:var(--color-mute)]"
                  title={
                    axisLabel === "P"
                      ? "Platform Setup — config presence"
                      : "Platform Setup — transcript-derived behavior"
                  }
                >
                  axis {axisLabel}
                </span>
              )}
              <span className="ml-auto mono text-xs text-[color:var(--color-mute)]">
                <span
                  style={{
                    color:
                      sat === rows.length
                        ? "var(--color-good)"
                        : "var(--color-mute)",
                  }}
                >
                  {sat}
                </span>
                {" / "}
                {rows.length} satisfied
              </span>
            </div>
            <p className="text-xs text-[color:var(--color-mute)] mb-4 leading-relaxed max-w-3xl">
              {meta.blurb}
            </p>

            <ul className="grid grid-cols-1 gap-3">
              {rows.map((r) => (
                <ProbeCard key={`${r.dimId}-${r.actionId}`} row={r} />
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-mute)]">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function ProbeCard({ row }: { row: ProbeRow }) {
  const barColor = row.satisfied ? "var(--color-good)" : "var(--color-warn)";
  return (
    <li
      className="relative pl-4 pr-4 py-3 bg-[color:var(--color-card,rgba(255,255,255,0.02))] border border-[color:var(--color-line)] rounded-sm"
      style={{
        borderLeftWidth: "3px",
        borderLeftColor: barColor,
      }}
    >
      {/* Header row: signal · predicate · status · dim badge */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2">
        <span className="mono text-sm font-semibold tracking-tight">
          {row.signal}
        </span>
        <code className="mono text-xs text-[color:var(--color-mute)] bg-[color:var(--color-line)]/30 px-1.5 py-0.5 rounded-sm">
          {row.predicate}
        </code>
        <span
          className="text-xs font-semibold ml-auto"
          style={{ color: barColor }}
        >
          {row.satisfied ? "✓ satisfied" : "✗ not yet"}
        </span>
        <Link
          href={`/dimensions/${row.dimId}`}
          className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 border border-[color:var(--color-line)] rounded-sm text-[color:var(--color-accent)] hover:bg-[color:var(--color-line)]/30"
        >
          {row.dimId}
        </Link>
      </div>

      {/* Description */}
      {row.catalog?.description ? (
        <p className="text-sm leading-relaxed mb-3 text-[color:var(--color-text,#e5e7eb)]">
          {row.catalog.description}
        </p>
      ) : (
        <p className="text-sm leading-relaxed mb-3 text-[color:var(--color-warn)]">
          (no catalog entry for <span className="mono">{row.signal}</span> — add
          one to <span className="mono">app/data/probe-catalog.json</span>)
        </p>
      )}

      {/* Meta grid: source path · your value · action */}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 text-xs">
        <div className="space-y-1">
          {row.catalog?.path && (
            <div>
              <span className="text-[color:var(--color-mute)] uppercase tracking-[0.12em] text-[10px] mr-2">
                Source
              </span>
              <span className="mono text-[color:var(--color-mute)]">
                {row.catalog.path}
              </span>
            </div>
          )}
          <div>
            <span className="text-[color:var(--color-mute)] uppercase tracking-[0.12em] text-[10px] mr-2">
              Action
            </span>
            <span className="text-[color:var(--color-mute)] leading-snug">
              {row.actionText}
            </span>
          </div>
        </div>
        <div className="md:text-right md:min-w-[160px]">
          <span className="text-[color:var(--color-mute)] uppercase tracking-[0.12em] text-[10px] mr-2">
            Your value
          </span>
          <span className="mono font-semibold" style={{ color: barColor }}>
            {formatValue(row.currentValue)}
          </span>
        </div>
      </div>
    </li>
  );
}
