---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/177
synthesized_into: []
doc_kind: decision
---

# Graphite + blue design retheme

PR #177 reskins the dashboard from the original warm/gold palette to a
cool-graphite instrument-panel look with a single electric-blue accent —
what the PR calls the "tray-icon dialect." The whole change lands through
one file, `app/globals.css`, and cascades to all 8 pages and 6 shared
components without touching per-page markup.

## Why one file was enough

The codebase is fully token-driven — every color reference in the app
goes through `var(--color-*)`, with no hard-coded grays. `globals.css`
defines the palette inside a single `@theme` block: grounds (`--color-ink`,
`--color-panel`, `--color-panel-2`), lines, text/icon tones, and the accent
pair (`--color-accent` / `--color-accent-2`). Retuning those values —
gold `#d4a84b` → blue `#4d8bff` — re-skins every page in one pass because
nothing downstream hard-codes a color; it all resolves through the token
layer. Semantic good/warn/bad colors (`--color-good`, `--color-warn`,
`--color-bad`) were retuned alongside the accent so they stay visually
distinct from it — a plain accent-adjacent orange or green would read as
"selected" rather than "warning" once blue became interactive.

## Shared primitive layer

The retheme also introduces a small set of reusable primitives in
`globals.css`, meant to be the default building blocks for future pages
rather than one-off Tailwind utility soup:

| Primitive | Purpose |
| --- | --- |
| `.card` | The dominant container — hairline border, soft depth shadow, `--radius-card` corners. |
| `.icon-btn` | Rounded-square control (search / bell / help) with hover and active states. |
| `.eyebrow` | Uppercase, letter-spaced section label in `--color-faint`. |
| `.pill` / `.pill-accent` | Chip styling; `.pill-accent` tints border and background with the accent. |
| `.dot-badge` | The punched notification dot, ringed to match the surface it sits on. |
| `.tnum` | Tabular numerals for any stat/score/metric — keeps digit columns aligned. |

## Two incidental bugs fixed along the way

Touching the token definitions surfaced two references that had never
actually been defined: `--color-bg`, `--color-fg`, and `--color-card` were
used elsewhere in the app but had no corresponding `@theme` entry, so they
resolved to an invalid color — silently breaking the `InsightsNarrative`
button and a timeline ring. The retheme adds them as compat aliases
(`--color-bg` = `--color-ink`, `--color-fg` = `--color-text`, plus a
dedicated `--color-card` for the probes page's subtle raised card) so the
cascade is complete and both surfaces render correctly again.

## `PageNav.tsx`: breadcrumb → pill-tabs

`PageNav.tsx` moves from a plain breadcrumb to accent-tinted pill-tabs.
The active item now renders as a filled pill (`bg-[color:var(--color-accent-soft)]`,
accent-colored text and border) instead of a bare label, while inactive
items stay muted until hover. The component's existing logic is
untouched: `aria-current="page"` is still set on the active item, and the
active-detection rule — `item.key === current` **or** the current page's
declared `context.parentKey` matches a primary nav item (so a dimension
detail page still highlights "Dashboard") — carries over unchanged.

## Scope

This is a visual-layer change only: token values, primitive classes, and
`PageNav.tsx` styling. It does not touch scoring, signals, or data
contracts. There is no dedicated architecture or design-system page under
the `core` lens yet for the dashboard's token layer — if one is created
later, it should fold this retheme's token table and primitive list into
it rather than leaving this dated page as the only record.
