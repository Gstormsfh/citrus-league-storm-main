# Website draft-kit comparison and delivery release

## Scope

Two to ten players, side by side in the browser draft room, connected Draft Desk,
unlocked kit board and downloaded offline desk. Existing projections, league
weights and confirmed draft state remain authoritative. No projection model or
pick-submission changes. The historical advanced metrics in the kit board are
dated and explicitly distinguished from projected totals.

Missing and inapplicable values display as N/A. Negative scoring weights are
respected. A comparison selection does not draft, queue or target a player.
Mobile keeps readable columns with horizontal scrolling and sticky stat labels.
Each selection keeps its own colour slot. Shared browser/offline charts provide
selectable X/Y stat maps and radar areas, with separate skater/goalie groups.
Fantasy-impact radar spokes share one FPTS domain, preserving the magnitude of
league weights. Raw profiles are explicitly relative to the selected players,
not NHL percentiles. Disabled categories and missing observations are not invented.
Legend spotlighting has a readable values summary and preserves keyboard focus.

## Native isolation

Native builds exclude the new comparison and paid Draft Desk chunks. Runtime
guards also suppress the components before entitlement requests. Draft-kit deep
links are excluded; known native origins are rejected by the website kit routes.
Origin filtering is defense in depth, not authentication or an entitlement gate.
Server JWT, membership and purchase checks remain required.

The submitted iOS Build 22 was not rebuilt, synced, withdrawn or uploaded.
A local source-bundle audit passed with placeholder public configuration; it is
not a new release artifact or an App Store approval guarantee.

## Acceptance evidence

- Web: 415 test files, 5,246 tests passed.
- Server: 177 test files, 2,717 tests passed; existing skips unchanged.
- Offline comparison and deployment contract: 6 tests passed.
- Private edition bootstrap: 9 tests passed.
- Web and server TypeScript checks passed.
- Phone comparison inspected at 390 CSS pixels with ten selections, including
  weighted stat maps and radar areas. The harness clearly labels layout-test data.
- Production freeze preflight: no current draft or draft scheduled within 24 hours.

Stripe sandbox transaction `pi_3UHIVCKzkJQAEbwj20WpIKVh` succeeded for CAD 7.99
plus CAD 0.40 tax. All five artifacts were delivered through the staging API.
A non-buyer was denied. A real sandbox refund revoked the buyer's entitlement
through the webhook, and subsequent configuration access returned 403.

Downloaded revision: `2a12d68a25f0fd45134a9ca457e3c7a8c4ab81d61239f46f2f183a608e234883`.
The artifact audit checked 300 player identities and 2,550 raw-stat values against
the private canonical edition. Full guide: 109 pages. Checklist: 6 pages.
Compact sheet: 4 pages. The guide and checklist each have 300 PDF checkboxes.
The first API PDF render took 42.9 seconds. These checks establish data parity,
not a new claim about forecast accuracy or independent editorial approval.

A second sandbox purchase exposed the website gateway's roughly 60-second limit:
four smaller files succeeded, but the full PDF timed out. Download requests now
use the server-configured, explicitly allowlisted owned API origin, preserving
JWT and entitlement verification. Website CSP allows only the two named Citrus
API origins. Arbitrary origin overrides are rejected before sending credentials.
The repeated five-format acceptance succeeded; the full PDF took 67.992 seconds.
Receipts: `/tmp/citrus-compare-final-acceptance-20260919`. All 300 identities and
2,550 raw values matched, and no review-label page remained. A real browser check
of the updated deployed website's direct-origin download is still required.

Private receipts and credentials are outside the repository. Do not commit them.

## Rollout gates

This initial release keeps production checkout disabled. The delivery-enabled
image loads an exact-object, hash-pinned private edition using the runtime service
identity. A bad or missing edition fails startup. Never copy private player or
editorial data into the public web bundle.

Before enabling sales, verify the updated image through the hosting API rewrite,
all downloads including the revised offline comparison, live Stripe configuration,
and the deployed browser offer. Then enable checkout in both declarative release
configurations, through the normal guarded production workflow. Do not bypass the
draft freeze. A sandbox success alone is not evidence of a live launch.

## External platforms: work in progress, default off

The user explicitly expanded scope to Yahoo/ESPN after initially pausing at Citrus.
Existing league-history import was not live draft syncing. New read-only provider
snapshot adapters, authenticated paid routes, scoring translation, and browser
polling are implemented behind `DRAFT_KIT_YAHOO_SYNC_ENABLED` and
`DRAFT_KIT_ESPN_SYNC_ENABLED`. Neither switch is enabled in deployment config.
See `EXTERNAL_DRAFT_SYNC_ACCEPTANCE_2026_09_19.md` for the remaining release gates.
Do not list either as a supported paid feature based on fixture tests alone.
