---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/178
synthesized_into: []
doc_kind: decision
---

# Homebrew migration toolchain troubleshooting (2026-07-30)

A full session went into rediscovering two stacked toolchain failures that
followed a Homebrew Intel→ARM migration. Both are now codified as
`CLAUDE.md` Conventions entries so a recurrence is a two-minute lookup
instead of a repeat investigation. This page collects the diagnosis and the
fixes in one place.

## A missing binary is a PATH bug until proven otherwise

The trigger: a Homebrew Intel→ARM migration moves the formula prefix from
`/usr/local` to `/opt/homebrew`. Every formula installed under the old
prefix — `node`, `npm`, `gh` — is gone, so `node`, `npm`, and `gh` can vanish
even though `brew` itself still works.

**And Claude Code's shell is not your terminal's shell.** Two independent
failures stack here, and fixing only one leaves you confused:

- **(a) The tools are genuinely uninstalled.** Confirm with
  `brew list --versions node gh`. Empty output means they're really gone —
  reinstall with `brew install node gh`.
- **(b) `~/.zprofile` still evals a dead `brew`.** If it still runs
  `$(/usr/local/bin/brew shellenv)` for a `brew` binary that no longer
  exists, every **login** and **non-interactive** shell gets no Homebrew on
  PATH at all — while the **interactive** terminal keeps working, because it
  gets Homebrew via a separate `eval` in `~/.zshrc`. That split is the
  diagnostic signature: your terminal is fine, Claude Code's shell finds
  nothing.

Diagnose by comparing shell types before concluding a tool is uninstalled:

```bash
zsh -lc 'which node'   # login shell — reads .zprofile
zsh -ic 'which node'   # interactive shell — reads .zshrc
zsh -c  'which node'   # plain shell — reads only .zshenv
```

Fix `.zprofile` to point at `/opt/homebrew/bin/brew`. Leave `.zshenv` alone —
Homebrew recommends `.zprofile` for the `shellenv` eval, and putting it in
`.zshenv` would run it on every script invocation.

Two corollaries worth remembering:

1. An **already-running** Claude Code session inherits the PATH captured at
   session start and will not see the `.zprofile` fix. Use absolute paths
   (`/opt/homebrew/bin/gh`) to keep working in that session, and restart the
   session to pick up the fix properly.
2. `npm -g` packages installed under the old node are stranded in
   `/usr/local/lib/node_modules`. They still *run* — their shebangs resolve
   `node` via PATH — but stay frozen at their old version, which reads as
   stale-version warnings rather than outright breakage. Reinstalling each
   package with the new npm lands it in `/opt/homebrew` and shadows the
   orphan.

`/usr/local/bin` itself is **not** a dead Homebrew prefix on a migrated
machine — it can still hold live Docker, gcloud, or python.org tooling.
Don't clean it out wholesale.

## Broken `node_modules` after a node reinstall is usually the npm optional-dependency bug

Once `node` is back on PATH via the fix above, the next failure mode is a
vitest run that dies before any test executes, with an error like:

```
Cannot find module @rollup/rollup-darwin-arm64
```

This isn't a corrupt lockfile — it's the known npm optional-dependency bug
([npm/cli#4828](https://github.com/npm/cli/issues/4828)), triggered by
reinstalling node onto a different architecture prefix while
`node_modules` still reflects the old one.

Fix with:

```bash
npm ci
```

`npm ci` removes `node_modules` itself and reinstalls from the tracked
lockfile without rewriting `package-lock.json`. Prefer it over
`rm -rf node_modules package-lock.json && npm i`, which regenerates the
lockfile and can silently bump transitive versions — and which
`~/.claude/hooks/block-destructive.sh` would block anyway (see the
`rm -rf` note in the project's Conventions).

## Takeaway

Both failures were self-inflicted by the same migration and stacked on top
of each other: PATH resolution broke first, then reinstalling node broke
`node_modules`. Treat a missing binary as a shell/PATH question first
(login vs. interactive vs. plain), and treat a post-reinstall module
resolution error as the optional-dependency bug before reaching for a
destructive `node_modules` wipe.

See the full Conventions entries in the project's `CLAUDE.md` for the
canonical, load-bearing version of this guidance.
