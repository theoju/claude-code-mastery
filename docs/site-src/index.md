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

This site itself is built with [mkdocs](https://www.mkdocs.org/) +
Material and published to GitHub Pages on every push to `main` that
touches `docs/site-src/**`, `mkdocs.yml`, or `requirements-docs.txt`
(`docs-agent-pages.yml`). A `mkdocs build --strict` check gates every
PR that touches the same paths, so a broken link fails the PR instead
of the deploy. See [What's New](whats-new.md#2026-06-02--docs-site-now-published-via-mkdocs)
for the migration writeup.

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

- Source: <https://github.com/theoju/claude-code-self-assessment>
- README: <https://github.com/theoju/claude-code-self-assessment/blob/main/README.md>
