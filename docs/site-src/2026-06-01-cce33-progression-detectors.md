---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
---

# CCE-33: Progression detectors for scheduled, remote, and verification

PR #108 closes the coverage gap filed as CCE-33. Before this change, three of the twelve scored dimensions — `scheduled`, `remote`, and `verification` — had no milestone detector in `scripts/progression.mjs`. Heavy usage in those dimensions produced no timeline entries, and the `/progression` view appeared frozen past the 2026-05-09 first-run wall for anyone whose work was concentrated there.

## Three new detectors

| Detector | Boris tip | Fires on first… |
| --- | --- | --- |
| `scheduled` | Tip 48 | `/loop`, `/schedule`, or `/babysit` invocation |
| `remote` | Tip 35 | `RemoteTrigger`, `PushNotification`, or `SendMessage` tool use |
| `verification` | Tip 73 | `/go` invocation |

Each milestone self-dates from the session `start_time` in `~/.claude/usage-data/session-meta/*.json`, scanning full transcript history. If you first ran `/go` six weeks before this PR merged, the `verification` milestone lands at that earlier date — not at the detector's ship date.

## Supporting change: `commands` field in `scanTranscriptModes`

`scripts/_usage-data.mjs::scanTranscriptModes` now builds a `commands: Set<string>` per session alongside the existing mode flags. The `scheduled` and `verification` detectors read this set to locate first command use without extra I/O passes over the transcript files.

## Dimension coverage after this PR

The progression catalog moves from 8 of 12 to **11 of 12** scored dimensions. The only remaining gap is `remote-context` (content / context dimensions), deferred as out of scope for this PR.

| Dimension | Detector |
| --- | --- |
| automation | ✅ pre-existing |
| integrations | ✅ pre-existing |
| learning | ✅ pre-existing |
| memory | ✅ pre-existing |
| model-effort | ✅ pre-existing |
| parallel | ✅ pre-existing |
| permissions | ✅ pre-existing |
| planning | ✅ pre-existing |
| scheduled | ✅ new — CCE-33 |
| remote | ✅ new — CCE-33 |
| verification | ✅ new — CCE-33 |
| remote-context | ❌ no detector yet |

## Probe-tracker sync

The probe-implementation-status tracker at `docs/superpowers/specs/2026-05-25-probe-implementation-status.md` is updated in the same PR. It gains a new Progression layer section and updated tip-coverage rows for tips 35, 48, and 73. Per the CLAUDE.md hard rule, tracker updates must ship in the same PR as the probe changes.

## Design artifacts

The spec and plan landed before the implementation and are committed under:

- `docs/superpowers/specs/2026-06-01-cce-33-progression-detectors-design.md`
- `docs/superpowers/plans/2026-05-31-cce-33-progression-detectors.md`

## What's still out of scope

The twelfth gap (`remote-context`) has no filed telemetry signal yet. When a reliable signal is identified, a separate CCE ticket will add the detector using the same pattern as these three.
