---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/177
synthesized_into: []
doc_kind: decision
---

# 2026-07-30 — Dashboard retheme: warm/gold → cool-graphite

PR #177 rethemes the dashboard's visual design. It's a CSS-only change with
one incidental bug fix riding along; nothing about scoring, signals, or
routes moved.

## What changed

The entire palette lives in a single `@theme` token block in
`app/globals.css`, and the retheme touches only the values, not the names —
so every `var(--color-*)` reference across the app cascades without a single
call-site edit. The headline swap is the accent: `--color-accent` goes from
gold (`#d4a84b`) to electric blue (`#4d8bff`), backed by `--color-accent-2`
(`#3b82f6`, used for the notification dot) and `--color-accent-soft`
(`rgba(77, 139, 255, 0.13)`, used for tinted fills). Grounds and lines cool
down alongside it — `--color-ink` moves from a warm `#0b0d0f` to `#0a0a0d`,
`--color-panel` from `#12151a` to `#101116`, `--color-line` from `#2a313b`
to `#262b34` — the comment block at the top of `app/globals.css` calls the
result the "tray-icon dialect": a cool graphite instrument panel with a
single accent color doing all the interactive signaling.

`PageNav.tsx` picks up the new accent directly: the active tab renders as an
accent-tinted pill (`bg-[color:var(--color-accent-soft)]` with an
accent-mix border) instead of a plain underline, so the active-page cue
piggybacks on the same token swap.

## The incidental fix

Three tokens — `--color-bg`, `--color-fg`, and `--color-card` — were
referenced across the app (the `InsightsNarrative` button and a timeline
ring, per the `app/globals.css` comment) but never defined in the old
palette, so they rendered as invalid color wherever they were used. The
retheme's token pass defines all three as aliases (`--color-bg` → ink,
`--color-fg` → text, `--color-card` → a raised card surface distinct from
`--color-panel`), which fixes both broken references as a side effect of
completing the cascade rather than as a targeted bug fix.

## Also in this PR

An unrelated `.gitignore` chore rides along: entries for `graphify-out/`
(the `/graphify` knowledge-graph build output), `.tmp`, and
`.claude/worktrees/` were added so those tooling artifacts stop showing up
as untracked changes.

## Why this is a flat note, not an architecture update

Nothing here changes a data contract, a scoring rule, or a route — it's a
design-language pass over `app/globals.css` and one component's class
names. There's no existing architecture section in this lens for visual
design, so this PR gets a dated decision note rather than a rewrite of a
page that doesn't exist yet.
