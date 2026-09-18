# Draft Kit delivery: bounded integration option

Status: review plan only. The current checkout branch sells interactive paid
Draft Kit access and does not yet enable downloads. This document explains the
existing candidate delivery implementation so the deliverables are not silently
dropped from product scope.

## Existing candidate and provenance

The uncommitted `codex/draft-kit-customer-polish` worktree contains a separate,
locally tested delivery slice. Its worker accepts a reviewed canonical snapshot
and generates each buyer's named/scored edition. It has format checks, a
per-process concurrency cap, owner-only download access, and a recheck after
generation. The relevant sources are:

- `server/src/services/DraftKitExportService.ts`
- `server/src/routes/draftKitPdf.ts`
- `server/src/services/DraftKitPurchaseService.ts`
- `server/Dockerfile.draft-kit`
- `scripts/draft-guide/export_worker.py`
- `scripts/draft-guide/customer_exports.py`
- `scripts/draft-guide/test_customer_exports.py`
- `scripts/draft-guide/PAID-DELIVERY-LAUNCH.md`

The local output directory has review PDFs, CSVs, and manifests, but those are
not deployable customer inventory by themselves. The worker refuses an
unreviewed/non-full-season source; the deployment image must package a reviewed
snapshot and matching editorial/source roots. Each release needs an artifact
receipt/hash and visual/export QA before it is offered.

## What that candidate actually delivers

| Format | Candidate status |
| --- | --- |
| Personalized full PDF Draft Kit | Implemented locally |
| Four-page PDF cheat sheet | Implemented locally |
| Interactive PDF checklist | Implemented locally |
| Top-300 CSV for spreadsheet apps | Implemented locally |
| Offline HTML Draft Desk | Implemented locally |
| Customer `.xlsx` workbook | **Not implemented** |

CSV opens in Excel, but it is not an Excel workbook. A `.xlsx` promise requires
a separately specified workbook schema, library/runtime support, formula and
injection tests, and visual QA. Do not substitute CSV wording for an approved
Excel deliverable.

## Minimal isolated delivery tranche

1. Extract only the listed delivery files plus their focused tests from the
   dirty worktree into a second clean branch. Do not merge its unrelated UI,
   projection, or draft-room changes.
2. Apply the candidate's additive purchase migration before its note-table
   migration in a staging Supabase project. Keep the current checkout
   entitlement ledger separate unless product policy explicitly unifies them.
3. Build `server/Dockerfile.draft-kit`, with the reviewed snapshot and export
   dependencies. The standard API image does not contain the Python worker.
4. Add the delivery-only server configuration: `DRAFT_KIT_PDF_READY`,
   `DRAFT_KIT_PYTHON`, `DRAFT_KIT_DATA_PATH`, and optional immutable source and
   editorial roots. Keep it false until staging acceptance.
5. Run the five-format staging acceptance against an entitled buyer and a
   nonbuyer, including expiration/refund revocation, retry, custom scoring,
   CSV injection, artifact hash/receipt, and mobile-browser download UX.

## Decision needed before implementation

Choose one of these product scopes explicitly:

- Interactive Draft Kit access only (the checkout branch currently implements
  this); or
- Interactive access plus the five candidate downloadable formats; or
- The five candidate formats plus a new scoped `.xlsx` workbook deliverable.

This choice affects the published offer, purchase records, terms, deployment
image, support load, and acceptance plan. It should not be inferred from a
historical review workbook.
