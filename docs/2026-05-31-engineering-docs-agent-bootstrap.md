---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/100
synthesized_into: []
---

# Engineering-docs-agent bootstrap (PR #100)

PR #100 onboards `claude-code-self-assessment` onto the `engineering-docs-agent` pipeline. No scorer, component, or rubric logic changed — the entire diff is infrastructure. Four files land:

| File | Lines | Purpose |
| ---- | ----: | ------- |
| `.engineering-docs-agent/config.yml` | 46 | Plugin config; declares `framework: none` |
| `.engineering-docs-agent/state.example.yml` | — | Reference state file seeding initial plugin state |
| `.engineering-docs-agent/state.yml` | — | Live state file |
| `.github/workflows/docs-agent-nightly.yml` | 143 | Nightly GH Actions documentation maintenance run |

## What changed

### Plugin config: `framework: none`

The plugin config at `.engineering-docs-agent/config.yml` declares this repository as `framework: none`. That value was added as a first-class enum in engineering-docs-agent PR #84 (CCE-64). Before CCE-64 merged, the bootstrap branch had used a synthetic mkdocs scaffold to satisfy the plugin's older framework enum; once `framework: none` was valid, the scaffold was removed and the config was updated to match.

The config tells the agent which lens to run (`core`), where docs live, and that there is no static-site generator wrapping them — just plain Markdown under `docs/`.

### Nightly workflow

`.github/workflows/docs-agent-nightly.yml` triggers automated documentation maintenance on a schedule. It checks out the repo, exchanges for an app token, runs the docs-agent pipeline, and uploads forensics on failure. The 143-line file encapsulates the standard nightly shape the agent expects; the four prerequisite fixes below were necessary before this workflow could run end-to-end.

### Prerequisites that had to merge first

Four fixes in the engineering-docs-agent repo unblocked this bootstrap:

| Ticket | Fix |
| ------ | --- |
| CCE-45 | App-token wiring in the reusable workflow |
| CCE-49 | OAuth validation for the agent's API calls |
| CCE-41 | Forensics upload on workflow failure |
| CCE-53 | Jira wiring for ticket transitions at run end |

CCE-57 tracked the full onboarding work for this repository.

## What this means for the repo

The nightly workflow now runs against this repository. Pages the agent authors will carry the agent-authored frontmatter contract (`source_files`, `last_reviewed`, `status`). Existing hand-authored docs are unaffected — the agent only writes inside paths declared in its config. The `core` lens is the active lens; there is no `operations/` section in this repo, so agent-authored pages land as flat date-slug files at the lens root (the pattern this page follows).
