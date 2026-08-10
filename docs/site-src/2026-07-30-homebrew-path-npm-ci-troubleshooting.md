---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/178
synthesized_into: []
doc_kind: decision
---

# Homebrew PATH + `npm ci`: toolchain troubleshooting (2026-07-30)

A 2026-07-30 session lost a full session's worth of time to a stacked pair of
toolchain failures after a Homebrew version correction (Intel → ARM) removed
`node` and `gh` from the old prefix. Two independent failures compound here,
and fixing only one leaves you confused. This page exists so the second time
this happens, it's a lookup, not a rediscovery — the underlying detail lives
in `CLAUDE.md`'s Conventions section; this is the narrated version.

## A missing binary is a PATH bug until proven otherwise

Claude Code's shell is not your terminal's shell. Don't assume a `command not
found` for `node`, `npm`, or `gh` means the tool is uninstalled — a Homebrew
Intel→ARM migration (`/usr/local` → `/opt/homebrew`) removes every formula
from the old prefix, and two independent failures stack:

- **(a) The tools are genuinely uninstalled.** Confirm with
  `brew list --versions node gh`. Empty output means they're really gone;
  reinstall with `brew install node gh`.
- **(b) `~/.zprofile` still points at the dead prefix.** If it still evals
  `$(/usr/local/bin/brew shellenv)` for a `brew` binary that no longer
  exists there, every **login** and **non-interactive** shell gets no
  Homebrew on `PATH` at all — while the **interactive** terminal keeps
  working, because `~/.zshrc` has its own separate `eval`. That split is the
  diagnostic signature: your terminal is fine, Claude Code's shell finds
  nothing.

### Diagnose with a three-way shell comparison

Before concluding a tool is uninstalled, compare what each shell type
resolves:

```bash
zsh -lc 'which node'   # login shell — reads .zprofile
zsh -ic 'which node'   # interactive shell — reads .zshrc
zsh -c 'which node'    # plain shell — reads only .zshenv
```

If the interactive invocation finds `node` but the login invocation doesn't,
the fix is `.zprofile`, not a reinstall: point it at
`/opt/homebrew/bin/brew`. Leave `.zshenv` alone — Homebrew recommends
`.zprofile` for `shellenv`, since a `.zshenv` eval runs on every script
invocation.

### Two corollaries

1. **An already-running Claude Code session inherits the PATH captured at
   session start** and won't see the `.zprofile` fix. Use absolute paths
   (`/opt/homebrew/bin/gh`) to keep working in that session, and restart to
   pick up the corrected `PATH`.
2. **Global npm packages installed under the old node are stranded**, not
   broken. Packages under `/usr/local/lib/node_modules` still _run_ — their
   shebangs resolve `node` via `PATH` — but stay frozen at their old
   version, which reads as stale-version warnings rather than outright
   breakage. Reinstalling each package with the new npm lands it under
   `/opt/homebrew` and shadows the orphan.

Don't clean out `/usr/local/bin` wholesale as part of this fix — it isn't a
dead Homebrew prefix. It also holds live Docker/gcloud/python.org tooling.

## Broken `node_modules` after a node reinstall: reach for `npm ci`

Once `node`/`npm` are back on `PATH`, a second, unrelated failure often
follows: vitest fails at startup, before any test runs, with something like
`Cannot find module @rollup/rollup-darwin-arm64`. Read that as
[npm's optional-dependency bug](https://github.com/npm/cli/issues/4828)
(npm/cli#4828), not a corrupt lockfile.

Fix with:

```bash
npm ci
```

`npm ci` removes `node_modules` itself — no `rm -rf` needed, which
`~/.claude/hooks/block-destructive.sh` blocks anyway — and reinstalls
strictly from the tracked lockfile without rewriting `package-lock.json`.
Prefer it over `rm node_modules package-lock.json && npm i`: that sequence
regenerates the lockfile from scratch and can silently bump transitive
versions along the way.

## Summary

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `node`/`gh` missing in Claude Code's shell but fine in your terminal | `.zprofile` still evals a dead `/usr/local/bin/brew` | Point `.zprofile` at `/opt/homebrew/bin/brew`; restart the session |
| `brew list --versions node gh` returns nothing | Formula genuinely removed by the migration | `brew install node gh` |
| Global npm CLI stuck on an old version after the migration | Package installed under the old node, PATH now resolves the new one | Reinstall the package with the new npm |
| `vitest` fails at startup with `Cannot find module @rollup/rollup-darwin-arm64` | npm optional-dependency bug (npm/cli#4828), not a corrupt lockfile | `npm ci` |

See `CLAUDE.md` → Conventions for the canonical, version-controlled source of
this guidance.
