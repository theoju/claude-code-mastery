---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/121
synthesized_into: []
---

# Claude Code Self-Assessment

A personal dashboard that scores your Claude Code usage against
[Boris Cherny's 87 workflow tips](https://howborisusesclaudecode.com)
and a two-axis Self-Assessment rubric. All scoring is local — no
telemetry, no external service, nothing leaves your machine unless
you enable the Slack notifier.

This docs site is published at
**<https://theoju.github.io/claude-code-self-assessment/>** and rebuilt
automatically on every push to `main` via GitHub Actions (`docs-agent-pages.yml`).
Pull requests run a `mkdocs build --strict` gate (`docs-build-check.yml`)
so broken links are caught before they reach the live site.

## Read next

- **[Self-Assessment](self-assessment.md)** — the full scorer guide
  (how the two axes are computed, what each dimension measures, how
  the trend history works).
- **[Ship Pattern](ship-pattern.md)** — the recommended `/ship` slash
  command shape (8-stage personal shipping chain).
- **Reference** — full tip catalog and classification breakdown.
- **[What's New](whats-new.md)** — release notes and recent changes
  (curated by the engineering-docs-agent).

## Project links

- Live docs: <https://theoju.github.io/claude-code-self-assessment/>
- Source: <https://github.com/theoju/claude-code-self-assessment>
- README: <https://github.com/theoju/claude-code-self-assessment/blob/main/README.md>
