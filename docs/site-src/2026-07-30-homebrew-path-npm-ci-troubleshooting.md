---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/178
synthesized_into: []
doc_kind: decision
---

# Homebrew PATH failures and npm ci after an Intel→ARM migration

On 2026-07-30 a Homebrew Intel→ARM migration cost a full session to
diagnose because two independent failures stacked on top of each other and
looked, at first glance, like a single missing-tool bug. Both are now
captured as Conventions entries in `CLAUDE.md` so the next occurrence is a
two-minute lookup instead of a rediscovery.

## A missing binary is a PATH bug until proven otherwise

Migrating Homebrew from Intel to ARM moves the prefix from `/usr/local` to
`/opt/homebrew`. Every formula installed under the old prefix is gone —
`node`, `npm`, and `gh` can all vanish — while `brew` itself keeps working,
because it's the new ARM install that answers to `brew` on your interactive
PATH.

That surface symptom hides two separate problems:

1. **The tools are genuinely uninstalled.** Confirm with
   `brew list --versions node gh`. Empty output means they're really gone —
   reinstall with `brew install node gh`.
2. **`~/.zprofile` still evals a `brew` that no longer exists.** If your
   `.zprofile` runs `$(/usr/local/bin/brew shellenv)`, every **login** shell
   and every **non-interactive** shell gets no Homebrew environment at all —
   `brew` isn't on PATH, so `shellenv` never runs, so `node`/`gh`/etc. never
   get linked in. Meanwhile your **interactive** terminal keeps working fine,
   because `~/.zshrc` has its own, separate `eval` pointed at the correct
   `/opt/homebrew` path. That split — interactive shells fine, everything
   else broken — is the diagnostic signature. It's also exactly the shell
   Claude Code runs commands in: your terminal looks healthy while Claude
   Code's shell finds nothing.

**Diagnose by comparing shell types**, not by re-checking whether the binary
exists:

```bash
zsh -lc 'which node'   # login shell — reads .zprofile
zsh -ic 'which node'   # interactive shell — reads .zshrc
zsh -c  'which node'   # plain shell — reads only .zshenv
```

If `-ic` finds `node` but `-lc` doesn't, the fix is `.zprofile`, not a
reinstall. Point it at `/opt/homebrew/bin/brew` and leave `.zshenv` alone —
Homebrew's own recommendation is to eval `shellenv` from `.zprofile`, and
putting it in `.zshenv` instead would re-run it on every single script
invocation.

Two corollaries worth knowing before you conclude the fix didn't work:

- **An already-running Claude Code session inherits the PATH captured at
  session start.** Fixing `.zprofile` doesn't retroactively fix a session
  that's already running — use absolute paths (`/opt/homebrew/bin/gh`) to
  keep working in the current session, and restart the session to pick up
  the corrected PATH.
- **Global npm packages installed under the old node are stranded**, not
  broken. Anything under `/usr/local/lib/node_modules` still *runs* — its
  shebang resolves `node` via PATH — but it stays frozen at whatever version
  it was last installed at, which reads as a stale-version warning rather
  than an outright failure. Reinstalling each package with the new npm lands
  it under `/opt/homebrew` and shadows the orphaned copy.

Don't over-correct: `/usr/local/bin` is not a dead Homebrew prefix to be
cleaned out. It also holds live Docker, gcloud, and python.org tooling that
has nothing to do with Homebrew's move.

## Broken `node_modules` after a node reinstall is usually the npm optional-dependency bug

Once `node`/`npm` are back on PATH under the new prefix, a `node_modules`
directory built against the old node can fail in a way that looks like lockfile
corruption but isn't. The characteristic symptom is a missing platform-specific
optional dependency — for example, vitest failing at startup, before any test
runs, with:

```
Cannot find module @rollup/rollup-darwin-arm64
```

This is the known npm optional-dependency bug
([npm/cli#4828](https://github.com/npm/cli/issues/4828)), not a broken
`package-lock.json`.

Fix it with:

```bash
npm ci
```

`npm ci` removes `node_modules` itself and reinstalls strictly from the
tracked lockfile — no manual `rm -rf node_modules` needed (which
`block-destructive.sh` would block here anyway). Prefer it over
`rm node_modules package-lock.json && npm i`: that sequence regenerates the
lockfile from scratch and can silently bump transitive dependency versions
you didn't intend to touch.

## Reference

Full detail lives in the `CLAUDE.md` Conventions section (Homebrew
migration bullet and the adjacent `npm ci` bullet), landed via PR #178.
