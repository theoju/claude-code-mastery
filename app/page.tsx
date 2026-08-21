import Link from "next/link";
import PageNav from "@/app/components/PageNav";
import RadarChart from "@/app/components/RadarChart";
import ClaudeMdHealth from "@/app/components/ClaudeMdHealth";
import InsightsNarrativeSection from "@/app/components/InsightsNarrative";
import {
  loadAssessment,
  computeStats,
  deriveHeadline,
  tierColor,
  tierLabel,
  tierFor,
  trendGlyph,
} from "@/app/lib/assessment";
import {
  loadInsightsNarrative,
  detectInsightsReportFile,
} from "@/app/lib/insights-narrative";
import { borisTipLink, parseBorisTipList } from "@/app/lib/boris-tips";

export const dynamic = "force-dynamic";

// Δ ≥ 15 surfaces the diagnostic case (config ahead of habits) without firing
// for normal scoring noise. Both axes are 0–100, so 15 ≈ a tier-and-a-half gap
// in the rubric — small enough to catch genuine misalignment, large enough to
// stay quiet when scores are within natural variance.
const EXECUTION_DELTA_HIGHLIGHT = 15;

export default async function Page() {
  const [assessment, insightsNarrative] = await Promise.all([
    loadAssessment(),
    loadInsightsNarrative(),
  ]);
  const insightsReportFile = detectInsightsReportFile();
  const dims = assessment.dimensions;
  const stats = computeStats(dims);
  const headline = deriveHeadline(assessment);
  const executionDelta =
    assessment.executionOverall == null
      ? null
      : assessment.overall - assessment.executionOverall;
  const executionMeasured = dims.filter((d) => d.executionScore != null).length;
  // Surface the gap when Setup says auto but Execution measures otherwise —
  // diagnostic only, never scored; preserves the two-axis independence rule.
  const platformDefaultMode =
    (assessment.signalsSummary as { permissionsDefaultMode?: string | null })
      ?.permissionsDefaultMode ?? null;
  const permissionsDim = dims.find((d) => d.id === "permissions");
  const executionPermissionsScore = permissionsDim?.executionScore ?? null;
  const showAutoModeMystery =
    platformDefaultMode === "auto" &&
    executionPermissionsScore != null &&
    executionPermissionsScore < 50;
  const sorted = [...dims].sort(
    (a, b) => b.weight * (b.target - b.score) - a.weight * (a.target - a.score),
  );
  const strengths = [...dims]
    .filter((d) => d.score >= 80)
    .sort((a, b) => b.score - a.score);
  const needsWork = [...dims]
    .filter((d) => d.target - d.score >= 25)
    .sort(
      (a, b) =>
        b.weight * (b.target - b.score) - a.weight * (a.target - a.score),
    );
  const notTouched = dims.filter((d) => d.score < 50);
  const capturedDate = assessment.capturedAt.slice(0, 10);
  const headerName = assessment.user ? `${assessment.user}'s` : "Your";

  return (
    <main className="max-w-[1200px] mx-auto px-8 py-12">
      <PageNav current="dashboard" />
      <header className="mb-12 border-b border-[color:var(--color-line)] pb-8">
        <div className="flex items-baseline gap-3 text-xs uppercase tracking-[0.15em] text-[color:var(--color-mute)] mb-3">
          <span>Claude Code Self-Assessment</span>
          <span>·</span>
          <span>Personal Assessment</span>
          <span>·</span>
          <span className="mono">{capturedDate}</span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight mb-3">
          {headerName} Claude Code execution, scored.
        </h1>
        <p className="text-[color:var(--color-mute)] max-w-3xl leading-relaxed">
          Compared against Boris Cherny&apos;s 87 workflow tips
          (howborisusesclaudecode.com) and the Claude Code Self-Assessment
          rubric. Scoring is evidence-based — signals pulled from
          <span className="mono text-[color:var(--color-text)]">
            {" "}
            ~/.claude/settings.json
          </span>
          , installed plugins, custom agents/commands/skills directories,
          project memory, and the local{" "}
          <span className="mono text-[color:var(--color-text)]">
            /insights
          </span>{" "}
          telemetry under{" "}
          <span className="mono text-[color:var(--color-text)]">
            ~/.claude/usage-data/
          </span>
          .
        </p>
      </header>

      <section className="grid grid-cols-12 gap-10 mb-16">
        <div className="col-span-12 md:col-span-7">
          <RadarChart
            dimensions={dims}
            showExecution={assessment.executionOverall != null}
          />
          <div className="flex items-center gap-6 text-xs text-[color:var(--color-mute)] mt-4 justify-center flex-wrap">
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm bg-[color:var(--color-good)] opacity-70" />{" "}
              Platform Setup
            </span>
            {assessment.executionOverall != null && (
              <span className="inline-flex items-center gap-2">
                <span className="w-3 h-0.5 bg-[color:var(--color-warn)] border-t border-dashed border-[color:var(--color-warn)]" />{" "}
                Execution
              </span>
            )}
            <span className="inline-flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[color:var(--color-accent)]" />{" "}
              Target
            </span>
          </div>
          {assessment.executionOverall != null &&
            (() => {
              const unmeasured = dims.filter((d) => d.executionScore == null);
              if (unmeasured.length === 0) return null;
              const labels = unmeasured
                .map((d) => d.title.split(" — ")[0].split("&")[0].trim())
                .join(" · ");
              return (
                <div className="text-[11px] italic text-[color:var(--color-mute)] mt-2 text-center max-w-2xl mx-auto opacity-75">
                  <span className="not-italic mr-1">(1)</span>
                  Execution unmeasured ({unmeasured.length} dim
                  {unmeasured.length === 1 ? "" : "s"}): {labels} —{" "}
                  <Link
                    href="/methodology"
                    className="underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-accent)]"
                  >
                    why?
                  </Link>
                </div>
              );
            })()}
        </div>

        <div className="col-span-12 md:col-span-5 flex flex-col justify-center">
          <div className="mb-6">
            <div className="text-xs uppercase tracking-wider text-[color:var(--color-mute)] mb-3">
              Self-assessment snapshot — two axes
            </div>
            <div className="grid grid-cols-2 gap-4">
              <SnapshotTile
                label="Platform Setup"
                tone="good"
                score={assessment.overall}
                denom={100}
                sublabel="Config + surface area"
              />
              <SnapshotTile
                label="Execution"
                tone="warn"
                score={assessment.executionOverall}
                denom={100}
                sublabel={
                  assessment.executionOverall == null
                    ? "No /insights data yet"
                    : `Habits across ${executionMeasured}/${dims.length} dims`
                }
              />
            </div>
            {executionDelta != null && (
              <div
                className={`mt-3 text-xs ${
                  executionDelta >= EXECUTION_DELTA_HIGHLIGHT
                    ? "text-[color:var(--color-warn)]"
                    : "text-[color:var(--color-mute)]"
                }`}
              >
                Δ {executionDelta} —{" "}
                {executionDelta >= EXECUTION_DELTA_HIGHLIGHT
                  ? "your config is ahead of your habits."
                  : "platform setup and execution roughly aligned."}
                {executionDelta >= EXECUTION_DELTA_HIGHLIGHT && (
                  <>
                    {" "}
                    <Link
                      href="/methodology"
                      className="underline decoration-dotted underline-offset-2"
                    >
                      Why two axes?
                    </Link>
                  </>
                )}
              </div>
            )}
            {showAutoModeMystery && (
              <aside
                aria-label="Auto-mode sanity check"
                className="mt-3 rounded-md border border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/5 p-3 text-xs leading-relaxed text-[color:var(--color-text)]"
              >
                Setup says auto mode is configured, but Execution measures{" "}
                <span className="mono">{executionPermissionsScore} / 100</span>{" "}
                on permissions. Check the{" "}
                <Link
                  href="/methodology/probes#kinds-heading"
                  className="underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-accent)]"
                >
                  session-kind census
                </Link>{" "}
                — if most sessions are{" "}
                <span className="mono">sdk_orchestrated</span> or{" "}
                <span className="mono">observer</span>, the interactive-only
                denominator already filters them. Otherwise, your interactive
                sessions may not be running in auto mode.
              </aside>
            )}
          </div>

          <div className="grid grid-cols-5 gap-2 mb-8 text-center text-xs">
            {(
              [
                "advanced",
                "solid",
                "developing",
                "starter",
                "not-touched",
              ] as const
            ).map((t) => (
              <div
                key={t}
                className="bg-[color:var(--color-panel)] border border-[color:var(--color-line)] rounded-lg py-3"
              >
                <div className={`text-2xl font-semibold ${tierColor(t)}`}>
                  {stats.byTier[t]}
                </div>
                <div className="text-[color:var(--color-mute)] uppercase tracking-wide text-[10px] mt-1">
                  {tierLabel(t)}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-[color:var(--color-panel)] border border-[color:var(--color-line)] rounded-xl p-5">
            <div className="text-xs uppercase tracking-wider text-[color:var(--color-mute)] mb-3">
              Headline read
            </div>
            <p className="text-sm leading-relaxed">
              You are{" "}
              <span className="text-[color:var(--color-accent)] font-medium">
                {headline.strengthLabel}
              </span>
              {headline.strengthDetails ? ` ${headline.strengthDetails}` : ""}{" "}
              but{" "}
              <span className="text-[color:var(--color-bad)] font-medium">
                {headline.weaknessLabel}
              </span>{" "}
              {headline.weaknessDetails}. {headline.closer}
            </p>
          </div>
        </div>
      </section>

      <section className="mb-16">
        <h2 className="text-lg uppercase tracking-[0.15em] text-[color:var(--color-mute)] mb-6">
          Top priority actions — highest impact × weight first
        </h2>
        <ol className="space-y-3">
          {stats.priorityActions.map((a, i) => (
            <li
              key={i}
              className="flex items-start gap-4 bg-[color:var(--color-panel)] border border-[color:var(--color-line)] rounded-lg p-4"
            >
              <span className="mono text-[color:var(--color-accent)] text-sm w-6 shrink-0 pt-0.5">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wider text-[color:var(--color-mute)] mb-1">
                  {a.title} · weight {a.weight} · −{a.deficit} pts gap
                </div>
                <div className="text-sm">
                  <LinkifyBoris text={a.action.action} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <InsightsNarrativeSection
        narrative={insightsNarrative}
        reportFile={insightsReportFile}
      />

      {assessment.claudeMd && <ClaudeMdHealth report={assessment.claudeMd} />}

      <section className="grid md:grid-cols-3 gap-6 mb-16">
        <Panel title="Strengths — keep running these" tone="good">
          <ul className="space-y-2 text-sm">
            {strengths.map((d) => (
              <li key={d.id} className="list-none p-0">
                <Link
                  href={`/dimensions/${d.id}`}
                  className="flex items-baseline gap-2 hover:text-[color:var(--color-accent)] transition-colors"
                >
                  <span className="mono text-xs text-[color:var(--color-mute)] w-10">
                    {d.score}
                  </span>
                  <span>{d.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Needs focus — real gap, real leverage" tone="warn">
          <ul className="space-y-2 text-sm">
            {needsWork.map((d) => (
              <li key={d.id} className="list-none p-0">
                <Link
                  href={`/dimensions/${d.id}`}
                  className="flex items-baseline gap-2 hover:text-[color:var(--color-accent)] transition-colors"
                >
                  <span className="mono text-xs text-[color:var(--color-bad)] w-10">
                    −{d.target - d.score}
                  </span>
                  <span>{d.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Barely touched" tone="bad">
          <ul className="space-y-2 text-sm">
            {notTouched.map((d) => (
              <li key={d.id} className="list-none p-0">
                <Link
                  href={`/dimensions/${d.id}`}
                  className="flex items-baseline gap-2 hover:text-[color:var(--color-accent)] transition-colors"
                >
                  <span className="mono text-xs text-[color:var(--color-mute)] w-10">
                    {d.score}
                  </span>
                  <span>{d.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <section>
        <h2 className="text-lg uppercase tracking-[0.15em] text-[color:var(--color-mute)] mb-6">
          Detailed readout — 12 dimensions, sorted by leverage × gap
        </h2>
        <div className="space-y-6">
          {sorted.map((d) => (
            <article
              key={d.id}
              className="bg-[color:var(--color-panel)] border border-[color:var(--color-line)] rounded-xl p-6"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-xl font-semibold">
                    <Link
                      href={`/dimensions/${d.id}`}
                      className="hover:text-[color:var(--color-accent)] transition-colors"
                    >
                      {d.title}
                    </Link>
                  </h3>
                  <div className="text-xs text-[color:var(--color-mute)] mt-1">
                    Rubric: {d.rubricArea} · Boris{" "}
                    <BorisTips csv={d.borisTips} />
                  </div>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="text-sm text-[color:var(--color-mute)]">
                    weight ×{d.weight}
                  </span>
                  <span className={`text-sm mono ${tierColor(d.tier)}`}>
                    {tierLabel(d.tier)}
                  </span>
                  <span className="text-sm text-[color:var(--color-mute)]">
                    {trendGlyph(d.trend)} {d.trend}
                  </span>
                  <span className="mono text-2xl font-semibold text-[color:var(--color-accent)]">
                    {d.score}
                  </span>
                  <span className="text-sm text-[color:var(--color-mute)]">
                    / 100{" "}
                    <span className="text-xs">
                      (raw {d.rawScore} of {d.rawTarget})
                    </span>
                  </span>
                </div>
              </header>

              <div className="relative h-2 rounded-full bg-[color:var(--color-panel-2)] mb-5">
                <div
                  className="absolute top-0 left-0 h-full rounded-full bg-[color:var(--color-good)] opacity-70"
                  style={{ width: `${d.score}%` }}
                />
                <div
                  className="absolute top-0 h-full w-0.5 bg-[color:var(--color-accent)]"
                  style={{ left: `${d.target}%` }}
                  title={`target ${d.target}`}
                />
              </div>

              <p className="text-sm text-[color:var(--color-text)] leading-relaxed mb-5">
                <LinkifyBoris text={d.summary} />
              </p>

              <div className="grid md:grid-cols-3 gap-5 text-sm">
                <Column label="Evidence observed">
                  {d.evidence.map((e, i) => (
                    <li key={i}>
                      <LinkifyBoris text={e} />
                    </li>
                  ))}
                </Column>
                <Column label="Gaps">
                  {d.gaps.map((g, i) => (
                    <li key={i}>
                      <LinkifyBoris text={g} />
                    </li>
                  ))}
                </Column>
                <Column label="Next actions">
                  {d.nextActions.map((a) => (
                    <li
                      key={a.id}
                      className={`text-[color:var(--color-text)] ${a.satisfied ? "opacity-60 line-through" : ""}`}
                    >
                      <LinkifyBoris text={a.action} />
                      {a.satisfied ? (
                        <span
                          className="ml-1 text-[10px] not-italic text-[color:var(--color-good)] no-underline"
                          style={{ textDecoration: "none" }}
                        >
                          ✓ done
                        </span>
                      ) : null}
                    </li>
                  ))}
                </Column>
              </div>

              {(d.executionScore != null || d.gapReason) && (
                <ExecutionAxis
                  score={d.executionScore}
                  evidence={d.executionEvidence}
                  gaps={d.executionGaps}
                  gapReason={d.gapReason}
                />
              )}
            </article>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="credits-heading"
        className="mt-16 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-panel)] px-6 py-5"
      >
        <h2
          id="credits-heading"
          className="text-xs uppercase tracking-[0.15em] text-[color:var(--color-mute)] mb-4"
        >
          Credits &amp; references
        </h2>
        <dl className="grid gap-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-[color:var(--color-mute)] mb-1">
              Workflow tips
            </dt>
            <dd>
              <strong className="text-[color:var(--color-text)]">
                Boris Cherny
              </strong>{" "}
              — author of the 87 tips this rubric weights against.{" "}
              <a
                href="https://x.com/bcherny"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted underline-offset-2 text-[color:var(--color-accent)]"
              >
                @bcherny on X ↗
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--color-mute)] mb-1">
              Tip aggregation &amp; /boris skill
            </dt>
            <dd>
              <strong className="text-[color:var(--color-text)]">
                Daniel An
              </strong>{" "}
              (
              <a
                href="https://github.com/CarolinaCherry"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted underline-offset-2 text-[color:var(--color-accent)]"
              >
                @CarolinaCherry on GitHub ↗
              </a>
              ) — creator of{" "}
              <a
                href="https://howborisusesclaudecode.com"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted underline-offset-2 text-[color:var(--color-accent)]"
              >
                howborisusesclaudecode.com ↗
              </a>{" "}
              and compiler of the <span className="mono">/boris</span> skill
              that
              <span className="mono"> /self-assessment</span> cross-references.
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--color-mute)] mb-1">
              Local data sources read
            </dt>
            <dd className="space-y-0.5">
              <div>
                <span className="mono">~/.claude/settings.json</span>,{" "}
                <span className="mono">agents/</span>,{" "}
                <span className="mono">commands/</span>,{" "}
                <span className="mono">skills/</span>,{" "}
                <span className="mono">plans/</span>
              </div>
              <div>
                <span className="mono">~/.claude/projects/*/memory</span>
              </div>
              <div>
                <span className="mono">~/.claude/usage-data/</span> (same files{" "}
                <span className="mono">/insights</span> reads)
              </div>
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--color-mute)] mb-1">
              Local tools &amp; skills used
            </dt>
            <dd className="space-y-0.5">
              <div>
                Boris skill snapshot at{" "}
                <span className="mono">~/.claude/skills/boris</span>
              </div>
              <div>
                Slash commands: <span className="mono">/self-assessment</span>,{" "}
                <span className="mono">/refresh-insights</span>
              </div>
              <div>Built with Next.js 16, Tailwind CSS, Vitest</div>
            </dd>
          </div>
        </dl>
      </section>

      <footer className="mt-8 pt-6 border-t border-[color:var(--color-line)] text-xs text-[color:var(--color-mute)] space-y-2">
        <p>
          Scoring uses two axes:{" "}
          <strong className="text-[color:var(--color-good)]">
            Platform Setup
          </strong>{" "}
          from <span className="mono">~/.claude</span> config (settings,
          plugins, agents, commands, skills, memory) and{" "}
          <strong className="text-[color:var(--color-warn)]">Execution</strong>{" "}
          from <span className="mono">~/.claude/usage-data</span> behavioral
          signals (the same local files <span className="mono">/insights</span>{" "}
          reads). Each dimension is weighted 1–3 by leverage. Trends marked{" "}
          <span className="mono">✦ new</span> reflect features shipped in April
          2026 (Opus 4.7 family).{" "}
          <Link
            href="/methodology"
            className="underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-accent)]"
          >
            Full methodology →
          </Link>
        </p>
        <p className="opacity-75">
          Independent open-source dashboard (MIT). Not affiliated with, endorsed
          by, or sponsored by Anthropic. &quot;Claude&quot;, &quot;Claude
          Code&quot;, and <span className="mono">/insights</span> are trademarks
          of Anthropic, used here only to identify the platform whose
          locally-stored data this tool analyzes.
        </p>
      </footer>
    </main>
  );
}

function Panel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "good" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const toneColor =
    tone === "good"
      ? "var(--color-good)"
      : tone === "warn"
        ? "var(--color-warn)"
        : "var(--color-bad)";
  return (
    <div
      className="bg-[color:var(--color-panel)] border rounded-xl p-5"
      style={{ borderColor: toneColor + "40" }}
    >
      <div
        className="text-xs uppercase tracking-wider mb-4"
        style={{ color: toneColor }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

const TIP_LINK_CLASS =
  "underline decoration-dotted underline-offset-2 hover:text-[color:var(--color-accent)]";

function TipLink({ n, label }: { n: number; label?: React.ReactNode }) {
  const t = borisTipLink(n);
  return (
    <Link
      href={t.url}
      title={`${t.topic} — ${t.where} (renders the tip locally; upstream site has no per-tip URL)`}
      className={TIP_LINK_CLASS}
    >
      {label ?? n}
    </Link>
  );
}

function BorisTips({ csv }: { csv: string }) {
  const tips = parseBorisTipList(csv);
  if (tips.length === 0) return null;
  return (
    <span>
      §
      {tips.map((t, i) => (
        <span key={t.n}>
          <TipLink n={t.n} />
          {i < tips.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

/**
 * Linkify inline mentions of Boris tips inside free text. The full phrase is
 * the link (e.g. the entire "Boris tip 7" is clickable). For multi-number
 * forms ("Boris tip 14/73", "Boris tip 14, 51, 52") the prefix attaches to
 * the first number; remaining numbers are individual links separated by the
 * original delimiter.
 */
function LinkifyBoris({ text }: { text: string }) {
  const re = /\bBoris\s+(?:tips?|§)\s*\d+(?:\s*[,/]\s*\d+)*/gi;
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));

    // Split the whole phrase into [prefix, n1, sep, n2, sep, n3, ...]
    // where prefix is "Boris tip " or "Boris §" with the first number stuck on.
    const phrase = m[0];
    const firstNumMatch = phrase.match(/\d+/)!;
    const firstNumStart = phrase.indexOf(firstNumMatch[0]);
    const firstNumEnd = firstNumStart + firstNumMatch[0].length;
    const prefix = phrase.slice(0, firstNumEnd); // "Boris tip 7"
    const tail = phrase.slice(firstNumEnd); // "" or "/73" or ", 51, 52"
    const firstN = parseInt(firstNumMatch[0], 10);

    const tailNodes: React.ReactNode[] = [];
    const tailRe = /(\s*[,/]\s*)(\d+)/g;
    let tailLast = 0;
    let tailKey = 0;
    for (const tm of tail.matchAll(tailRe)) {
      const ts = tm.index ?? 0;
      if (ts > tailLast) tailNodes.push(tail.slice(tailLast, ts));
      tailNodes.push(tm[1]);
      tailNodes.push(<TipLink key={tailKey++} n={parseInt(tm[2]!, 10)} />);
      tailLast = ts + tm[0].length;
    }
    if (tailLast < tail.length) tailNodes.push(tail.slice(tailLast));

    out.push(
      <span key={key++}>
        <TipLink n={firstN} label={prefix} />
        {tailNodes}
      </span>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function SnapshotTile({
  label,
  tone,
  score,
  denom,
  sublabel,
}: {
  label: string;
  tone: "good" | "warn";
  score: number | null;
  denom: number;
  sublabel: string;
}) {
  const labelColor =
    tone === "good"
      ? "text-[color:var(--color-good)]"
      : "text-[color:var(--color-warn)]";
  const scoreColor =
    score == null
      ? "text-[color:var(--color-mute)]"
      : tone === "good"
        ? "text-[color:var(--color-accent)]"
        : tierColor(tierFor(score));
  return (
    <div className="bg-[color:var(--color-panel)] border border-[color:var(--color-line)] rounded-lg p-4">
      <div
        className={`text-[10px] uppercase tracking-wider mb-1 ${labelColor}`}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-4xl font-semibold tracking-tight ${scoreColor}`}>
          {score == null ? "—" : score}
        </span>
        {score != null && (
          <span className="text-sm text-[color:var(--color-mute)]">
            / {denom}
          </span>
        )}
      </div>
      <div className="text-[11px] text-[color:var(--color-mute)] mt-1">
        {sublabel}
      </div>
    </div>
  );
}

function ExecutionAxis({
  score,
  evidence,
  gaps,
  gapReason,
}: {
  score: number | null;
  evidence: string[];
  gaps: string[];
  gapReason: string | null;
}) {
  return (
    <div className="mt-5 pt-5 border-t border-[color:var(--color-line)]">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-[color:var(--color-warn)]">
          Execution axis · habits
        </div>
        {score != null ? (
          <div className="flex items-baseline gap-2 mono">
            <span className="text-lg font-semibold text-[color:var(--color-warn)]">
              {score}
            </span>
            <span className="text-xs text-[color:var(--color-mute)]">
              / 100
            </span>
          </div>
        ) : (
          <div className="text-xs text-[color:var(--color-mute)]">
            unmeasured
          </div>
        )}
      </div>
      {gapReason && (
        <p className="text-xs text-[color:var(--color-mute)] mb-3 italic">
          {gapReason}
        </p>
      )}
      {(evidence.length > 0 || gaps.length > 0) && (
        <div className="grid md:grid-cols-2 gap-5 text-sm">
          {evidence.length > 0 && (
            <Column label="Habit evidence">
              {evidence.map((e, i) => (
                <li key={i}>
                  <LinkifyBoris text={e} />
                </li>
              ))}
            </Column>
          )}
          {gaps.length > 0 && (
            <Column label="Habit gaps">
              {gaps.map((g, i) => (
                <li key={i}>
                  <LinkifyBoris text={g} />
                </li>
              ))}
            </Column>
          )}
        </div>
      )}
    </div>
  );
}

function Column({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[color:var(--color-mute)] mb-2">
        {label}
      </div>
      <ul className="list-disc list-outside ml-4 space-y-1.5 text-[color:var(--color-mute)]">
        {children}
      </ul>
    </div>
  );
}
