---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/177
synthesized_into: []
doc_kind: decision
---

# Graphite theme retheme (PR #177)

The dashboard's visual design system moved from a warm/gold palette to a
cool-graphite instrument-panel look with a single electric-blue accent. The
whole re-skin lands through one file — `app/globals.css` — because the
codebase is fully token-driven: every page and component reads
`var(--color-*)`, nothing is hard-coded. Retune the `@theme` block and all
8 pages and 6 shared components pick up the new palette at once.

## What changed

- **Palette**: grounds, lines, text, and the accent color all shifted cooler.
  The headline change is the accent itself — `--color-accent` moved from
  `#d4a84b` (gold) to `#4d8bff` (electric blue), with `--color-accent-2` and
  `--color-accent-soft` retuned to match.
- **Semantic colors retuned to stay distinct from the new accent** —
  `--color-good`, `--color-warn`, and `--color-bad` were re-picked so none of
  them reads as a near-miss for the new blue accent on a graphite background.
- **A shared primitive layer**, new in this PR: `.card` (the dominant hairline
  container with soft depth), `.icon-btn` (the rounded-square control used for
  search/bell/help-style icons), `.eyebrow` (uppercase tracked section label),
  `.pill` / `.pill-accent` (chip styling, with the accent variant used for
  active state), `.dot-badge` (the punched notification dot), and `.tnum`
  (tabular numerals for any stat/score/metric). These live in `app/globals.css`
  under "Primitives — signature treatment shared across every page" and are
  meant to be reused rather than re-implemented per component.
- **`PageNav` elevated from a breadcrumb to accent-tinted pill-tabs.** The
  active tab now renders as a filled pill (`bg-[color:var(--color-accent-soft)]`,
  accent-colored text, accent-tinted border) instead of a plain underline or
  breadcrumb trail. The `aria-current="page"` attribute and the existing
  active-detection logic — matching on `current` or on `context.parentKey`
  when a detail page's context isn't the dashboard — are unchanged; only the
  visual treatment of the active tab moved.

## Two latent bugs fixed as a side effect

`--color-bg`, `--color-fg`, and `--color-card` were referenced by components
(the `InsightsNarrative` button label and the `ProgressionTimeline` node ring
among them) but were never defined in the token layer — so those elements were
rendering with invalid or browser-inherited color rather than anything the
design intended. The retheme's `@theme` block adds them as explicit compat
aliases (`--color-bg` → alias of `--color-ink`, `--color-fg` → alias of
`--color-text`, `--color-card` → a dedicated subtle raised-card tone used on
the probes page), which incidentally repairs both call sites. This wasn't the
point of the PR, but it's a real fix worth knowing about if you're tracing
why those two elements looked different before.

## Why a single-file rewrite was viable

Because every page and shared component already reads color through
`var(--color-*)` tokens rather than hard-coded values, the retheme didn't
require touching component markup beyond `PageNav` (whose class strings
needed the new pill-tab treatment, not new tokens). All original token
*names* were preserved — only their values changed — so `var()` references
throughout the app cascade the new palette without any per-component edit.

## Scope

Purely visual/CSS plus the one shared nav component. No API, schema, or
scoring-logic impact — nothing here touches `scripts/score.mjs`, the rubric,
or `assessment.json`'s shape.
