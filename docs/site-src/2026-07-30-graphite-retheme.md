---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/177
synthesized_into: []
doc_kind: decision
---

# 2026-07-30 — Graphite retheme

PR #177 re-skinned the dashboard from the original warm/gold palette to a
cool-graphite instrument-panel look with a single electric-blue accent. The
whole change lands in one file, `app/globals.css`, because the app is fully
token-driven — no page hard-codes a gray or a hex value, so rewriting the
`@theme` layer re-skins every page and shared component from one source of
truth.

## Token layer

The `@theme` block in `app/globals.css` keeps every original token **name**
(`--color-ink`, `--color-panel`, `--color-line`, `--color-text`,
`--color-mute`, etc.) and only changes the values, so nothing downstream had
to be touched to pick up the new palette. The headline swap is the accent:
`--color-accent` moves from `#d4a84b` (gold) to `#4d8bff`, with
`--color-accent-2` at `#3b82f6` for emphasis states and the notification dot,
and `--color-accent-soft` as a low-alpha wash (`rgba(77, 139, 255, 0.13)`) for
tinted backgrounds. Grounds and lines shift a few degrees cooler
(`--color-ink: #0a0a0d`, `--color-panel: #101116`, `--color-line: #262b34`)
to read as graphite rather than the old warm near-black. Semantic colors
(`--color-good`, `--color-warn`, `--color-bad`) are kept deliberately distinct
from the accent so status coloring doesn't get read as interactive.

## Shared primitives

The same rewrite introduces a small set of primitive classes meant to be
reused across every page rather than re-implemented per component:

- `.card` — the dominant container: `--color-panel` background, hairline
  `--color-line` border, `--radius-card`, `--shadow-card`.
- `.icon-btn` — the rounded-square control treatment (search / bell / help),
  40px, `--radius-btn`, hover and active states baked in.
- `.dot-badge` — the punched notification dot, positioned absolute off the
  corner of an `.icon-btn`.
- `.eyebrow` — uppercase, tracked, 11px section labels in `--color-faint`.
- `.pill` / `.pill-accent` — chip treatment for tags and status; the accent
  variant uses `--color-accent-soft` plus a color-mixed accent border.
- `.tnum` — tabular numerals for any stat, score, or metric, so digits don't
  jitter width as they update.

## `PageNav` becomes pill-tabs

`app/components/PageNav.tsx` moves from a plain breadcrumb-style nav to
accent-tinted pill-tabs. The active entry now renders as a `<span
aria-current="page">` with `--color-accent` text on an `--color-accent-soft`
background and a color-mixed accent border; inactive entries stay `Link`s
with a transparent border that fills on hover. The active-detection logic is
unchanged — an item is active when `item.key === current`, or when a
`context.parentKey` matches `item.key` on a non-dashboard page — so detail
pages (dimension drilldowns, tip pages) still highlight the correct parent
tab. The trailing `context` breadcrumb segment (the `›` + page label for
`/dimensions/[id]` and `/tips/[n]`) is preserved as-is.

## Two bug fixes riding along

The same PR closes two live rendering bugs, bundled in because both were only
discoverable while auditing every `var(--color-*)` reference during the
retheme. One is grounded in `app/globals.css` itself: `--color-bg`,
`--color-fg`, and `--color-card` were referenced elsewhere in the app but
never defined in `@theme`, so they resolved to an invalid color — concretely,
the `InsightsNarrative` component's button and a progression-timeline ring.
Defining the three as explicit aliases (`--color-bg` → ink, `--color-fg` →
text, `--color-card` → a subtle raised surface for the probes page) completes
the cascade and fixes both. The PR description did not fully specify the
second fix beyond that it shipped in the same commit — worth a follow-up pass
if it turns out to have its own doc-worthy behavior implications.

## Why bundle a retheme and bug fixes in one PR

Both fixes surfaced as a direct consequence of walking every color token
during the rewrite, and both are one-line `@theme` additions with no
independent blast radius — splitting them into a separate PR would have meant
re-auditing the same token list twice for no isolation benefit.
