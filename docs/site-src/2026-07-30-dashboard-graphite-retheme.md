---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/177
synthesized_into: []
doc_kind: decision
---

# Dashboard retheme: warm/gold → cool-graphite (PR #177)

The dashboard's global visual design moved from a warm/gold palette to a
cool-graphite instrument-panel look with a single electric-blue accent. This
is a visual change only — no scoring model, signal, or data-shape impact.

## What changed

Everything lives in one file: `app/globals.css`. The codebase is fully
token-driven (`var(--color-*)` everywhere, no hard-coded grays), so a single
`@theme` rewrite there re-skins all 8 pages and 6 shared components in one
pass. The comment at the top of the file spells out the migration contract:
original token **names** are kept, only their **values** changed, so
page-level `var()` references cascade without any per-page edits.

Ground surfaces went cooler and darker — `--color-ink` (canvas) moved from a
warm `#0b0d0f` to `#0a0a0d`, `--color-panel` from `#12151a` to `#101116`, and
the hairline `--color-line` from `#2a313b` to a cooler `#262b34`. Text and
icon tokens (`--color-text`, `--color-icon`, `--color-mute`, `--color-faint`)
followed the same cooling shift. The headline change is the accent:
`--color-accent` moved from `#d4a84b` gold to `#4d8bff` electric blue, with
`--color-accent-2` and `--color-accent-soft` (a translucent blue wash) added
alongside it. Semantic colors (`--color-good`, `--color-warn`, `--color-bad`)
were kept deliberately distinct from the accent so status coloring doesn't
get confused with interactive-blue.

The rewrite also fixed a latent bug: `--color-bg`, `--color-fg`, and
`--color-card` were referenced elsewhere in the app (the `InsightsNarrative`
button and a timeline ring, per the file's own comment) but were never
defined as theme tokens, so they rendered as invalid color. `globals.css` now
defines them as explicit aliases (`--color-bg` = ink, `--color-fg` = text,
`--color-card` = a subtle raised surface for the probes page), closing the
gap as a side effect of the retheme.

New shared primitives shipped in the same pass:

- **`.card`** — the dominant container primitive: panel background, hairline
  border, and the new `--shadow-card` depth treatment.
- **`.icon-btn`** — the rounded-square control used for icon actions (search
  / bell / help), with hover and active states and a `.dot-badge` for
  notification dots.
- **`.pill` / `.pill-accent`** — chip styling, with the accent variant using
  `--color-accent` and `--color-accent-soft`.
- Blue `:focus-visible` outlines and a blue `::selection` highlight, replacing
  the gold equivalents.
- Thin, cool scrollbars (`scrollbar-color: var(--color-line-2) transparent`)
  to match the instrument-panel feel.
- A faint top-center radial accent glow on `body` (`rgba(77, 139, 255,
0.06)` fading to transparent) — atmosphere, not noise, per the file's own
  framing.

`app/components/PageNav.tsx`, the shared nav rendered on every page, was
updated to match: the active nav item's highlight now uses
`var(--color-accent)` / `var(--color-accent-soft)` for its text, background,
and border instead of the old gold tokens, and the inactive/hover states
route through the same cooled `--color-mute` / `--color-text` / `--color-line-2`
tokens.

## Why

The retheme was a one-file change specifically because the app was already
disciplined about not hard-coding colors — every surface reads from the
`@theme` token layer. That discipline is what made a full-dashboard re-skin
tractable as a single PR instead of a page-by-page sweep.

## Scope and impact

- Purely visual/UI. No changes to scoring, signals, `assessment.json` shape,
  or any of the scripts under `scripts/`.
- Applies globally: all 8 pages and 6 shared components inherit the palette
  because they consume the same CSS custom properties.
- No existing architecture page in the `core` lens covers dashboard theming
  specifically, so this is filed as a dated decision note rather than folded
  into an existing page.
