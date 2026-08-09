---
title: Dashboard retheme — cool-graphite instrument panel
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/177
synthesized_into: []
doc_kind: decision
---

# Dashboard retheme: cool-graphite instrument panel (PR #177)

PR #177 replaced the dashboard's warm/gold visual design with a cool-graphite,
instrument-panel look built around a single electric-blue accent. The change
touches all 8 pages and 6 shared components — including `PageNav` — but the
diff that does the work is one file.

## Decision

Re-skin through the token layer, not page-by-page. The codebase is fully
token-driven: every surface reads color via `var(--color-*)`, with no
hard-coded grays scattered across components. That meant the whole retheme
could land as a rewrite of the `@theme` block in `app/globals.css`, and every
page and component would inherit the new palette automatically because they
never reference a raw hex value.

`PageNav.tsx` is a representative consumer — its active-tab state, hover
state, and breadcrumb divider are all wired through
`var(--color-accent)`, `var(--color-accent-soft)`, `var(--color-mute)`,
`var(--color-text)`, and `var(--color-line)` / `var(--color-line-2)`. None of
that file changed; it didn't need to.

## What changed in the token layer

`app/globals.css`'s `@theme` block keeps every original token **name** and
swaps the **value**, so no `var()` reference anywhere in the app needed
editing:

- Grounds: `--color-ink`, `--color-panel`, `--color-panel-2` moved from warm
  near-blacks (`#0b0d0f`, `#12151a`, `#1a1f26`) to cooler ones (`#0a0a0d`,
  `#101116`, `#171a21`).
- Lines: `--color-line` / `--color-line-2` cooled from `#2a313b`-family
  hairlines to `#262b34` / `#333a46`.
- Text: `--color-text` shifted from `#e6edf3` to `#e7eaef`; `--color-mute`
  cooled from `#8b96a6` to `#838b96`.
- Accent — the headline change: `--color-accent` moved from gold `#d4a84b`
  to electric blue `#4d8bff`, with `--color-accent-2` (`#3b82f6`, used for
  the notification dot) and `--color-accent-soft` (a 13%-alpha blue wash)
  following it.
- Semantic colors (`--color-good`, `--color-warn`, `--color-bad`) stayed
  deliberately distinct from the new accent so status coloring doesn't get
  confused with interactive/emphasis coloring.

The rewrite also defines three **compat aliases** — `--color-bg`,
`--color-fg`, `--color-card` — that were referenced in components but never
actually defined in the old `@theme` block. Two of those gaps were rendering
as invalid color: the `InsightsNarrative` button and the progression
timeline ring. Filling them in was a side-effect bugfix bundled into the
retheme, not a separate change.

## Where this page lives

There's no `architecture/`, `operations/`, or `archive/` subsection under the
`core` lens yet — the lens root only has an `images/` directory. This page is
filed flat at the lens root as a dated entry rather than nested under a
section that doesn't exist. Revisit its placement once those subsections
exist.

## Impact

Purely visual/CSS-token — no API surface, scoring logic, or data model
changed. `app/globals.css` is the only file with load-bearing edits; anything
downstream (dashboard tiles, radar, methodology tables, nav) picks up the new
palette for free because it was already reading tokens rather than hex
values.
