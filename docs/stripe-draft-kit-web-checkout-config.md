# Website-only Draft Kit checkout configuration

This branch ships no usable commercial defaults. `DRAFT_KIT_CHECKOUT_ENABLED`
must remain `false` unless every item below is approved and configured in the
server's secret manager (never browser variables or git):

- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for the same test or live mode
- `DRAFT_KIT_STRIPE_PRICE_ID`, `DRAFT_KIT_CURRENCY`, and
  `DRAFT_KIT_AMOUNT_MINOR` matching an active one-time Stripe Price
- `DRAFT_KIT_TIER` (`kit` or `suite`), `DRAFT_KIT_ACCESS_UNTIL`, `DRAFT_KIT_UPDATES_UNTIL`, and same-site
  `DRAFT_KIT_SITE_ORIGIN`, `DRAFT_KIT_TERMS_URL`, and `DRAFT_KIT_TERMS_VERSION`

The server refuses checkout for missing, malformed, expired, cross-origin, or
internally inconsistent settings. Register the website webhook at
`/api/draft-kit/checkout/webhook` for completed and asynchronous-payment
success events, plus refund and dispute events. Verify a test payment, replay,
invalid signature, wrong Price, and refund before enabling a live Price.

No iOS or Android source, native purchase surface, store process, or free
season-long fantasy behavior is changed by this branch.

## Audit notes (September 18, 2026)

- The approved launch price is **CAD 799**. It belongs in the secret-managed
  `DRAFT_KIT_CURRENCY=cad` and `DRAFT_KIT_AMOUNT_MINOR=799` configuration,
  not client source. Test mode has no active one-time Price yet.
- The current website pricing component remains intentionally non-purchasable:
  `apps/web/src/components/draftkit/DraftKitPricing.tsx`. A website purchase
  CTA and return/access refresh must be added only after the commercial copy,
  terms, and final delivery scope are approved.
- This branch fulfils access to the existing authenticated Draft Kit board via
  `draft_kit_entitlements`; it does **not** claim to deliver downloadable PDF,
  CSV, or Draft Desk artifacts. A separate, dirty worktree has an unmerged
  candidate export path, but it relies on a configured Python worker and
  reviewed full-season artifact and cannot be treated as launch-ready here.
- The existing public terms file (`apps/web/public/terms-of-service.html`)
  covers the free game and contains no digital-product price, refund, tax,
  access-window, update, or paid-support policy. It cannot be used as the
  Draft Kit terms URL without a reviewed amendment.
- Native exclusion remains enforced by `VITE_NATIVE` and `WebsiteOnlyProduct`
  in `apps/web/src/App.tsx` and `apps/web/src/components/WebsiteOnlyProduct.tsx`.
  Website use is permitted at mobile-browser widths; this is not a native-app
  purchase surface.
- Approved policy values: paid access ends at **2027-07-01T05:59:59Z** (the
  end of June 30, 2027 in America/Edmonton); draft-prep updates end at
  **2026-09-30T05:59:59Z** (the end of NHL opening night, September 29, 2026,
  in America/Edmonton). Checkout remains unavailable until these are included
  in a reviewed terms version and server configuration.

## Deployment and delivery decision record

Repository evidence shows two existing secret-management patterns: GitHub
Actions environment secrets and GCP Secret Manager injection for the draft
engine (`infra/gce/draft-engine-startup.sh`). The current checkout API runtime
does not yet have a checked-in Stripe secret-injection manifest. Before a test
deployment, the deployment owner must select its existing API secret manager
and add these names there: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`DRAFT_KIT_STRIPE_PRICE_ID`, `DRAFT_KIT_CURRENCY`,
`DRAFT_KIT_AMOUNT_MINOR`, `DRAFT_KIT_TIER`, `DRAFT_KIT_ACCESS_UNTIL`,
`DRAFT_KIT_UPDATES_UNTIL`, `DRAFT_KIT_SITE_ORIGIN`,
`DRAFT_KIT_TERMS_URL`, `DRAFT_KIT_TERMS_VERSION`, `DRAFT_KIT_TAX_MODE`, and
`DRAFT_KIT_CHECKOUT_ENABLED`. Values must never be committed or passed to the
web build.

The present, reviewable product is paid interactive Draft Kit access. A
separately dirty worktree contains an optional PDF/checklist/cheat-sheet/CSV/
offline-Draft-Desk delivery design using `server/Dockerfile.draft-kit`, a
Python worker, a reviewed full-season snapshot, and a separate
`DRAFT_KIT_PDF_READY` gate. It must be isolated, rights-reviewed, and deployed
as its own delivery work before it can be offered; it is not a customer `.xlsx`
workbook implementation. See `docs/draft-kit-delivery-integration-plan.md`.

## Required Stripe sandbox access

The least access that completes external testing is write permission on the
**Citrus Fantasy Sports sandbox** account for: creating an active one-time
Product/Price in CAD, creating/managing a test webhook endpoint, and reading
Checkout Sessions/Prices/Events to verify payment and replay behaviour. No
live-mode access, payout, customer-data export, refund, or account-management
permission is needed for the initial test-mode checkout lifecycle. Sandbox
catalog write access is now available: a test-only active one-time CAD 799
product/price has been created and independently read back. Its Price ID must
be placed only in the selected test deployment's secret configuration, never
committed. With GST/HST registration unresolved, test configuration must set
`DRAFT_KIT_TAX_MODE=none`; `automatic` is rejected unless selected explicitly.
