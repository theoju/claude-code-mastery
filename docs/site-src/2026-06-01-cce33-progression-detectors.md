---
status: draft
sources:
  - https://github.com/theoju/claude-code-self-assessment/pull/108
synthesized_into: []
---

# CCE-33: Progression detectors for `scheduled`, `remote`, and `verification`

PR #108 closes the `/progression` timeline coverage gap that left the three
dimensions with no milestone detectors. Before this change, heavy real usage
in `scheduled`, `remote`, or `verification` produced no entry in the
progression timeline — the timeline appeared frozen past the 2026-05-09
tracking-start wall even for engineers actively using those workflows.

## What changed

Three new telemetry-dated detectors were added to `scripts/progression.mjs`:

| Detector | Boris tip | Fires on first… |
| --- | --- | --- |
| `scheduled` | tip 48 | `/loop`, `/schedule`, or `/babysit` command invocation |
| `remote` | tip 35 | `RemoteTrigger`, `PushNotification`, or `SendMessage` tool invocation |
| `verification` | tip 73 | `/go` command invocation |

`scripts/_usage-data.mjs`'s `scanTranscriptModes` was extended with a
per-session `commands: Set<string>` field. The `scheduled` and `verification`
detectors read command names from that set; the `remote` detector reads tool
invocation names from the same transcript scan path.

## Backdated timestamps, not first-run stamps

The key property of telemetry-dated detectors is that first-occurrence is
read from the session's `start_time` over the full transcript history — the
same approach the other nine detectors use. Your milestone timestamp reflects
when you first did the thing, not when the detector shipped.

Live verification after landing confirmed this:

| Dimension | Backdated milestone date |
| --- | --- |
| `scheduled` | 2026-04-29 |
| `remote` | 2026-04-15 |
| `verification` | 2026-05-26 |

This is the correct behavior. Compare it to the eight **config-dated**
milestones in `scripts/config-progression.mjs`: those read signals that
carry no embedded timestamp, so `firstSeenAt` is stamped at the first
`npm run assess` run that observed them — all eight share
`2026-05-09T08:37:16.111Z` on first install and never change. Telemetry
detectors don't have that limitation.

## Full detector coverage

All twelve scored dimensions now have milestone detectors. Before CCE-33:

| Dimension | Had detector? |
| --- | --- |
| automation | ✅ |
| integrations | ✅ |
| learning | ✅ |
| memory | ✅ |
| model-effort | ✅ |
| parallel | ✅ |
| permissions | ✅ |
| planning | ✅ |
| **scheduled** | ❌ (now ✅) |
| **remote** | ❌ (now ✅) |
| **verification** | ❌ (now ✅) |

## What didn't change

No new `satisfiedWhen` predicates, `probe-catalog.json` entries, or
`buildSignalsSummary` keys were added. The five machine-enforced tracker
header counts remain **75 / 12 / 48 / 47 / 71** and CI stays green.
The `/progression` timeline page at `app/progression/page.tsx` reads
`app/data/progression.json` as before — the detectors feed the same
output contract, so no rendering changes were required.

## Where to look

- `scripts/progression.mjs` — the three new detector functions
- `scripts/_usage-data.mjs` — `scanTranscriptModes` + the `commands` field extension
- `app/progression/page.tsx` — timeline rendering (unchanged)
- `docs/superpowers/specs/` — CCE-33 design spec (committed in the same PR)
