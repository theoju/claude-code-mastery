---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/178
synthesized_into: []
doc_kind: decision
---

# Homebrew migration: PATH split and the npm optional-dependency bug

A 2026-07-30 diagnosis session on this machine cost a full session because two
independent toolchain failures stacked and produced a signature that looked,
at first glance, like a Claude Code bug. Neither failure was. This page
captures the diagnostic recipe so a recurrence is a two-minute lookup instead
of a rediscovery. The underlying convention lives in this repo's `CLAUDE.md`;
this page is the shareable write-up.

## The setup: an Intel→ARM Homebrew migration

Migrating Homebrew from Intel (`/usr/local`) to ARM (`/opt/homebrew`) removes
every formula from the old prefix. `node`, `npm`, and `gh` can vanish from
`/usr/local` while `brew` itself keeps working — `brew` is usually reinstalled
early, before you've noticed the rest of your toolchain went with the old
prefix.

**A missing binary is a PATH bug until proven otherwise — and Claude Code's
shell is not your terminal's shell.** Two failures stack here, and fixing only
one leaves you confused:

1. **The tools are genuinely uninstalled.** Confirm with
   `brew list --versions node gh`. Empty output means they're really gone —
   reinstall with `brew install node gh`.
2. **`~/.zprofile` still evals a `brew shellenv` for a `brew` that no longer
   exists at the old path** (e.g. `$(/usr/local/bin/brew shellenv)`). Every
   **login** and **non-interactive** shell gets no Homebrew at all as a
   result, while the **interactive** terminal keeps working — because
   `~/.zshrc` carries its own, separate `eval`. That split is the diagnostic
   signature: your terminal is fine, Claude Code's shell finds nothing.

### Diagnose by comparing shell types

Before concluding a tool is uninstalled, compare across the three zsh
invocation modes, since each reads a different subset of your dotfiles:

```bash
zsh -lc 'which node'   # login shell — reads ~/.zprofile
zsh -ic 'which node'   # interactive shell — reads ~/.zshrc
zsh -c  'which node'   # plain shell — reads only ~/.zshenv
```

If the interactive form finds `node` but the login form doesn't, the problem
is `~/.zprofile`, not a missing install. Fix it to point at
`/opt/homebrew/bin/brew`. Leave `~/.zshenv` alone — Homebrew's own guidance is
to put the `shellenv` eval in `~/.zprofile`, not `~/.zshenv`, since the latter
runs on every script invocation, not just login shells.

### Two corollaries

- **An already-running Claude Code session inherits the PATH captured at
  session start** and will not see a `~/.zprofile` fix applied mid-session.
  Use absolute paths (`/opt/homebrew/bin/gh`) to keep working in that session,
  and restart the session to pick up the fix.
- **`npm -g` packages installed under the old node are stranded** in
  `/usr/local/lib/node_modules`. They still *run* — their shebangs resolve
  `node` via PATH — but stay frozen at whatever version they were at when the
  old node was removed. This reads as a stale-version warning, not breakage.
  Reinstalling each package with the new npm lands it in `/opt/homebrew` and
  shadows the orphan.

### Don't wipe `/usr/local/bin`

`/usr/local/bin` is not a dead Homebrew prefix once the migration is done — it
also holds live Docker, `gcloud`, and python.org tooling that has nothing to
do with Homebrew. Clean out only the Homebrew-owned entries you've confirmed
are orphaned; never clear the directory wholesale.

## The second failure: broken `node_modules` after reinstalling node

Once `node` and `npm` are back on the new prefix, `node_modules` installed
under the *old* node can still fail at test-run time — before any test even
executes:

```
Cannot find module @rollup/rollup-darwin-arm64
```

This is npm's known optional-dependency bug
([npm/cli#4828](https://github.com/npm/cli/issues/4828)), not a corrupt
lockfile, and it's easy to misdiagnose as one after a fresh node install.

**Fix with `npm ci`**, not a destructive reinstall:

```bash
npm ci
```

`npm ci` removes `node_modules` itself and reinstalls strictly from the
tracked lockfile, without rewriting `package-lock.json`. Prefer it over
`rm node_modules package-lock.json && npm i` (`block-destructive.sh` blocks
`rm -rf` in this environment anyway), which regenerates the lockfile and can
silently bump transitive dependency versions along the way.

## Summary

| Symptom | Real cause | Fix |
| --- | --- | --- |
| `node`/`npm`/`gh` missing in Claude Code's shell but present in your terminal | Stale `brew shellenv` eval in `~/.zprofile` pointing at the old prefix | Point `~/.zprofile` at `/opt/homebrew/bin/brew`; leave `~/.zshenv` alone |
| `brew list --versions` reports the formula truly absent | Genuinely uninstalled during the migration | `brew install <formula>` |
| `Cannot find module @rollup/rollup-darwin-arm64` at vitest startup | npm's optional-dependency bug after a node reinstall, not a corrupt lockfile | `npm ci` |
| Global npm package looks stuck on an old version | Orphaned under the old node's `/usr/local/lib/node_modules`, still running via PATH-resolved shebang | Reinstall the package under the new npm |

None of this is a Claude Code defect. It's ordinary Homebrew-migration
fallout that happens to surface differently depending on which shell mode
reads it — worth the full diagnostic recipe above precisely because the
first read looks like a tooling regression.
