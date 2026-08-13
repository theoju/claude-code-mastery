---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/178
synthesized_into: []
doc_kind: decision
---

# Homebrew PATH drift + npm ci: a 2026-07-30 troubleshooting session

A 2026-07-30 session lost a full session's worth of time to two stacked
toolchain failures that both traced back to the same root cause: a Homebrew
Intel→ARM migration. Neither failure was a Claude Code bug, but the symptom
read like one — commands that worked fine in an interactive terminal
mysteriously failed inside Claude Code's shell. `CLAUDE.md`'s Conventions
section now codifies the diagnosis and the fix so a recurrence is a
two-minute lookup instead of a rediscovery.

## Symptom: a missing binary is a PATH bug until proven otherwise

After a Homebrew migration from `/usr/local` (Intel) to `/opt/homebrew`
(Apple Silicon), every formula installed under the old prefix is gone —
`node`, `npm`, `gh` can all vanish while `brew` itself keeps working. Two
independent failures stack, and fixing only one leaves you confused:

- **(a) The tools are genuinely uninstalled.** Confirm with
  `brew list --versions node gh` — empty output means they're really gone;
  reinstall with `brew install node gh`.
- **(b) `~/.zprofile` still evals a dead `brew shellenv`.** If it still runs
  `$(/usr/local/bin/brew shellenv)` for a `brew` binary that no longer
  exists, every **login** and **non-interactive** shell gets no Homebrew on
  its PATH at all — while the **interactive** terminal keeps working, because
  it picks up a separate `eval` in `~/.zshrc`.

That split is the diagnostic signature: the terminal is fine, and Claude
Code's shell finds nothing. **Claude Code's shell is not your terminal's
shell** — don't trust "it works when I run it myself" as evidence the
tooling is intact.

### Diagnose by comparing shell types

Before concluding a tool is uninstalled, compare what each shell type
actually resolves:

```bash
zsh -lc 'which node'   # login shell — reads .zprofile
zsh -ic 'which node'   # interactive shell — reads .zshrc
zsh -c  'which node'   # plain shell — reads only .zshenv
```

If the login and plain forms come up empty while the interactive form
resolves fine, the fault is (b): a stale `brew shellenv` reference in
`.zprofile`, not a missing install.

### Fix

Point `.zprofile` at the new prefix:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Leave `.zshenv` alone — Homebrew's own guidance is to put `shellenv` in
`.zprofile`, since `.zshenv` runs on every script invocation, not just login
shells.

### Two corollaries

- **An already-running Claude Code session won't see the fix.** It inherited
  the PATH captured at session start. Use absolute paths
  (`/opt/homebrew/bin/gh`) to keep working in the current session, and
  restart the session to pick up the corrected PATH.
- **Orphaned global npm packages read as stale-version warnings, not
  breakage.** Anything installed with `npm -g` under the old node is
  stranded in `/usr/local/lib/node_modules`. Those packages still *run* —
  their shebangs resolve `node` via PATH — but stay frozen at whatever
  version they were at when the migration happened. Reinstalling each one
  with the new npm lands it under `/opt/homebrew` and shadows the orphan.

Don't over-correct: `/usr/local/bin` itself is not a dead Homebrew prefix.
It can still hold live Docker, gcloud, or python.org tooling — never clean
it out wholesale while chasing this issue.

## Follow-on: `Cannot find module @rollup/rollup-darwin-arm64`

Once the PATH was fixed and `node`/`npm` resolved to the new Homebrew
prefix, `npx vitest run` failed at startup — before any test ran — with:

```
Cannot find module @rollup/rollup-darwin-arm64
```

This reads like a corrupt lockfile, but it's actually a known npm
optional-dependency bug
([npm/cli#4828](https://github.com/npm/cli/issues/4828)): a `node_modules`
tree assembled under one architecture's node install doesn't cleanly resolve
platform-specific optional deps after the underlying node binary changes
out from under it.

### Fix: `npm ci`, not `rm -rf node_modules`

```bash
npm ci
```

`npm ci` removes `node_modules` itself and reinstalls strictly from the
tracked lockfile, without rewriting `package-lock.json`. Prefer it over
`rm node_modules package-lock.json && npm i` for two reasons:

- It needs no destructive shell command — `block-destructive.sh` blocks
  `rm -rf` even against nominally-safe targets like `node_modules/`, so
  reaching for `rm -rf` here just adds friction.
- `npm i` after deleting the lockfile regenerates it and can silently bump
  transitive dependency versions; `npm ci` reinstalls exactly what's
  committed.

## Takeaways

- Treat a missing-binary failure as a PATH bug first, confirmed or ruled out
  via the three-way `zsh -lc` / `zsh -ic` / `zsh -c` comparison, before
  assuming a tool is uninstalled.
- Remember that Claude Code's shell environment can diverge from your
  interactive terminal's, particularly right after a toolchain migration.
- If vitest (or any node tool) fails at startup with a missing
  platform-specific optional dependency after a node reinstall, reach for
  `npm ci` before suspecting the lockfile itself.

Both lessons are captured as permanent entries in `CLAUDE.md`'s Conventions
section, dated to the 2026-07-30 session that surfaced them.
