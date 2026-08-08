---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/178
synthesized_into: []
doc_kind: decision
---

# Homebrew PATH and npm ci gotchas (2026-07-30)

A Homebrew Intel→ARM migration on the authoring machine (`/usr/local` →
`/opt/homebrew`) burned a full session before landing on two stacked,
easy-to-misdiagnose failure modes. Neither is specific to this repo, but
both are now codified in `CLAUDE.md` so a recurrence is a lookup, not
another multi-hour diagnosis. This page captures the same troubleshooting
knowledge for anyone hitting the same wall outside a Claude Code session.

## A missing binary is a PATH bug until proven otherwise

Migrating Homebrew from `/usr/local` to `/opt/homebrew` removes every
formula installed under the old prefix — `node`, `npm`, and `gh` can all
vanish while `brew` itself keeps working. Two independent failures stack
here, and fixing only one leaves you confused:

1. **The tools are genuinely uninstalled.** Confirm with
   `brew list --versions node gh`. Empty output means they're really gone;
   reinstall with `brew install node gh`.
2. **`~/.zprofile` still points at the old `brew`.** If it still evals
   `$(/usr/local/bin/brew shellenv)` for a `brew` binary that no longer
   exists there, every **login** and **non-interactive** shell gets no
   Homebrew on `PATH` at all — while the **interactive** terminal keeps
   working, because it separately evals `shellenv` in `~/.zshrc`.

That split is the diagnostic signature: your terminal is fine, but
**Claude Code's shell is not your terminal's shell** — it runs
non-interactively and inherits whichever `PATH` the non-interactive/login
path produces. Diagnose by comparing shell types directly, before
concluding a tool is uninstalled:

```bash
zsh -lc 'which node'   # login shell — reads .zprofile
zsh -ic 'which node'   # interactive shell — reads .zshrc
zsh -c  'which node'   # plain shell — reads only .zshenv
```

If the interactive form finds `node` but the login form doesn't, the fix
is in `.zprofile`, not a reinstall: point it at
`/opt/homebrew/bin/brew`. Leave `.zshenv` alone — Homebrew recommends
`.zprofile` for `shellenv`, since a `.zshenv` eval runs on every single
script invocation.

Two corollaries worth knowing before you go looking for a second bug:

- **An already-running session won't pick up the fix.** It inherited the
  `PATH` captured at session start. Use absolute paths
  (`/opt/homebrew/bin/gh`) to keep working in the current session, and
  restart to pick up the corrected `.zprofile`.
- **Old global npm packages are stranded, not broken.** Anything installed
  with `npm -g` under the old node lives on in
  `/usr/local/lib/node_modules`. It still *runs* — its shebang resolves
  `node` via `PATH` same as anything else — but stays frozen at its old
  version, which reads as a stale-version warning rather than an outright
  failure. Reinstalling each package with the new npm lands it under
  `/opt/homebrew` and shadows the orphan. Don't clean out `/usr/local/bin`
  wholesale while you're in there, either — it's not a dead Homebrew
  prefix; it can hold live Docker, gcloud, or python.org tooling that has
  nothing to do with the migration.

## `Cannot find module @rollup/rollup-darwin-arm64` after a node reinstall

Once `node`/`npm` are back on `PATH`, a second failure mode can surface:
vitest fails at startup, before any test runs, with something like
`Cannot find module @rollup/rollup-darwin-arm64`. This looks like a
corrupted `node_modules` or a bad lockfile, but it's almost always the
well-known npm optional-dependency bug
([npm/cli#4828](https://github.com/npm/cli/issues/4828)) — npm's handling
of platform-specific optional dependencies (like Rollup's native
`@rollup/rollup-*` binaries) gets left in an inconsistent state across a
node reinstall.

The fix is `npm ci`, not a manual `rm -rf node_modules && npm i`:

```bash
npm ci
```

`npm ci` removes `node_modules` itself and reinstalls strictly from the
tracked `package-lock.json`, without rewriting the lockfile. That's a
better outcome on two counts: you don't need `rm -rf` (which this repo's
`~/.claude/hooks/block-destructive.sh` blocks anyway, even against
allowed targets like `node_modules/`), and you don't risk `npm i`
silently bumping transitive dependency versions while regenerating the
lockfile.

## Takeaway

Both failures share a shape: the symptom (missing binary, failing test
runner) points at the wrong layer. The PATH gotcha looks like a missing
install but is actually a shell-startup-file mismatch between
interactive and non-interactive shells; the npm gotcha looks like a
corrupted dependency tree but is actually a known optional-dependency
resolution bug with a one-command fix. In both cases, diagnosing the
*actual* layer (shell type; npm's lockfile-vs-`node_modules` contract)
took less time than the first guess would have cost to unwind.
