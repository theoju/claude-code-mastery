---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/178
synthesized_into: []
doc_kind: decision
---

# Homebrew Intel→ARM migration: PATH split and the npm ci gotcha

Encountered 2026-07-30; cost a full session's diagnosis before both root
causes were pinned down. Codified in `CLAUDE.md` Conventions so the next
occurrence is a two-minute lookup instead of a repeat rediscovery.

## A missing binary is a PATH bug until proven otherwise

A Homebrew Intel→ARM migration (`/usr/local` → `/opt/homebrew`) removes every
formula in the old prefix, so `node`, `npm`, and `gh` can vanish while `brew`
itself still works. What made this one expensive is that **two independent
failures stack**, and fixing only one leaves you confused:

1. **The tools are genuinely uninstalled.** Confirm with
   `brew list --versions node gh` — empty output means really gone, fixed by
   `brew install node gh`.
2. **`~/.zprofile` still evals `$(/usr/local/bin/brew shellenv)` for a `brew`
   that no longer exists.** Every login and non-interactive shell gets no
   Homebrew at all, while the interactive terminal keeps working via the
   separate `eval` in `~/.zshrc`.

That split is the diagnostic signature: your terminal is fine, and Claude
Code's shell finds nothing, because **Claude Code's shell is not your
terminal's shell.** Diagnose by comparing shell types before concluding a
tool is uninstalled:

```bash
zsh -lc 'which node'   # login shell — reads .zprofile
zsh -ic 'which node'   # interactive shell — reads .zshrc
zsh -c 'which node'    # plain shell — reads only .zshenv
```

Fix `.zprofile` to point at `/opt/homebrew/bin/brew`; leave `.zshenv` alone
(Homebrew recommends `.zprofile`, and putting `shellenv` in `.zshenv` runs it
on every script invocation).

Two corollaries worth keeping in mind while you're mid-fix:

- An **already-running** Claude Code session inherits the PATH captured at
  session start and will not see the fix. Use absolute paths
  (`/opt/homebrew/bin/gh`) to keep working, then restart the session to pick
  up the corrected PATH.
- `npm -g` packages installed under the old node are stranded in
  `/usr/local/lib/node_modules`: they still run (their shebangs resolve
  `node` via PATH) but stay frozen at their old version, which reads as
  stale-version warnings rather than outright breakage. Reinstalling each
  package with the new npm lands it in `/opt/homebrew` and shadows the
  orphan.

`/usr/local/bin` itself is **not** a dead Homebrew prefix — it holds live
Docker/gcloud/python.org tooling. Don't clean it out wholesale while chasing
this.

## Broken node_modules after a node reinstall: it's the npm optional-dependency bug, not a corrupt lockfile

A node reinstall on the new architecture can leave `node_modules` broken in a
way that looks like lockfile corruption but isn't. The symptom: something
like `Cannot find module @rollup/rollup-darwin-arm64` failing vitest at
startup, before any test runs. This is the known npm optional-dependency bug
([npm/cli#4828](https://github.com/npm/cli/issues/4828)), not a corrupted
`package-lock.json`.

Fix with:

```bash
npm ci
```

`npm ci` removes `node_modules` itself — no `rm -rf` needed, which
`block-destructive.sh` blocks anyway — and reinstalls from the tracked
lockfile without rewriting `package-lock.json`. Prefer it over
`rm node_modules package-lock.json && npm i`, which regenerates the lockfile
and can silently bump transitive versions.

## Reference

Both gotchas are codified as Conventions entries in this repo's `CLAUDE.md`:
the PATH-split entry and the `npm ci` entry, adjacent to each other, both
dated 2026-07-30.
