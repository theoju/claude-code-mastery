import Link from "next/link";
import PageNav from "@/app/components/PageNav";

export const dynamic = "force-static";

export const metadata = { title: "Methodology — Claude Code Self-Assessment" };

export default function MethodologyPage() {
  return (
    <main className="max-w-[1200px] mx-auto px-8 py-12 prose-invert">
      <PageNav current="methodology" />
      <header className="mb-12 border-b border-[color:var(--color-line)] pb-8">
        <div className="flex items-baseline gap-3 text-xs uppercase tracking-[0.15em] text-[color:var(--color-mute)] mb-3">
          <span>Claude Code Self-Assessment</span>
          <span>·</span>
          <span>Methodology</span>
          <span>·</span>
          <span>Two axes · 12 dimensions · evidence-based</span>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight mb-3">
          How the score is built.
        </h1>
        <p className="text-[color:var(--color-mute)] max-w-3xl leading-relaxed">
          Every dimension is scored against deterministic predicates over local
          state in{" "}
          <span className="mono text-[color:var(--color-text)]">
            ~/.claude/
          </span>{" "}
          and the cooked{" "}
          <span className="mono text-[color:var(--color-text)]">/insights</span>{" "}
          telemetry. No model evaluations, no API calls — same machine state
          renders the same number.
        </p>
      </header>
      <Section title="Two axes, not one composite">
        <p>
          Self-assessment here is scored on two independent axes rather than
          collapsed into a single number. A composite would obscure the very
          thing this dashboard exists to surface — the gap between how Claude
          Code is <em>configured</em> and how it&apos;s actually <em>used</em>.
        </p>
        <ul>
          <li>
            <strong className="text-[color:var(--color-good)]">
              Platform Setup
            </strong>{" "}
            — derived from your local <span className="mono">~/.claude</span>{" "}
            setup: settings, plugins, custom agents/commands/skills, hooks,
            project memory, and CLAUDE.md health. It answers:{" "}
            <em>are the tools in place?</em>
          </li>
          <li>
            <strong className="text-[color:var(--color-warn)]">
              Execution
            </strong>{" "}
            — derived from behavioral signals in{" "}
            <span className="mono">~/.claude/usage-data</span> (the same files{" "}
            <span className="mono">/insights</span> reads). It answers:{" "}
            <em>are you using them?</em>
          </li>
        </ul>
        <p>
          The diagnostic case is a high Platform Setup score paired with a low
          Execution score — every tool installed, none of them used. The{" "}
          <strong>Δ</strong> readout on the dashboard makes this gap explicit.
        </p>
      </Section>

      <Section title="What each Execution scorer measures (11 of 12 dimensions)">
        <p>
          Eleven dimensions currently have execution scorers. Each formula is a
          deterministic function over the signals named below — open{" "}
          <span className="mono">scripts/score.mjs</span> to read the source.
          For the full inventory of <em>which</em> signals each predicate reads,
          see the{" "}
          <Link
            href="/methodology/probes"
            className="underline decoration-dotted"
          >
            probes catalog →
          </Link>
        </p>
        <ul>
          <li>
            <strong>Permissions &amp; Safety</strong> —{" "}
            <span className="mono">autoRatio × 100 − bypassRatio × 120</span>.
            Soft 1.2× asymmetry: auto is preferred, but occasional bypass
            doesn&apos;t crush a mostly-auto workflow.
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: interactive sessions only (excludes SDK and observer
              sessions).
            </span>
          </li>
          <li>
            <strong>Parallel Execution &amp; Subagents</strong> — subagent
            dispatch ratio (weighted 2×) plus worktree usage when transcripts
            are opted in.
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: interactive sessions only (excludes SDK and observer
              sessions).
            </span>
          </li>
          <li>
            <strong>Planning &amp; Delegation</strong> — plan-mode adoption
            within multi-task sessions (linear; gated when no multi-task
            sessions exist). Recognized signals include built-in plan mode plus
            planning-flavored skill invocations (e.g.{" "}
            <span className="mono">superpowers:writing-plans</span>,{" "}
            <span className="mono">superpowers:brainstorming</span>) — skill
            invocations are scanned from transcripts so a planning skill counts
            the same as the toggle.
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: interactive sessions only (excludes SDK and observer
              sessions).
            </span>
          </li>
          <li>
            <strong>Integrations</strong> —{" "}
            <span className="mono">
              min(plugin_calls / sessions / 2, 1) × 100
            </span>
            . Volume-per-session, not coverage. Specialty plugins that only fire
            in their context aren&apos;t penalized; idle plugins surface as
            informational evidence instead of dragging the score.
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: all in-window sessions (volume metric).
            </span>
          </li>
          <li>
            <strong>Verification</strong> —{" "}
            <span className="mono">100 × exp(−missRate × 8)</span>. Smooth
            exponential decay over friction events (buggy_code + wrong_approach)
            per session. Never goes negative; a 15% miss rate ≈ 30, 30% ≈ 9.
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: all in-window sessions (volume metric).
            </span>
          </li>
          <li>
            <strong>Automation &amp; Hooks</strong> — hook fires per session
            plus a bonus when personal agents are in use. Routes to{" "}
            <em>unmeasured</em> when{" "}
            <span className="mono">~/.claude/hook-fires.jsonl</span> is absent
            (Claude Code does not emit this telemetry by default).
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: interactive sessions only (excludes SDK and observer
              sessions).
            </span>
          </li>
          <li>
            <strong>Scheduled &amp; Autonomous Workflows</strong> —
            presence-and-intensity over CronCreate / CronDelete / CronList /
            ScheduleWakeup invocations. 1 invocation in window = 50, ≥3 = 100.
            Volume-per-session would wash the signal out — these tools fire too
            rarely.
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: all in-window sessions (volume metric).
            </span>
          </li>
          <li>
            <strong>Remote &amp; Mobile</strong> — same presence-and-intensity
            curve over RemoteTrigger / PushNotification / SendMessage
            invocations.
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: all in-window sessions (volume metric).
            </span>
          </li>
          <li>
            <strong>Learning &amp; Explanatory Mode</strong> —{" "}
            <span className="mono">learningModeSessionRatio × 100</span>. Counts
            sessions where Claude emitted the{" "}
            <span className="mono">★ Insight</span> banner from the
            explanatory-output-style plugin <em>or</em> the user invoked a
            learning-flavored skill (e.g.{" "}
            <span className="mono">superpowers:brainstorming</span>,
            explanatory-output-style skills). Platform Setup credits
            installation; this scorer credits actual use. Caveat: the substring
            match depends on the plugin&apos;s banner string, so a future plugin
            upgrade could regress one half of the signal — the skill-invocation
            half remains stable.
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: interactive sessions only (excludes SDK and observer
              sessions).
            </span>
          </li>
          <li>
            <strong>Memory &amp; Context Management</strong> —{" "}
            <span className="mono">
              min(sum / interactiveOrUnknownSessionsAnalyzed, 1) × 100
            </span>
            , where <span className="mono">sum</span> is the inline MAX-merge of
            transcript and history counts for <span className="mono">/btw</span>
            , <span className="mono">/clear</span>,{" "}
            <span className="mono">/compact</span>, and{" "}
            <span className="mono">/rewind</span> (session-coverage hits — each
            command contributes at most once per session). These are posture
            commands, so the denominator must include the same session kinds the
            numerator is counted from. Rubric target is 92; the radar vertex
            displays{" "}
            <span className="mono">clamp(round(rawScore / 92 × 100))</span>.
            When <span className="mono">rawRatio &gt; 1</span> (multiple memory
            commands per session), the score saturates at 100 and the evidence
            string surfaces <em>&quot;capped from N%&quot;</em> so the
            over-coverage stays visible rather than being silently truncated.
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: <span className="mono">interactive_cli ∪ unknown</span>.
              The numerator-subset-of-denominator hard rule applies: the
              counters come from the conservative allowPosture branch
              (interactive_cli plus unknown-classification sessions), so the
              denominator must include both — using{" "}
              <span className="mono">interactive_cli</span> alone would allow
              the ratio to exceed 100% from unknown-session contributions.
            </span>
          </li>
          <li>
            <strong>Terminal &amp; Customization</strong> —{" "}
            <span className="mono">
              min(sum / interactiveOrUnknownSessionsAnalyzed, 1) × 100
            </span>
            , same shape as Memory but over <span className="mono">/color</span>
            , <span className="mono">/voice</span>, and{" "}
            <span className="mono">/focus</span>. Counters MAX-merge transcript
            and history values so neither source is double-counted. Rubric
            target is 80; the radar vertex displays{" "}
            <span className="mono">clamp(round(rawScore / 80 × 100))</span>.
            Like Memory, the cap surfaces in evidence as{" "}
            <em>&quot;capped from N%&quot;</em> rather than being hidden by the{" "}
            <span className="mono">Math.min</span>.
            <span className="block mt-1 text-xs text-[color:var(--color-mute)]">
              Universe: <span className="mono">interactive_cli ∪ unknown</span>{" "}
              (same rationale as Memory — posture commands counted via the
              allowPosture branch require the denominator to include both
              session kinds).
            </span>
          </li>
        </ul>
      </Section>

      <Section title="The remaining partially-measured dimension">
        <p>
          One dimension is still <em>partially</em> measured. Model &amp; Effort
          Tuning scores its Opus-usage half (Boris tip 2) from transcripts, but
          effort level itself never reaches transcripts or cooked telemetry — it
          stays a settings-only signal. The per-dimension card carries an
          explicit <span className="mono">gapReason</span> when the Execution
          half is unavailable so users can tell <em>which</em> kind of
          unmeasured it is.
        </p>
        <p>
          Memory &amp; Context Management and Terminal &amp; Customization
          previously rendered as fully unmeasured under the same rationale (no
          signal in <span className="mono">tool_counts</span>; customization is
          client-side). That changed when their posture-command counters landed:
          both are now measured via session-coverage counts (transcript and
          history sources MAX-merged), and the formula details live in the
          section above. <em>Unmeasured</em> is still not <em>scored zero</em>;
          the radar marks an unmeasured vertex with an italic label and a
          footnote rather than a 0.
        </p>
      </Section>

      <Section title="Calibration philosophy">
        <p>
          Execution scoring rewards <em>directional progress</em>, not
          perfection. Earlier iterations used linear amplifiers and coverage
          ratios that produced near-zero scores for engineers who were actively
          improving — discouraging the very behavior the dashboard is meant to
          encourage. The current formulas follow three principles:
        </p>
        <ul>
          <li>
            <strong>Smooth decay over linear amplification.</strong>{" "}
            Verification uses <span className="mono">exp(−missRate × 8)</span>{" "}
            instead of <span className="mono">100 − missRate × 500</span>. A
            productive engineer with a 15% friction rate now scores 30 instead
            of 25, and the curve never drops below 0 pre-clamp. Friction events
            are partly &quot;Claude caught a bug&quot; — not pure failures — so
            the penalty saturates.
          </li>
          <li>
            <strong>Soft asymmetry over crushing penalties.</strong> Permissions
            weights bypass at 1.2× auto rather than 2×. The asymmetry is
            preserved (auto strictly preferred) but a 50/50 mix scores ~10
            instead of −10, so incremental progress moves the needle.
          </li>
          <li>
            <strong>Volume over coverage.</strong> Integrations measures plugin
            calls per session, not the share of installed plugins that fired.
            Hoarding specialty plugins doesn&apos;t inflate the score; using
            your installed plugins regularly does. Idle plugins are reported as
            informational evidence, not as a denominator that punishes breadth.
          </li>
        </ul>
        <p>
          The goal is honest scoring that defends itself for any user — not just
          the developer who tuned it. If a formula produces a degenerate score
          because a data source is structurally absent (rather than because
          behavior is low), the scorer routes to <em>unmeasured</em> via{" "}
          <span className="mono">gapReason</span> instead of returning a numeric
          zero.
        </p>
      </Section>

      <Section title="Lookback windows">
        <p>
          Two configurable windows control how far back signals are read, in{" "}
          <span className="mono">assessment.config.json</span>:
        </p>
        <ul>
          <li>
            <span className="mono">scoring.insightsLookbackDays</span> — default{" "}
            <strong>30</strong>. Aggregation window for Execution scoring. A
            short window favours recent habits; a long one rewards consistency.
          </li>
          <li>
            <span className="mono">scoring.progressionLookbackDays</span> —
            default <strong>null</strong> (full history). The progression
            timeline walks all sessions to detect &quot;first&quot; events that
            may have happened months ago. The &quot;stopped using bypass&quot;
            detector additionally requires recent overall activity so it
            doesn&apos;t fire for users who simply stopped using Claude.
          </li>
          <li>
            <span className="mono">scoring.includeTranscripts</span> — default{" "}
            <strong>false</strong>. Opt-in scan of raw{" "}
            <span className="mono">~/.claude/projects/*/*.jsonl</span>{" "}
            transcripts to detect permission-mode adoption, worktree usage, and
            skill attribution. Skipped by default because the scan is expensive
            (hundreds of MB on active users).
          </li>
        </ul>
      </Section>

      <Section title="Gap reasons, not silent zeros">
        <p>
          When an Execution score is missing, the{" "}
          <span className="mono">gapReason</span> field tells you <em>why</em>{" "}
          rather than rendering as 0. Common reasons:
        </p>
        <ul>
          <li>
            <em>No /insights data yet</em> —{" "}
            <span className="mono">~/.claude/usage-data</span> is absent (fresh
            install)
          </li>
          <li>
            <em>Insufficient session count</em> — fewer sessions in the lookback
            window than the dimension requires
          </li>
          <li>
            <em>Transcript opt-in required</em> — the dimension needs raw
            transcripts and the flag is off
          </li>
          <li>
            <em>Hook-fire telemetry absent</em> —{" "}
            <span className="mono">~/.claude/hook-fires.jsonl</span> is not
            emitted by Claude Code by default; Automation execution is
            unmeasured rather than scored 0
          </li>
        </ul>
      </Section>

      <Section title="Weights and overall scoring">
        <p>
          Each dimension carries a weight 1–3 reflecting how much it compounds
          daily work, sourced from Boris Cherny&apos;s ranking on{" "}
          <a
            className="underline"
            href="https://howborisusesclaudecode.com"
            target="_blank"
            rel="noreferrer"
          >
            howborisusesclaudecode.com
          </a>
          . Platform Setup overall and Execution overall are both
          weight-normalized means over their respective per-dimension scores.
          Priority actions are sorted by{" "}
          <span className="mono">weight × (target − score)</span>.
        </p>
      </Section>

      <Section title="Privacy">
        <p>
          All reads are local. No data leaves the machine unless you explicitly
          enable Slack posting. The dashboard renders from{" "}
          <span className="mono">app/data/assessment.json</span>,{" "}
          <span className="mono">app/data/progression.json</span>, and
          (optionally){" "}
          <span className="mono">app/data/insights-narrative.md</span>. The
          first two are produced by{" "}
          <span className="mono">scripts/run-assessment.mjs</span>; the third is
          something you put there explicitly (see below).
        </p>
      </Section>

      <Section title="The /insights integration — two opt-in paths, both user-driven">
        <p>
          The dashboard&apos;s scoring is independent of{" "}
          <span className="mono">/insights</span>: it reads the same raw{" "}
          <span className="mono">~/.claude/usage-data/</span> files but computes
          its own Platform Setup and Execution scores. If you also want
          Claude&apos;s own analysis surfaced here, there are two paths — both
          rely on artifacts already on your disk, neither auto-captures
          anything.
        </p>
        <h3 className="text-sm font-semibold text-[color:var(--color-text)] mt-4">
          1. The full HTML report (one-click button)
        </h3>
        <p>
          When you run <span className="mono">/insights</span> in Claude Code,
          it writes a full HTML report to{" "}
          <span className="mono">~/.claude/usage-data/report.html</span>. The
          dashboard detects that file and shows an &quot;Open Claude&apos;s full
          /insights report&quot; button that streams it through{" "}
          <span className="mono">/api/insights-report</span>. This is exactly
          the same posture as reading the JSON telemetry: a static file Claude
          Code wrote to your machine, served locally for your eyes only. We
          don&apos;t edit, augment, or redistribute it.
        </p>
        <h3 className="text-sm font-semibold text-[color:var(--color-text)] mt-4">
          2. An inline markdown summary (optional)
        </h3>
        <p>
          If you&apos;d like a condensed narrative rendered inline rather than
          opened in a new tab, run <span className="mono">/insights</span> in
          Claude Code, then drop the markdown summary into{" "}
          <span className="mono">app/data/insights-narrative.md</span>. Three
          ways to do it, all user-initiated:
        </p>
        <pre className="bg-[color:var(--color-panel-2)] p-3 rounded text-xs overflow-x-auto">
          {`/refresh-insights              # slash command — Claude writes the file from the current session's /insights output
pbpaste | npm run import-insights   # pipe the clipboard
# or paste manually into app/data/insights-narrative.md`}
        </pre>
        <p>
          That file is gitignored, never uploaded, never posted to Slack, and
          rendered locally with the markdown helper used elsewhere in the
          dashboard. The <span className="mono">/refresh-insights</span> command
          is a thin convenience wrapper — it only files output that{" "}
          <span className="mono">/insights</span> already produced in your
          session, never invokes <span className="mono">/insights</span> on its
          own, and won&apos;t paraphrase or augment the text. We don&apos;t
          auto-capture <span className="mono">/insights</span> output,
          don&apos;t reuse Anthropic&apos;s prompt template, and don&apos;t
          persist anything beyond the files you choose to create.
        </p>
      </Section>

      <Section title="Attribution &amp; relationship to Claude Code">
        <p>
          This is an <strong>independent, open-source community tool</strong>.
          It is{" "}
          <strong>
            not affiliated with, endorsed by, or sponsored by Anthropic
          </strong>
          .
        </p>
        <p>
          The dashboard analyzes files that Claude Code writes to your local{" "}
          <span className="mono">~/.claude/</span> directory during normal use —
          settings, installed plugins, project memory, and the per-session
          telemetry under <span className="mono">~/.claude/usage-data/</span>.
          Those are <em>your</em> files on <em>your</em> machine; the dashboard
          just reads them and computes its own scores.
        </p>
        <p>
          References to <span className="mono">/insights</span> describe the
          Claude Code built-in command that reads the same local data files. We
          don&apos;t reuse <span className="mono">/insights</span> output,
          replicate its UI, or call any Anthropic API.{" "}
          <em>&quot;Claude&quot;</em>, <em>&quot;Claude Code&quot;</em>, and{" "}
          <em>&quot;/insights&quot;</em> are trademarks of Anthropic, used here
          only to identify the platform this tool complements — not to imply
          endorsement.
        </p>
        <p>
          Workflow tip ranking and the underlying methodology come from Boris
          Cherny&apos;s{" "}
          <a
            className="underline"
            href="https://howborisusesclaudecode.com"
            target="_blank"
            rel="noreferrer"
          >
            howborisusesclaudecode.com
          </a>
          , reproduced under fair use as cross-references; tip content is
          fetched at install time from a snapshot of the public site.
        </p>
        <p>
          License: MIT. Issues, PRs, and rubric improvements welcome on GitHub.
        </p>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12 grid grid-cols-12 gap-x-10 gap-y-3">
      <h2 className="col-span-12 md:col-span-3 text-xs uppercase tracking-[0.15em] text-[color:var(--color-mute)] md:pt-1">
        {title}
      </h2>
      <div className="col-span-12 md:col-span-9 max-w-3xl space-y-3 text-sm leading-relaxed [&_ul]:list-disc [&_ul]:ml-6 [&_ul]:space-y-1.5 [&_ul]:my-3 [&_a]:text-[color:var(--color-accent)]">
        {children}
      </div>
    </section>
  );
}
