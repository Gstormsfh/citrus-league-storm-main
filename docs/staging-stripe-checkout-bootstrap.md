# Staging Stripe Checkout bootstrap

This is the exact remaining staging configuration boundary. It is a test-only
plan for the existing Cloud Run service `citrus-api` in
`citrus-fantasy-staging`; it does not authorize production deployment.

## Current verified state

- The service is reachable through its Cloud Run HTTPS URL.
- The deployed revision has `DRAFT_KIT_CHECKOUT_ENABLED=false` and
  `DRAFT_KIT_PDF_READY=false`.
- Staging Secret Manager contains the restricted test `STRIPE_SECRET_KEY`.
  The webhook signing secret must be created only after the staging webhook
  endpoint is live.
- The existing runtime service account is
  `citrus-api-runtime@citrus-fantasy-staging.iam.gserviceaccount.com`.

## Secure destinations to provision

Create the following **staging-only** Secret Manager entries and grant that
runtime service account `roles/secretmanager.secretAccessor` on each:

| Secret name | Value source | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe sandbox restricted test key (`rk_test_…`) | Never browser-visible; must be test-mode only. |
| `STRIPE_WEBHOOK_SECRET` | Stripe test webhook endpoint after it is created | Create only after the staging route is deployed and HTTPS-confirmed. |
| `DRAFT_KIT_STRIPE_PRICE_ID` | Existing sandbox Price ID | Non-secret identifier; storing with the staging config avoids source edits. |
| `DRAFT_KIT_CURRENCY` | `cad` | Test configuration. |
| `DRAFT_KIT_AMOUNT_MINOR` | `799` | Test configuration. |
| `DRAFT_KIT_TIER` | Approved tier | Must match the published offer. |
| `DRAFT_KIT_ACCESS_UNTIL` | Approved ISO timestamp | Current policy value is documented separately. |
| `DRAFT_KIT_UPDATES_UNTIL` | Approved ISO timestamp | Must not exceed access expiry. |
| `DRAFT_KIT_SITE_ORIGIN` | Staging Firebase HTTPS origin | Must exactly match success/cancel URLs. |
| `DRAFT_KIT_TERMS_URL` | Published staging terms URL | Same origin required by the service. |
| `DRAFT_KIT_TERMS_VERSION` | Published version label | Bind it to each purchase. |
| `DRAFT_KIT_TAX_MODE` | `none` for the first gate-off deployment | Change to `automatic` only after the Stripe Tax registration is configured. |

Keep `DRAFT_KIT_CHECKOUT_ENABLED=false` until the route, migration, webhook,
and test-card acceptance are all complete. `DRAFT_KIT_PDF_READY` remains false
because downloadable-delivery scope is a separate decision and deployment.

## Required workflow change after values exist

The staging deploy workflow maps `STRIPE_SECRET_KEY` from Secret Manager for
the gate-off deployment. Add `STRIPE_WEBHOOK_SECRET` only after the webhook is
created and its secret version exists; otherwise a normal staging deployment
would fail at revision creation. The commercial values remain deployment
configuration, not source literals.

## Real sandbox sequence after staging deploy

1. Apply `20260918150000_draft_kit_stripe_checkout.sql` to staging Supabase.
2. Deploy this branch to staging with Checkout still false; confirm
   `/api/draft-kit/checkout/offer` returns unavailable.
3. Enable Checkout only for the test deployment, register the returned HTTPS
   `/api/draft-kit/checkout/webhook` endpoint in Stripe test mode, and store
   its signing secret only in `STRIPE_WEBHOOK_SECRET`.
4. Run a Stripe test-card payment, verify the entitlement and a second-user
   denial, replay the success event, then refund/dispute-test revocation.
5. Set the gate false again if the test environment remains shared.

Stripe MCP OAuth is intentionally not used as `STRIPE_SECRET_KEY`: it grants
agent-side Dashboard/API access only and is not an application runtime
credential.

## Minimum permissions for the restricted test key

Set **Prices: Read**, **Checkout Sessions: Write**, and **Payment Intents:
Read**. Checkout Sessions Write also includes Read, which this service uses to
retrieve a completed session in the webhook handler. Payment Intents Read
authorizes the expanded intent status validation; the service does not create
or update Payment Intents. It does not directly call Charges, Refunds,
Customers, Products, or Stripe Tax APIs. Local webhook signature verification uses
`STRIPE_WEBHOOK_SECRET`, not an API permission.

After the sandbox test is complete, review the restricted key's request logs
and remove any permission that was not actually used. Do not grant a live key
or enable automatic tax until the Stripe Tax registration is configured. The
user-confirmed Canadian GST/HST registration number is `736762832RT0001`,
effective 2025-10-20; it is an account input, not independent registry
verification. The approved price is CAD $7.99 plus any applicable tax, so keep
the Stripe Price tax behavior exclusive.
