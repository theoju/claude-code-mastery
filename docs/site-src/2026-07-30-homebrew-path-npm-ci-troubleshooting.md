---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/178
synthesized_into: []
doc_kind: decision
---

# Homebrew PATH + `npm ci` troubleshooting (2026-07-30 incident)

A Homebrew Intel→ARM migration on 2026-07-30 cost a full session to diagnose
because two independent failure modes stacked and looked, at first glance,
like one bug. This page captures the diagnostic recipe so a future session
doesn't have to re-derive it from scratch. It mirrors the two
`## Conventions` entries added to `CLAUDE.md` in PR #178 — treat `CLAUDE.md`
as canonical if the two ever drift.

## A missing binary is a PATH bug until proven otherwise

A Homebrew formula migration (`/usr/local` → `/opt/homebrew`) removes every
formula that lived in the old prefix, so `node`, `npm`, and `gh` can vanish
while `brew` itself still works. When that happens, two independent failures
stack — and fixing only one leaves you confused:

1. **The tools are genuinely uninstalled.** Confirm with
   `brew list --versions node gh`. Empty output means they're really gone;
   `brew install node gh` puts them back.
2. **`~/.zprofile` still evals a dead `brew shellenv`.** If it still points at
   `$(/usr/local/bin/brew shellenv)` for a `brew` binary that no longer
   exists, every **login** and **non-interactive** shell gets no Homebrew on
   PATH at all — while the **interactive** terminal keeps working, because
   `~/.zshrc` has its own separate `eval`.

That split is the diagnostic signature: your terminal is fine, and
**Claude Code's shell is not your terminal's shell** — it finds nothing.
Diagnose by comparing shell types before concluding a tool is uninstalled:

```bash
zsh -lc 'which node'   # login shell, reads .zprofile
zsh -ic 'which node'   # interactive shell, reads .zshrc
zsh -c  'which node'   # plain shell, reads only .zshenv
```

Fix `.zprofile` to point at `/opt/homebrew/bin/brew`. Leave `.zshenv` alone —
Homebrew recommends `.zprofile` for the `shellenv` eval, and putting it in
`.zshenv` would run it on every script invocation.

Two corollaries worth remembering:

- **An already-running Claude Code session inherits the PATH captured at
  session start** and will not see the fix. Use absolute paths
  (`/opt/homebrew/bin/gh`) to keep working in that session, and restart to
  pick up the corrected PATH.
- **`npm -g` packages installed under the old node are stranded** in
  `/usr/local/lib/node_modules`. They still *run* — their shebangs resolve
  `node` via PATH — but stay frozen at their old version. This reads as
  stale-version warnings rather than outright breakage. Reinstalling each
  package with the new npm lands it in `/opt/homebrew` and shadows the
  orphan.

`/usr/local/bin` itself is **not** a dead Homebrew prefix on a migrated
machine — it can still hold live Docker/gcloud/`python.org` tooling. Don't
clean it out wholesale while chasing this.

## Broken `node_modules` after a node reinstall is usually the npm optional-dependency bug

Once `node`/`npm` are back on PATH, a second, unrelated failure often
surfaces: `vitest` fails at startup, before any test runs, with something
like `Cannot find module @rollup/rollup-darwin-arm64`. That's not a corrupt
lockfile — it's the long-standing npm optional-dependency bug
([npm/cli#4828](https://github.com/npm/cli/issues/4828)), where npm's
platform-specific optional dependencies get resolved incorrectly across a
node reinstall.

Fix it with:

```bash
npm ci
```

`npm ci` removes `node_modules` itself (no `rm -rf` needed — and
`block-destructive.sh` would block that anyway) and reinstalls strictly from
the tracked lockfile, without rewriting `package-lock.json`. Prefer it over
`rm node_modules package-lock.json && npm i`, which regenerates the lockfile
and can silently bump transitive versions along the way.

## Summary

| Symptom | Root cause | Fix |
| --- | --- | --- |
| `node`/`gh` missing in Claude Code's shell, but fine in your terminal | Stale `.zprofile` `brew shellenv` pointing at an uninstalled `brew`, stacked with a genuine formula uninstall from the Intel→ARM migration | `brew list --versions node gh` to check what's really gone; reinstall as needed; fix `.zprofile` to `/opt/homebrew/bin/brew`; restart any already-running session |
| `vitest` fails at startup with `Cannot find module @rollup/rollup-darwin-arm64` | npm optional-dependency resolution bug after a node reinstall | `npm ci` |

Both entries are also codified in this repo's `CLAUDE.md` under
`## Conventions`, which future sessions load automatically as project memory.
