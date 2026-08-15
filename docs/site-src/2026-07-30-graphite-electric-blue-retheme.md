---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/177
synthesized_into: []
doc_kind: decision
---

# Graphite + electric-blue retheme

PR #177 replaces the dashboard's warm/gold palette with a cool-graphite
instrument-panel look and a single electric-blue accent. The whole rewrite
lives in one file, `app/globals.css` — because every page and shared
component consumes the `@theme` token layer rather than hardcoded colors,
re-skinning that file cascades across all 8 pages and 6 shared components
without touching any of them directly.

## What changed

`app/globals.css`'s `@theme` block keeps every original token **name** —
`--color-ink`, `--color-panel`, `--color-accent`, and so on — and only
changes the **values**, which is what lets the rest of the codebase cascade
for free:

- Canvas moves from a warm near-black to a cooler one (`--color-ink:
#0a0a0d`), with `--color-panel` / `--color-panel-2` and the hairline
  `--color-line` / `--color-line-2` borders similarly cooled.
- The accent — previously `#d4a84b` gold — is now `--color-accent: #4d8bff`
  with `--color-accent-2: #3b82f6` for emphasis (the notification dot) and
  `--color-accent-soft` for tinted backgrounds. Semantic colors
  (`--color-good`, `--color-warn`, `--color-bad`) are kept deliberately
  distinct from the accent so status coloring doesn't get read as "the
  brand color."
- `body` gets a faint radial glow anchored top-center
  (`120% 78% at 50% -12%`, low-alpha accent blue) for instrument-panel
  atmosphere — subtle enough not to read as noise.
- `:focus-visible` outlines and `::selection` now use the blue accent
  instead of the old gold.
- Scrollbars (`scrollbar-color`, `::-webkit-scrollbar-thumb`) switch to the
  cool `--color-line-2` / `--color-mute` pair.

The same file also adds a shared primitive layer that didn't exist before:
`.card` (the dominant container — hairline border, `--radius-card`,
`--shadow-card`), `.icon-btn` (the rounded-square control for icon-only
buttons), `.eyebrow` (uppercase tracked section labels), `.pill` /
`.pill-accent` (chips, with an accent-tinted variant), `.dot-badge` (the
punched notification dot), and `.tnum` (tabular numerals for any stat or
score). These are the primitives new pages should reach for rather than
re-deriving card/pill/badge styling inline.

### PageNav: breadcrumb to pill-tabs

`app/components/PageNav.tsx` was elevated from a middot-separated text
breadcrumb to accent-tinted pill-tabs. The active tab now renders as a
`span` with `aria-current="page"`, accent text color
(`--color-accent`), and an accent-soft background/border
(`--color-accent-soft`, `color-mix(in srgb, var(--color-accent) 35%,
transparent)`); inactive items stay `Link`s in `--color-mute` with a
hover-to-`--color-text` transition. The active-detection logic — an item is
active if it matches `current`, or if `context.parentKey` matches and
`current` isn't `"dashboard"` — and the trailing context breadcrumb (the
`›`-prefixed label for dimension/tip detail pages) are both unchanged; only
the visual treatment of the primary four tabs (`Dashboard`, `Methodology`,
`Probes`, `Progression`) moved from breadcrumb to pill.

### Two bugs fixed as a side effect

Before this PR, `--color-bg`, `--color-fg`, and `--color-card` were
referenced by components but never defined in `@theme` — which is invalid
CSS custom-property usage with no fallback, not a silent inherit. Defining
them now (as aliases: `--color-bg` = `--color-ink`, `--color-fg` =
`--color-text`, `--color-card` = a subtle raised `#14161c` for the probes
page) fixed two live rendering bugs that had been shipping: `InsightsNarrative`'s
primary button label and `ProgressionTimeline`'s node ring, both of which
had no usable color before this change.

### Tooling hygiene

`.gitignore` gained three entries as part of the same PR: `graphify-out/`
(the `/graphify` knowledge-graph build output — cache is machine-local and
keyed to absolute paths), `.tmp`, and `.claude/worktrees/`. This is
unrelated to the retheme itself — it's local build-artifact and scratch-dir
hygiene bundled into the same commit — and has no user-visible effect on
the dashboard.

## Why

The goal was to move the dashboard from its prior warm/gold identity to a
cool-graphite + single electric-blue accent design language (referred to in
the PR as the "tray-icon dialect," after the design mockup it followed),
applied globally through the Tailwind v4 `@theme` token layer so the whole
app re-skins from one file rather than a per-page pass.

The PR was shipped lean: the verify-agent, simplify, and code-review /ship
stages were intentionally skipped in favor of the full test suite, `tsc`,
a dev-server smoke check, and manual visual sign-off — later re-confirmed
on a rebuilt Node 26 / Next 16 toolchain after a Homebrew architecture
migration.

## Not yet done

Two follow-ups called out in the PR body remain outstanding as of this
writing and are not reflected above because they haven't landed:

- A per-page pass deepening card shadows.
- A project-wide `npm run lint` fix.
