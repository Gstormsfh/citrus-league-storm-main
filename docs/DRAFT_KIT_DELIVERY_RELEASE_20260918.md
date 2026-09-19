# Paid draft-kit delivery: implementation and release boundary

This change implements delivery. It does **not** enable purchases, install a
private edition, approve publication, or replace the active numerical source.

## Customer path

- Web `/draft-kit?tab=pricing` loads delivery readiness and the existing checkout
  offer. Sign-in returns to that actual route and tab.
- The existing `draft_kit_entitlements` service determines access. A successful
  payment URL, local settings, and a client-supplied user ID never grant access.
- Buyers customize scoring and receive the full PDF, clickable checklist,
  compact cheat sheet, rankings CSV, or offline HTML desk.
- In a Citrus draft room, the purchased connected desk remains automatic. Its
  published runtime data is separate from the download's explicitly dated edition.
- Native builds and native runtime views do not load the download/checkout
  panel. No new native purchase language or payment surface is introduced.

## Safety and source contracts

`/api/draft-kit/pdf` authenticates private routes, verifies the current user's
entitlement before generation and again before returning the file, audits the
export, and sets private/no-store caching. The request cannot select a source,
executable, output path, user, or entitlement. JSON bodies are bounded to 32 KiB.

The renderer uses the existing shared scoring engine. Python verifies the exact
canonical source/preimage and full preseason horizon before generating a Top 300.
Numerical counts and unavailable categories are preserved. Root PostgreSQL
serialization is no longer confused with a remaining-season runtime.

Per-process limits: two renderers, only one full PDF; 180-second timeout and
24-MiB binary output ceiling. There is no new background retry or unbounded queue.
Concurrent full-guide requests receive a retryable 429. These are bounds, not a
claim of draft-night capacity testing.

Private portraits, source data, and authored editorial bundles are excluded from
the build context. Offline rendering checks portrait identity, path containment,
and image hash; it never downloads or substitutes a photo. The review packager
copies allowlisted inputs without rebinding editorial claims or approving rights.

## Verification completed locally

- Full web suite: 5,220 passing tests across 411 files.
- Full server suite: 2,666 passing tests, with six pre-existing skips.
- Python adapter, source-horizon, portrait, rights-receipt, form, and private
  edition tests: 80 passing; private tests use the explicit fixture-root environment
  variable rather than adding private research to the public repository.
- Real export service plus workers generated all five formats from an isolated
  private review bundle. The full PDF had 109 pages, checklist six, cheat sheet four.
- Independent output comparison checked 300 players and 2,550 supplied stat
  cells against canonical counts. Download revisions, scores, identities, HTML
  payload and PDF checkbox trees matched. This is consistency, not forecast accuracy.
- Saved checkbox values and appearance streams survived PDF reopen tests.
- Representative cover, strategy, board, player-read, team and checklist pages
  were visually inspected. Automated bounds checks covered every PDF page.
- Web TypeScript check, web build and native build passed; lint had no errors
  (existing warnings remain). The native output contains neither the download
  panel nor its purchase strings/API paths.
- Linux amd64 renderer acceptance passed with no network, a read-only root and
  source bundle, non-root execution, two CPUs and 2 GiB memory. All five formats
  generated; full PDF completed in about 45 seconds. Independent parity also
  passed inside that container. This was renderer acceptance, not an authenticated
  live API test or a production image switch.
- A dedicated CI workflow now covers public source/horizon/portrait/PDF contracts;
  it does not require or publish the private editorial/photo corpus.

## Deployment remains gated

`server/Dockerfile.draft-kit` is an **opt-in** renderer image, not a replacement
for the currently deployed API image. `DRAFT_KIT_PDF_READY` stays off until the
private production edition and all formats pass deployed acceptance. Required
configuration: Python executable, data path, source root, editorial root, asset
root and offline-asset mode. Keep private bundles read-only and versioned.

The local acceptance bundle is a dated V10 **review edition**, not the newly
activated staging runtime and not a production-approved paid file. Review labels
and publication flags intentionally remain. The newer numerical source still
requires its own editorial reconciliation, remote refresh rehearsal and release.
No claim that all projections are accurate or that the product is ready for sale.

## Definitions to retire only after migration

- `DraftKitExportService.connected()` is retained for dated offline tooling and
  parity tests. Live rooms use `PublishedDraftDeskService`; do not wire this method
  into live-room delivery or require customers to upload JSON.
- The local `scripts/draft-guide/server.py` review server is not the authenticated
  paid download API. Do not expose it as a production purchase/delivery endpoint.
- Source and review artifacts remain immutable evidence, not default production
  fallbacks. Do not delete them to make a newer release appear verified.

## Outstanding release proof

Production operator authentication, private artifact installation, final approved
edition, deployed authenticated five-format acceptance, and the separately owned
Stripe checkout/payment/webhook retry test are still required. Do not infer these
from unit tests, successful local renders, or the already deployed connected desk.
