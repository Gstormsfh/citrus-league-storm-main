# GCP Organization + Project Setup — Tonight Runbook

**Audience.** You (Workspace owner of `citrusfantasysports.com`) with your
CTO (Workspace Super Admin) available for help.

**Goal.** Stand up a brand-new GCP Organization, billing account (with the
$300 free trial), production project, and Cloud Workstations —
**in parallel** with the existing `gstormsff@gmail.com`-parented project.
The old project keeps serving `citrusfantasysports.com` the entire time.
No DNS changes tonight. No cutover tonight.

**Out of scope tonight.** DNS cutover, rotating GitHub Actions secrets to
the new SA, decommissioning the old project, executing the April 10
postmortem ops items in the new project. Those happen in a follow-up
session once the new stack is verified green for 24–48h.

**Total time.** ~3–4 hours of hands-on work if nothing goes sideways.

---

## Cost expectations for tonight

| Thing | Tonight's cost | Monthly run-rate |
| --- | --- | --- |
| Google Workspace | $0 (trial until Apr 23) | $6–18/user |
| GCP Organization | $0 (free) | $0 |
| $300 Free Trial billing account | $0 (you get $300 credit) | n/a — 90-day trial |
| Cloud Run (new, parallel) | $0 (idle while testing) | ~$5–15/mo at current load |
| Firebase Hosting (new, default .web.app URL) | $0 | $0 on Blaze until >10GB egress |
| Cloud Workstations cluster | ~$0.10/hr control plane | ~$72/mo if left on 24/7 |
| Cloud Workstation instance (e2-standard-4) | ~$0.15/hr running | ~$20–30/mo per dev if 6h/day |

Everything tonight is covered by the $300 trial credit. If the Google for
Startups Cloud Program comes through ($2K–$200K), you're fully subsidized
for the first year minimum.

---

## Phases

Phases are ordered so anything that takes time to propagate (Google for
Startups application, domain verification, Cloud Workstations cluster
provisioning) is kicked off early and runs in the background.

1. **Phase 0** — Pre-flight: tools, terminology, accounts
2. **Phase 1** — Verify the GCP Organization exists under your Workspace
3. **Phase 2** — Apply for Google for Startups Cloud Program (kick off early)
4. **Phase 3** — Create billing account + $300 free trial
5. **Phase 4** — Create the new GCP project (`citrus-fantasy-prod`)
6. **Phase 5** — Enable APIs
7. **Phase 6** — Create Firebase project (links to same GCP project)
8. **Phase 7** — Service accounts + keys
9. **Phase 8** — Provision Cloud Workstations (cluster + config + 2 instances)
10. **Phase 9** — Deploy `@citrus/server` to new Cloud Run (parallel, not prod DNS)
11. **Phase 10** — Deploy `@citrus/web` to new Firebase Hosting (.web.app URL)
12. **Phase 11** — End-to-end smoke test against the new stack
13. **Phase 12** — Document what's ready and what's next

After Phase 12 you'll have a fully working parallel stack at some
`citrus-fantasy-prod.web.app` URL, proven healthy. The cutover runbook
(`docs/RUNBOOKS/GCP_PROJECT_CUTOVER.md`) handles the DNS flip later this
week.

---

## Conventions

- **Project ID** used throughout: `citrus-fantasy-prod` (6–30 chars,
  lowercase, hyphen-ok). If taken globally, fall back to
  `citrus-fantasy-prod-01`. Write your chosen ID down here:
  `PROJECT_ID = ____________________`
- **Region**: `us-central1` (matches current Cloud Run, cheapest for US traffic)
- **Billing display name**: `Citrus Fantasy Sports — Production`
- **Your identity**: `<you>@citrusfantasysports.com`
- **CTO identity**: `<cto>@citrusfantasysports.com`
- All commands assume you are running from repo root on your laptop.

---

## Phase 0 — Pre-flight (10 min)

**Purpose.** Confirm tools, terminology, and accounts are in order.
Skipping this phase is how a 3-hour runbook becomes a 7-hour debugging
session.

### 0.1 Terminology check

You'll be switching between five consoles tonight. They look similar and
are easy to confuse. Pin these tabs in this order:

| # | What it is | URL |
| --- | --- | --- |
| 1 | **Google Workspace Admin** — users, domain | https://admin.google.com |
| 2 | **Cloud Identity** — GCP org resource | https://console.cloud.google.com/iam-admin/settings |
| 3 | **GCP Console** — projects, Cloud Run, APIs | https://console.cloud.google.com |
| 4 | **Cloud Billing** — billing accounts, budgets | https://console.cloud.google.com/billing |
| 5 | **Firebase Console** — hosting, Firebase-specific | https://console.firebase.google.com |

**Rule for the night:** before clicking anything, check the top-right
account switcher shows `<you>@citrusfantasysports.com`, NOT
`gstormsff@gmail.com`. 90% of the pain in this runbook comes from
accidentally operating in the wrong account.

### 0.2 CLI tools

```bash
gcloud --version         # → Google Cloud SDK 450+
firebase --version       # → 13+
git --version            # → any recent
node --version           # → ≥ 20
npm --version            # → ≥ 10
```

If `gcloud` is missing: https://cloud.google.com/sdk/docs/install
If `firebase` is missing: `npm install -g firebase-tools`

### 0.3 Log out of the old identity first

This is the single highest-value step in this phase.

```bash
# See who gcloud currently thinks you are
gcloud auth list

# If it lists gstormsff@gmail.com, revoke it so we can't accidentally
# touch the old project
gcloud auth revoke gstormsff@gmail.com

# Also clear firebase
firebase logout
```

### 0.4 Log in as the new identity

```bash
gcloud auth login <you>@citrusfantasysports.com
# Browser opens → complete SSO → return to terminal

firebase login
# Browser opens → log in as <you>@citrusfantasysports.com
```

Verify:

```bash
gcloud auth list
# → Expect ONE active account, the @citrusfantasysports.com one
```

### 0.5 Confirm your CTO is reachable

Phase 8 (Cloud Workstations) will want to add the CTO to an IAM group.
If they are asleep or unreachable, you can still finish everything else
tonight and add them tomorrow. Not blocking.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `gcloud auth login` redirects to Google but then "403" | Workspace admin has SSO enforced with a provider you haven't set up | Temporarily disable SSO in admin.google.com → Security → Authentication, or have CTO do it |
| `firebase login` says "already logged in as …@gmail.com" | Cached creds | `firebase logout --all && firebase login` |
| `gcloud projects list` shows no projects after login | Correct — new Workspace has no GCP projects yet | Proceed to Phase 1 |

### Rollback

N/A — logging in/out is reversible. Nothing has been created yet.

---

## Phase 1 — Verify GCP Organization + grant yourself Org Admin (15 min)

**Purpose.** When you verified the `citrusfantasysports.com` domain in
Workspace, GCP auto-created an **Organization** resource for it. That
org is the root of the IAM tree for everything we'll create tonight.
This phase (a) confirms it exists and (b) gives you the one IAM role
you actually need: `roles/resourcemanager.organizationAdmin`.

**Workspace Super Admin ≠ GCP Organization Admin.** The first time you
touch the GCP side, you get a "Super Admin can bootstrap Org Admin"
flow. After tonight, never use Super Admin for GCP work — use your
regular account with Org Admin granted.

### 1.1 Confirm the org exists

```bash
gcloud organizations list
```

Expected output:

```
DISPLAY_NAME               ID              DIRECTORY_CUSTOMER_ID
citrusfantasysports.com    <12-digit-id>   <customer-id>
```

Write your Organization ID down here: `ORG_ID = ____________________`

**If nothing is listed:**

1. Domain verification is incomplete or propagating. Check
   https://admin.google.com → Account → Domains. The primary domain
   must show "Verified."
2. Cloud Identity may not have been auto-provisioned. Go to
   https://console.cloud.google.com/iam-admin/settings as your Workspace
   Super Admin account. Click **Create Organization** if prompted.
3. Propagation can take up to 24 hours but is usually instant.

### 1.2 Grant yourself Org Admin

You need to do this through the console once because the CLI can't
bootstrap itself (chicken/egg — you'd need the role to grant the role).

1. Open https://console.cloud.google.com/iam-admin/iam
2. Top nav: confirm the scope dropdown shows your Organization
   (**not** "No organization" and **not** a project).
3. Click **+ Grant Access**.
4. **New principals:** `<you>@citrusfantasysports.com`
5. **Role:** type `Organization Admin` → pick `roles/resourcemanager.organizationAdmin`
6. Also add these (you'll need them for the rest of tonight):
   - `Billing Account Creator` (`roles/billing.creator`)
   - `Project Creator` (`roles/resourcemanager.projectCreator`)
   - `Folder Admin` (`roles/resourcemanager.folderAdmin`)
7. **Save.**

Verify from the CLI:

```bash
ORG_ID=<your-org-id>
gcloud organizations get-iam-policy $ORG_ID \
  --filter="bindings.members:<you>@citrusfantasysports.com" \
  --format="table(bindings.role)"
```

Expected: you see all four roles listed.

### 1.3 Do the same for your CTO (optional tonight)

If your CTO will be hands-on with GCP ops, give them:

- `roles/resourcemanager.organizationViewer` (see everything)
- `roles/billing.admin` (manage billing post-setup)
- `roles/resourcemanager.projectCreator` (create sibling projects later)

If not, skip — you can add them later without breaking anything.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "You need additional permissions" banner at the top of IAM page | You're viewing as a non-admin | Switch account to the one with Workspace Super Admin |
| Can't find `roles/resourcemanager.organizationAdmin` in the dropdown | Typed wrong name | Search for "Organization Administrator" (with "istrator" ending) |
| `gcloud organizations get-iam-policy` says permission denied | Grant didn't propagate | Wait 60 seconds, retry. If still failing after 5 min, re-check the grant in console |

### Rollback

- To revoke the role: IAM page → find your principal → pencil icon →
  remove role. Takes effect within 60 seconds.
- No resources have been created yet. Nothing to clean up.

### Checkpoint

Before moving on, you should have:

- [ ] `ORG_ID` written down
- [ ] `gcloud organizations list` shows your org
- [ ] You hold `organizationAdmin`, `billing.creator`, `projectCreator`,
      `folderAdmin` at the org level
- [ ] `gcloud auth list` shows your `@citrusfantasysports.com` account
      as ACTIVE and the only account

---

## Phase 2 — Apply for Google for Startups Cloud Program (20 min form, 1–3 weeks approval)

**Purpose.** Capture the real money on the table. The Program offers
three tiers of cloud credits, all of which stack on top of the $300
free trial. Approval takes 1–3 weeks, so we submit the application
**tonight** and keep building while it's pending.

**Credit tiers (current as of 2026):**

| Tier | Credit | Duration | Typical fit |
| --- | --- | --- | --- |
| **Start** | $2,000 | 1 year | Pre-funded, pre-revenue solo/small |
| **Scale** | $100,000 | 2 years | Seed/Series A with VC backing |
| **Growth** | $200,000 | 2 years | Series A+ with significant traction |

Based on what you've told me about Citrus (pre-revenue, solo/small
team, self-funded), the **Start** tier is the realistic target. $2K
covers ~4 years of your current GCP run-rate.

### 2.1 Pre-application: gather what you'll need

Have these ready before opening the form — it'll ask for all of them.

- **Company name:** Citrus Fantasy Sports
- **Company website:** citrusfantasysports.com
- **Founded date:** *[your incorporation or domain-registration date]*
- **Business description** (200–400 chars): Draft this now. Example:
  > "Citrus Fantasy Sports is an NHL fantasy hockey platform powered
  > by a proprietary xG v3 projection model with 31 features and
  > contextual adjustments. Built on React + Hono + Supabase +
  > Firebase, targeting the pre-playoff hockey fantasy market."
- **Funding stage:** Pre-seed / Bootstrapped / Self-funded (pick one)
- **Total funding raised:** $0 (or actual)
- **Expected GCP spend for next 12 months:** Estimate $500–$1500.
  Under-promising here is fine; over-promising gets you denied.
- **Organization ID** from Phase 1.1
- **Domain:** `citrusfantasysports.com`
- **Your role:** Founder / CEO (whatever is accurate)
- **Referral / accelerator partner:** If you have one (Y Combinator,
  Techstars, 500 Global, etc.), include it. Strongly boosts approval
  odds. If not, leave blank — not required.

### 2.2 Submit the application

1. Go to https://cloud.google.com/startup
2. Click **Apply now**
3. Fill the form with your pre-gathered answers
4. For **Organization ID** field, paste the 12-digit ID from Phase 1.1
5. Submit

You'll get an email within 24 hours confirming receipt. Approval decision
takes **5–15 business days**.

### 2.3 What happens after approval

Google adds the credits directly to your new billing account (created
in Phase 3). You do nothing — they just appear. Free trial credits and
Startup Program credits are consumed in order: free trial first, then
Program credits.

### 2.4 If rejected (unlikely for the Start tier)

Most rejections for the Start tier are for:

- Incomplete company info
- Domain age < 6 months (you're fine — Workspace shows established)
- Previous enrollment from the same domain (first time → no issue)

If rejected, you can re-apply with an accelerator partner referral
(even a free program like https://www.nvidia.com/en-us/startups/ or
https://www.latent.space/ accelerator lists qualifies).

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Form asks for a partner code | Some entry points require a code; the direct URL above does not | Use the direct URL |
| Form says "organization already enrolled" | Domain was previously used for a GCP org | Not possible for a brand-new Workspace — retry form |
| No confirmation email after 24h | Email went to spam, or form submitted while logged in as the wrong account | Check spam, then re-submit from `<you>@citrusfantasysports.com` identity |

### Rollback

N/A — application submission is not a resource.

### Checkpoint

- [ ] Application submitted
- [ ] Confirmation email received at `<you>@citrusfantasysports.com`
- [ ] Calendar reminder set for 10 business days out to follow up
      if no response

---

## Phase 3 — Create billing account + $300 free trial (20 min)

**Purpose.** GCP requires a billing account attached to a project for
most APIs (Cloud Run, Firebase Blaze, Cloud Workstations). We create a
fresh one inside the new org so it's eligible for the $300 free trial
credit (existing billing accounts with history are not eligible).

**Important:** the billing account is **org-scoped**, not project-scoped.
One billing account can serve every project you ever create in this org.
You only do this phase once, ever.

### 3.1 Start the free trial

1. Open https://console.cloud.google.com/freetrial
2. **Confirm account:** shows `<you>@citrusfantasysports.com`. If not,
   switch accounts top-right.
3. **Country:** your country of incorporation.
4. **Organization:** pick `citrusfantasysports.com` from the dropdown.
   This is critical — the default is "No organization" which creates
   a legacy-parented billing account you'll have to migrate later.
5. **Account type:** Business (even if you're solo; Individual has
   lower quotas).
6. **Business info:** company name, address, phone.
7. **Payment info:** credit or debit card. You will **not** be charged
   during the 90-day trial. Google holds a $1 auth that drops off.
8. **Agree** to terms, submit.

You'll see the billing dashboard with a **$300.00 USD** credit balance
and a countdown to **90 days remaining**.

### 3.2 Name the billing account

Still in the billing console:

1. https://console.cloud.google.com/billing → account list
2. Click the `My Billing Account` that was just created
3. Top-left pencil icon → rename to **`Citrus Fantasy Sports — Production`**
4. Copy the **Billing account ID** (format: `01XXXX-XXXXXX-XXXXXX`).
   Write it down: `BILLING_ACCOUNT_ID = ____________________`

### 3.3 Set a hard budget cap (important)

Without this, once the $300 trial runs out or converts to paid, a
runaway bug could bill you thousands. The April 10 Firebase egress
story is exactly this failure mode on the other side of the stack.

1. In the billing console → **Budgets & alerts** → **Create budget**
2. **Name:** `Global hard cap`
3. **Projects:** all (will cover projects you create later too)
4. **Budget amount:**
   - *For tonight:* $50/month. Tight but adequate for current traffic.
   - *After playoff launch:* tune up based on a week of real data.
5. **Threshold rules:**
   - 50% — email
   - 90% — email
   - 100% — email + page (add your on-call address)
   - 120% — email + page (the "this is a runaway, investigate NOW" alert)
6. **Notification email:** your on-call inbox. Not `gstormsff@gmail.com`.
7. Save.

### 3.4 CLI verification

```bash
gcloud billing accounts list
# Expected:
# ACCOUNT_ID            NAME                                OPEN  MASTER_ACCOUNT_ID
# 01XXXX-XXXXXX-XXXXXX  Citrus Fantasy Sports — Production  True
```

Confirm you see **OPEN = True** and the name matches.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Your country / payment method is not supported" | Rare, usually a card issuer issue | Try a different card, or a corporate Brex/Ramp card if you have one |
| "This email has already used the free trial" | Google detected the same person/card previously consumed a trial (gstormsff@gmail.com counts) | You may still qualify — click "I confirm this is a new business account" OR use the Google for Startups credits (Phase 2) as your primary subsidy instead |
| Organization dropdown doesn't show your org | Phase 1 IAM bindings still propagating | Wait 5 min and retry; if still failing, re-check `Billing Account Creator` role on yourself at the org level |
| Budget emails going to spam | First-time sender | Whitelist `billing-noreply@google.com` in Workspace admin → Gmail → Spam settings |

### What about ending the free trial early?

Don't. The $300 free trial is pure upside — once consumed, it's gone.
Let it run the full 90 days. The budget cap above protects against
runaway spend after conversion.

When the trial is 7 days from expiring, you'll get an email from
Google. By then, Google for Startups credits should be approved and
stacked on top.

### Rollback

- To close the billing account: billing console → Account management →
  **Close billing account**. Only possible if no projects are linked.
- If you close it, the $300 trial credit is forfeit. Don't do this
  unless you explicitly want to start over.

### Checkpoint

- [ ] Billing account created under the new Organization
- [ ] `BILLING_ACCOUNT_ID` written down
- [ ] Renamed to `Citrus Fantasy Sports — Production`
- [ ] Hard budget cap of $50/month configured with 4 thresholds
- [ ] $300 free trial credit visible in the dashboard
- [ ] `gcloud billing accounts list` shows OPEN=True

---

## Phase 4 — Create the new GCP project (10 min)

**Purpose.** This is the container for every piece of cloud infra we're
about to build. Everything in Phases 5–11 lives inside this project.

### 4.1 Pick the project ID

GCP project IDs are **globally unique across all of Google Cloud**.
Once chosen, they cannot be changed. Retired project IDs are not
reusable for 30 days.

**Recommendation:** `citrus-fantasy-prod` (19 chars — clean, descriptive,
leaves room for `citrus-fantasy-staging` later).

If it's taken:

- `citrus-fantasy-prod-01`
- `citrusfantasy-prod`
- `citrusfs-prod`

Pick one and write it down: `PROJECT_ID = ____________________`

### 4.2 Create it

```bash
ORG_ID=<from Phase 1.1>
BILLING_ACCOUNT_ID=<from Phase 3.2>
PROJECT_ID=citrus-fantasy-prod

# Create the project under the org
gcloud projects create $PROJECT_ID \
  --organization=$ORG_ID \
  --name="Citrus Fantasy Sports — Production"

# Link it to the billing account
gcloud billing projects link $PROJECT_ID \
  --billing-account=$BILLING_ACCOUNT_ID

# Set it as your default project so you don't have to pass --project everywhere
gcloud config set project $PROJECT_ID
```

### 4.3 Verify

```bash
gcloud projects describe $PROJECT_ID \
  --format="table(projectId, parent.id, lifecycleState)"
# Expected:
# PROJECT_ID            PARENT_ID  LIFECYCLE_STATE
# citrus-fantasy-prod   <ORG_ID>   ACTIVE

gcloud billing projects describe $PROJECT_ID \
  --format="value(billingAccountName, billingEnabled)"
# Expected:
# billingAccounts/01XXXX-XXXXXX-XXXXXX   True
```

Both commands must succeed with those values before continuing. If
`billingEnabled` is False, the rest of the runbook will fail on API
enablement.

### 4.4 Confirm in the console

Open https://console.cloud.google.com/home/dashboard?project=$PROJECT_ID
— top-left project picker should show your new project, and the "Project
info" card should show:

- Project ID: `citrus-fantasy-prod`
- Project number: (12-digit, write it down: `PROJECT_NUMBER = ____________________`)
- Parent: `citrusfantasysports.com`
- Billing: linked and enabled

The project number is what you'll see in IAM bindings for service
accounts (`123456789012-compute@developer.gserviceaccount.com`).

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `PROJECT_ID already exists` | Someone (possibly another Google Cloud customer) took it | Pick a different ID from the fallback list |
| `Permission denied on organization X` | Your `projectCreator` role hasn't propagated | Wait 2 min, retry. If still failing, re-check IAM from Phase 1.2 |
| `Billing account not found` | Typo in `BILLING_ACCOUNT_ID` | Re-run `gcloud billing accounts list` and copy exactly |
| `Cannot link billing account: permission denied` | Missing `roles/billing.user` on billing account | IAM on the billing account itself → add yourself as `Billing Account User` |
| Console shows project but `lifecycleState: DELETE_REQUESTED` | You created it, deleted it, and are trying to create a new one with the same ID | Wait 30 days OR pick a different ID |

### Rollback

```bash
# Shuts down the project. Fully recoverable for 30 days after this command.
gcloud projects delete $PROJECT_ID
```

Safe to rollback at this point — no resources have been created inside
the project yet.

### Checkpoint

- [ ] `PROJECT_ID` written down
- [ ] `PROJECT_NUMBER` written down
- [ ] `gcloud config get-value project` returns your new project ID
- [ ] `lifecycleState: ACTIVE`
- [ ] `billingEnabled: True`
- [ ] Parent shows your org, not "No organization"

---

## 🛑 Stop here for review

This is the end of the "foundation" phases. Before you continue to
Phase 5 (APIs), you should have:

- [ ] Org visible in `gcloud organizations list`
- [ ] All four IAM roles granted on the org
- [ ] Google for Startups application submitted
- [ ] Billing account OPEN with $300 trial credit active
- [ ] Hard $50/mo budget cap configured
- [ ] Project ACTIVE, linked to billing, parented under the org

If any of the above are missing, **do not continue** — go back and
finish them. Phases 5+ assume all six are complete.

Everything below this point is idempotent enough that you can stop
for the night after Phase 7 if you run out of energy. Phase 8
(Cloud Workstations) and Phases 9–11 (deploys) are not dependencies
of each other.

---

## Phase 5 — Enable APIs (10 min)

**Purpose.** A fresh GCP project has almost everything disabled. Before
we can deploy Cloud Run, provision Workstations, or use Firebase, we
need to turn on the underlying APIs. Each one takes 30–90 seconds to
enable.

### 5.1 Enable the needed APIs

Run this as a single batch. It's idempotent — safe to re-run.

```bash
PROJECT_ID=citrus-fantasy-prod

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  firebaserules.googleapis.com \
  firestore.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  workstations.googleapis.com \
  compute.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  secretmanager.googleapis.com \
  --project=$PROJECT_ID
```

Expected output:

```
Operation "operations/acf.XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" finished successfully.
```

Repeated for each API. If one fails (common for `compute` if billing
isn't propagated yet), re-run the whole command — enabled APIs skip,
failed ones retry.

### 5.2 What each API is for

| API | Why we need it |
| --- | --- |
| `run` | Cloud Run — the `@citrus/server` API deploy target |
| `cloudbuild` | Builds container images during deploy |
| `artifactregistry` | Stores those container images |
| `firebase`, `firebasehosting`, `firebaserules` | Firebase Hosting for the `@citrus/web` SPA |
| `firestore` | Needed even though we use Supabase — Firebase internally provisions a Firestore instance for Hosting metadata |
| `iam`, `iamcredentials` | Service account creation, workload identity federation |
| `cloudresourcemanager`, `serviceusage` | API enablement itself, quota management |
| `workstations` | Phase 8 (Cloud Workstations) |
| `compute` | Workstations run on Compute Engine under the hood |
| `logging`, `monitoring` | Cloud Run logs, the ops dashboard, alerting |
| `secretmanager` | Eventual home for Supabase service role key, etc. |

### 5.3 Verify

```bash
gcloud services list --enabled --project=$PROJECT_ID \
  --format="value(config.name)" | sort
```

Confirm all 16 APIs above appear in the output.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `FAILED_PRECONDITION: Billing must be enabled` | Phase 3 billing link hasn't propagated | Wait 2 min, retry. If persistent, re-run `gcloud billing projects link` |
| `compute.googleapis.com` takes 2+ minutes | Normal — Compute Engine initializes a default VPC on first enable | Wait it out |
| `workstations.googleapis.com` returns `PERMISSION_DENIED` | Your project is in some kind of trial sandbox | Verify billing and retry; if still failing, file a support ticket from the console |

### Rollback

```bash
# Disable an API (will break anything using it)
gcloud services disable <api>.googleapis.com --project=$PROJECT_ID
```

Not recommended — no cost impact from leaving APIs enabled.

### Checkpoint

- [ ] All 16 APIs show up in `gcloud services list --enabled`
- [ ] No errors from the enable command

---

## Phase 6 — Create Firebase project (links to same GCP project) (15 min)

**Purpose.** Firebase projects are not separate from GCP projects —
they're the same resource with a Firebase overlay. Adding Firebase to
a GCP project is free and lets us use Firebase Hosting, Auth
(if we ever want it), and the Firebase CLI for deploys.

**Critical constraint:** Firebase Hosting can only serve a given
custom domain (`citrusfantasysports.com`) from **one Firebase project
at a time**. We will NOT connect the custom domain tonight — we'll
deploy to the default `.web.app` URL and leave the old project serving
the custom domain until cutover.

### 6.1 Add Firebase to the GCP project

1. Open https://console.firebase.google.com
2. Click **Add project**
3. At the "Enter your project name" step, click **"Add Firebase to
   Google Cloud project"** at the bottom of the form
4. Pick `citrus-fantasy-prod` from the dropdown
5. **Do NOT enable Google Analytics.** You can add it later; for now
   it just adds consent banners and GDPR complexity.
6. Click **Add Firebase**

Wait 30–60 seconds for provisioning. You'll land on the project
dashboard.

### 6.2 Upgrade to Blaze (pay-as-you-go)

Firebase Hosting on Spark has a hard egress cap that will hurt during
a draft. Blaze with a budget cap is the right config — same pattern as
the April 10 postmortem remediation.

1. Firebase Console → project → left sidebar bottom: **Upgrade**
2. Pick **Blaze — Pay as you go**
3. **Billing account:** pick `Citrus Fantasy Sports — Production`
   (the one from Phase 3)
4. Confirm upgrade

The $50/mo global budget cap from Phase 3.3 still applies — you cannot
be billed more than $50 without getting 4 email alerts before you hit
the cap.

### 6.3 Register the web app inside Firebase

This is what gets us the `VITE_FIREBASE_*` config values for the SPA.

1. Firebase Console → project overview → **Add app** → **Web** icon (`</>`)
2. **App nickname:** `citrus-web-prod`
3. **Do NOT** check "Also set up Firebase Hosting for this app" — we'll
   do that via the CLI in Phase 10
4. Click **Register app**
5. **Copy the config object** that appears:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "citrus-fantasy-prod.firebaseapp.com",
  projectId: "citrus-fantasy-prod",
  storageBucket: "citrus-fantasy-prod.firebasestorage.app",
  messagingSenderId: "<project-number>",
  appId: "1:<project-number>:web:...",
  measurementId: "G-..."
};
```

Write these down in a secure place (password manager is fine) — you'll
need them for GitHub Actions secrets later. Don't check them into git,
even though the API key is technically a public identifier:

- `VITE_FIREBASE_API_KEY` = `apiKey`
- `VITE_FIREBASE_APP_ID` = `appId`
- `VITE_FIREBASE_MEASUREMENT_ID` = `measurementId` (blank if Analytics off)

### 6.4 Set up a separate Hosting site (prep for Phase 10)

The default Hosting site gets the URL `citrus-fantasy-prod.web.app`.
That's fine for tonight — that's our parallel-testing URL.

Verify it shows up:

```bash
firebase projects:list
# Expect the new project in the list.

firebase use citrus-fantasy-prod
# Switches the Firebase CLI to operate on this project.

firebase hosting:sites:list
# Expect:
# ┌────────────────────────┬────────────────────────────────────┬──────────────┐
# │ Site ID                │ Default URL                        │ App ID       │
# ├────────────────────────┼────────────────────────────────────┼──────────────┤
# │ citrus-fantasy-prod    │ https://citrus-fantasy-prod.web.app│ (none)       │
# └────────────────────────┴────────────────────────────────────┴──────────────┘
```

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Add Firebase to Google Cloud project" option is missing | Your account isn't Owner on the GCP project | Go to GCP IAM, grant yourself `roles/firebase.admin` |
| Firebase upgrade to Blaze fails with "billing account not eligible" | Rare; usually a payment-profile geo mismatch | Verify the billing account country matches your card's country |
| `firebase projects:list` doesn't show the new project | CLI still pointed at old account | `firebase logout && firebase login` |
| `firebase use` says "Invalid project id" | Project hasn't fully provisioned | Wait 60 sec and retry |

### Rollback

- To remove Firebase from the GCP project:
  Firebase Console → Project Settings → scroll to bottom →
  **Delete project**. This deletes the underlying GCP project too.
  Only do this if you want to start over.

### Checkpoint

- [ ] Firebase project exists at https://console.firebase.google.com,
      linked to `citrus-fantasy-prod`
- [ ] Plan shows **Blaze**
- [ ] Web app `citrus-web-prod` registered
- [ ] Config values saved to your password manager
- [ ] `firebase hosting:sites:list` shows the default `.web.app` site
- [ ] **No** custom domain connected yet

---

## Phase 7 — Service accounts + keys (15 min)

**Purpose.** CI/CD and runtime need identities. We create two service
accounts and download one JSON key (for GitHub Actions — the other uses
workload identity and doesn't need a key).

**Why two accounts:** least-privilege. The deploy SA can push new
revisions but can't read Supabase secrets at runtime. The runtime SA
can read secrets but can't deploy new code. Compromise of one does not
give you both.

### 7.1 Create the deploy service account (used by GitHub Actions)

```bash
PROJECT_ID=citrus-fantasy-prod

gcloud iam service-accounts create citrus-deploy \
  --display-name="Citrus CI Deploy" \
  --description="GitHub Actions uses this SA to push Cloud Run revisions" \
  --project=$PROJECT_ID
```

Grant roles:

```bash
DEPLOY_SA=citrus-deploy@$PROJECT_ID.iam.gserviceaccount.com

for role in \
  roles/run.admin \
  roles/iam.serviceAccountUser \
  roles/artifactregistry.writer \
  roles/cloudbuild.builds.editor \
  roles/storage.admin \
  roles/firebasehosting.admin; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$DEPLOY_SA" \
    --role="$role" \
    --condition=None
done
```

**What these roles do:**

| Role | Why |
| --- | --- |
| `run.admin` | Push new Cloud Run revisions, route traffic |
| `iam.serviceAccountUser` | Cloud Run needs to "actAs" the runtime SA |
| `artifactregistry.writer` | Push built container images |
| `cloudbuild.builds.editor` | Trigger Cloud Build during `gcloud run deploy --source` |
| `storage.admin` | Cloud Build uses a GCS staging bucket |
| `firebasehosting.admin` | Deploy the web SPA to Firebase Hosting |

### 7.2 Create the runtime service account

This is the identity that Cloud Run uses to make calls (to Secret
Manager, logging, etc.). It should have the *minimum* permissions to
run the server.

```bash
gcloud iam service-accounts create citrus-api-runtime \
  --display-name="Citrus API Runtime" \
  --description="Cloud Run service identity for @citrus/server" \
  --project=$PROJECT_ID

RUNTIME_SA=citrus-api-runtime@$PROJECT_ID.iam.gserviceaccount.com

for role in \
  roles/secretmanager.secretAccessor \
  roles/logging.logWriter \
  roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="$role" \
    --condition=None
done
```

### 7.3 Deploy-SA auth — SKIP tonight

Tonight's Phase 9/10 deploys run from your local terminal using your
own interactive `gcloud` / `firebase login` auth. CI auth for the new
project is explicitly out of scope for tonight per the runbook header
("rotating GitHub Actions secrets to the new SA" is cutover work).

On a fresh Org, Google now enables
`constraints/iam.disableServiceAccountKeyCreation` by default — trying
to download a long-lived SA key will fail with `FAILED_PRECONDITION`.
That's the secure default and we're going to keep it.

When cutover night arrives, wire GitHub Actions to the new project via
**Workload Identity Federation** instead — no key ever created, GitHub
→ GCP via OIDC. The rough outline (do NOT execute tonight):

```bash
# At cutover time, not now:
gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub Actions" \
  --project=$PROJECT_ID

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --workload-identity-pool=github --location=global \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='gstormsfh/citrus-league-storm-main'" \
  --project=$PROJECT_ID

gcloud iam service-accounts add-iam-policy-binding $DEPLOY_SA \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/gstormsfh/citrus-league-storm-main" \
  --project=$PROJECT_ID
```

Then `production-deploy.yml` swaps `credentials_json` for
`workload_identity_provider` + `service_account`.

**Net effect tonight:** Phase 7.3 is a no-op. The `citrus-deploy` SA
exists with the right roles, ready to be bound to WIF at cutover.

#### Fallback: if you need CI auth NOW for some reason

Only override the org policy if you've decided you cannot wait for
cutover to wire CI. This is strongly discouraged — it creates a
long-lived credential exactly the kind the April 10 postmortem flagged
as a rotation hazard. The commands exist if you need them:

```bash
# Temporarily allow key creation (requires Organization Policy Admin role)
gcloud resource-manager org-policies disable-enforce \
  iam.disableServiceAccountKeyCreation \
  --project=$PROJECT_ID

# Now the 7.3 original command works:
gcloud iam service-accounts keys create ~/citrus-deploy-key.json \
  --iam-account=$DEPLOY_SA \
  --project=$PROJECT_ID

# Immediately re-enable the constraint after:
gcloud resource-manager org-policies enable-enforce \
  iam.disableServiceAccountKeyCreation \
  --project=$PROJECT_ID
```

### 7.3a Grant Compute SA the Cloud Build builder role (new-project gotcha)

As of late 2024, Google changed Cloud Build to default to the Compute
Engine default service account (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`)
instead of the legacy Cloud Build SA. New projects don't auto-grant
this account the permissions it needs, so `gcloud run deploy --source=.`
fails in Phase 9 with:

```
Error 403: <PROJECT_NUMBER>-compute@developer.gserviceaccount.com does
not have storage.objects.get access to the Google Cloud Storage object.
```

Pre-empt it here:

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.builder" \
  --condition=None
```

`roles/cloudbuild.builds.builder` bundles the storage / logging /
artifact-registry permissions Cloud Build needs to stage source,
write logs, and push images.

### 7.3b Allow public IAM bindings (new-project gotcha #2)

New GCP orgs ship with `constraints/iam.allowedPolicyMemberDomains`
enforced. It blocks adding `allUsers` to any IAM binding, which means
`gcloud run deploy --allow-unauthenticated` silently warns and the
service stays unreachable from the public internet. Phase 9's
parallel-stack smoke test needs the API publicly reachable.

**Three gotchas compound here — handle them in order:**

1. **`iam.allowedPolicyMemberDomains` is a list constraint, not boolean.**
   `gcloud resource-manager org-policies disable-enforce` appears to
   succeed but only sets an empty `booleanPolicy: {}` that has no effect
   on the inherited list policy. Use `gcloud org-policies set-policy`
   with a YAML file that explicitly sets `allowAll: true` instead.

2. **Org Admin ≠ `roles/orgpolicy.policyAdmin`.** Workspace super-admin
   lets you create orgs and projects, but the Org Policy Admin IAM role
   is separate. Without it, `set-policy` fails with `does not have
   permission to access projects instance [...:setOrgPolicy]`.

3. **The Org Policy API is not enabled by default on new projects.**
   `set-policy` will fail with `SERVICE_DISABLED` until you enable
   `orgpolicy.googleapis.com` on the project.

```bash
# 1) Find your org ID
gcloud organizations list

# 2) Grant yourself orgpolicy.policyAdmin at the org level
gcloud organizations add-iam-policy-binding $ORG_ID \
  --member="user:you@yourdomain.com" \
  --role="roles/orgpolicy.policyAdmin"

# 3) Enable the Org Policy API on the project
gcloud services enable orgpolicy.googleapis.com --project=$PROJECT_ID

# 4) Write an allow-all policy file (YAML, v2 API shape)
cat > /tmp/allow-all-domains.yaml <<EOF
name: projects/$PROJECT_ID/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
    - allowAll: true
EOF

# 5) Apply it (wait ~30s after step 2 and step 3 for propagation)
gcloud org-policies set-policy /tmp/allow-all-domains.yaml

# 6) Verify — should show `allowAll: true` in effective policy
gcloud org-policies describe \
  iam.allowedPolicyMemberDomains \
  --project=$PROJECT_ID \
  --effective
```

List-policy propagation can take up to ~60s after step 5 before the
`allUsers` binding in Phase 9.5 will succeed. If the binding still fails
with `FAILED_PRECONDITION: ... do not belong to a permitted customer`,
wait another minute and retry — don't re-apply the policy.

After the `allUsers` binding is in place, you can re-enable enforcement
at the org level if you want — existing bindings stay. Most teams leave
this policy permissive at the project level; the constraint is more
useful at org scope to catch drift in *new* projects.

### 7.4 Pre-seed Secret Manager for later

We won't wire Supabase secrets in tonight (Phase 9 uses env vars on the
Cloud Run service directly for speed). But create the secret entries
as empty placeholders so we remember the right names:

```bash
for secret in \
  supabase-url \
  supabase-anon-key \
  supabase-service-role-key \
  sentry-dsn; do
  echo -n "placeholder" | gcloud secrets create $secret \
    --data-file=- \
    --replication-policy=automatic \
    --project=$PROJECT_ID
done
```

Real values go in during cutover or in a follow-up session.

### 7.5 Verify

```bash
gcloud iam service-accounts list --project=$PROJECT_ID
# Expect two user-created SAs plus the default ones:
#   citrus-deploy@citrus-fantasy-prod.iam.gserviceaccount.com
#   citrus-api-runtime@citrus-fantasy-prod.iam.gserviceaccount.com

gcloud projects get-iam-policy $PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:citrus-deploy@*" \
  --format="value(bindings.role)"
# Expect the 6 roles from 7.1

gcloud secrets list --project=$PROJECT_ID
# Expect 4 placeholders
```

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `You do not have permission to perform this operation` on SA create | `iam.googleapis.com` not enabled yet | Re-run Phase 5 |
| `add-iam-policy-binding` says "condition is invalid" | Your gcloud version is old | Upgrade: `gcloud components update` |
| Key download file is empty | Rare; 401 from the API | Re-run the command; old key appears in the console anyway |
| `gcloud secrets create` says already exists | You've run this phase twice | Safe to ignore — secret already there |

### Rollback

```bash
# Remove a service account (will break anything using it)
gcloud iam service-accounts delete $DEPLOY_SA --project=$PROJECT_ID

# Remove a key (force a rotation)
gcloud iam service-accounts keys list --iam-account=$DEPLOY_SA --project=$PROJECT_ID
gcloud iam service-accounts keys delete <KEY_ID> --iam-account=$DEPLOY_SA --project=$PROJECT_ID
```

### Checkpoint

- [ ] `citrus-deploy` SA exists with 6 roles
- [ ] `citrus-api-runtime` SA exists with 3 roles
- [ ] (deferred to cutover) Workload Identity Federation for CI
- [ ] 4 placeholder secrets exist in Secret Manager

---

## 🛑 Second checkpoint — consider stopping here for the night

At this point the new project exists, has APIs enabled, has Firebase,
and has deploy identities. The old project is still serving 100% of
production traffic. Nothing has broken.

The remaining phases are the "stand up the parallel stack" phases,
and they're rewarding but involved. If you're past midnight or tired,
stopping here is fine — the foundation is safe, the startup program
application is in, and you can pick up Phase 8+ fresh tomorrow.

If you're continuing: Phase 8 is Cloud Workstations (can run in the
background while you do 9–11). Phases 9–11 are the actual
parallel-deploy of the Citrus stack.

---

## Phase 8 — Provision Cloud Workstations (30–45 min, mostly waiting)

**Purpose.** Stand up browser/IDE-accessible dev environments for you
and your CTO. Two instances, one shared cluster, pre-installed with
Node 20, Python 3.12, gcloud, firebase-tools. Solves: "my laptop is
authed to the wrong account," "new engineer onboarding takes 4 hours,"
and "CTO and I keep stepping on each other's local state."

**Cost reminder:** ~$0.10/hr for the cluster (always-on) + ~$0.15/hr
per running workstation instance. Workstations auto-stop after 2 hours
idle by default. Expect ~$30/mo for 2 devs at 6h/day each. The $300
free trial covers ~10 months of this.

### 8.1 Pick a region

Use `us-central1` to match Cloud Run. Keeps network latency to Cloud
Run, Supabase (us-east via Vercel Edge), and your laptop within a
reasonable envelope.

```bash
PROJECT_ID=citrus-fantasy-prod
REGION=us-central1
```

### 8.2 Create the cluster

The cluster is the control plane. One cluster per region, shared by
all workstation configs/instances.

```bash
gcloud workstations clusters create citrus-dev-cluster \
  --region=$REGION \
  --network="projects/$PROJECT_ID/global/networks/default" \
  --subnetwork="projects/$PROJECT_ID/regions/$REGION/subnetworks/default" \
  --project=$PROJECT_ID
```

**This command blocks for 5–10 minutes.** The cluster provisions a
private VPC connector, a control plane, and readiness probes. Leave
the terminal open. If you Ctrl-C, it keeps provisioning in the
background — don't panic, just poll with:

```bash
gcloud workstations clusters describe citrus-dev-cluster \
  --region=$REGION \
  --project=$PROJECT_ID \
  --format="value(state)"
# ACTIVE when ready.
```

### 8.3 Create a workstation config

The config defines the machine type, disk, and container image all
workstations in it will use.

```bash
gcloud workstations configs create citrus-dev-config \
  --cluster=citrus-dev-cluster \
  --region=$REGION \
  --machine-type=e2-standard-4 \
  --pd-disk-size=200 \
  --pd-disk-type=pd-standard \
  --idle-timeout=7200 \
  --running-timeout=43200 \
  --container-predefined-image=codeoss \
  --project=$PROJECT_ID
```

**Flags:**

| Flag | Value | Why |
| --- | --- | --- |
| `machine-type` | `e2-standard-4` | 4 vCPU / 16GB. Enough to run the full Citrus stack locally. |
| `pd-disk-size` | `200` | 200GB persistent disk. Survives restarts. |
| `pd-disk-type` | `pd-standard` | Cheaper than SSD; IDEs don't need SSD IOPS. |
| `idle-timeout` | `7200` | Auto-stop after 2h idle. Bill stops. |
| `running-timeout` | `43200` | Hard-stop after 12h continuous use. Forgetful-dev protection. |
| `container-predefined-image` | `codeoss` | Visual Studio Code OSS in the browser. Alternatives: `intellij`, `pycharm`. |

### 8.4 Create two workstation instances

```bash
# Yours
gcloud workstations create citrus-dev-<your-handle> \
  --cluster=citrus-dev-cluster \
  --config=citrus-dev-config \
  --region=$REGION \
  --project=$PROJECT_ID

# CTO's
gcloud workstations create citrus-dev-<cto-handle> \
  --cluster=citrus-dev-cluster \
  --config=citrus-dev-config \
  --region=$REGION \
  --project=$PROJECT_ID
```

### 8.5 Grant each user access

`roles/workstations.user` is **not bindable at the project level**
(`INVALID_ARGUMENT: Role roles/workstations.user is not supported
for this resource`). It has to be bound at workstation-cluster,
workstation-config, or workstation-instance level. The CLI
subcommand coverage for those is patchy across gcloud versions,
so the reliable path is the Console UI.

**Console UI (recommended):**

1. https://console.cloud.google.com/workstations/configurations → pick
   `citrus-dev-config`
2. Open the **Permissions** panel (right-side info panel)
3. **Grant access** → New principals: `<you>@citrusfantasysports.com`
   → Role: **Cloud Workstations User** → Save
4. Repeat for your CTO

Config-level grants both users access to every workstation in the
config. For a 2-person team that's the same effective outcome as
per-instance. If you later want stricter scoping (contractors,
external reviewers), switch to per-instance via the same Permissions
panel on the workstation itself.

**CLI fallback (may not be exposed in your gcloud version):**

```bash
gcloud workstations configs add-iam-policy-binding citrus-dev-config \
  --cluster=citrus-dev-cluster --region=$REGION --project=$PROJECT_ID \
  --member="user:<email>" --role="roles/workstations.user"
```

### 8.6 Start and connect

```bash
# Start yours
gcloud workstations start citrus-dev-<your-handle> \
  --cluster=citrus-dev-cluster \
  --config=citrus-dev-config \
  --region=$REGION \
  --project=$PROJECT_ID

# Get the URL (valid for ~30 min; re-run to get a fresh link)
gcloud workstations get-iam-policy citrus-dev-<your-handle> \
  --cluster=citrus-dev-cluster --config=citrus-dev-config \
  --region=$REGION --project=$PROJECT_ID

# Or open the UI (easier):
# https://console.cloud.google.com/workstations
```

From the console, click **Start** next to your workstation, then
**Launch** once it's running. The browser tab opens a full VS Code
interface backed by the cloud VM.

### 8.7 First-run setup inside the workstation

In the VS Code terminal of your new workstation:

```bash
# Auth gcloud against your identity
gcloud auth login --no-launch-browser
# Follow the URL, paste the verification code back

gcloud config set project citrus-fantasy-prod

# Install firebase
npm install -g firebase-tools
firebase login --no-localhost

# Clone the repo
git clone https://github.com/Gstormsfh/citrus-league-storm-main.git
cd citrus-league-storm-main

# Set up branch
git checkout claude/recover-previous-session-YHNSG

# Install deps
npm ci

# Sanity check
npm run test
```

You now have an identical dev environment to your laptop, usable from
any browser at `workstations.cloud.google.com`.

### 8.8 Share a startup script (optional, nice-to-have)

To save 10 min per new workstation, bake the setup into the config:

```bash
cat > /tmp/workstation-startup.sh <<'EOF'
#!/bin/bash
npm install -g firebase-tools
echo 'export PATH=$HOME/.local/bin:$PATH' >> ~/.bashrc
EOF

# Apply it (requires re-creating the config — do this only if you
# don't have workstations running yet)
```

Skip this for tonight. Add it after the workstations are proven.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Cluster stuck in `CREATING` > 15 min | Network provisioning issue | `gcloud workstations clusters describe ... --format=yaml` and look at `conditions` |
| Can't launch workstation | Instance not started | Click **Start** in the console UI first, then **Launch** |
| VS Code terminal `gcloud auth login` opens a broken URL | Running inside the browser tab, can't redirect | Use `--no-launch-browser` and follow the code flow |
| `firebase login` fails | Same reason | Use `--no-localhost` and follow the code flow |
| `npm ci` fails on first run | Default image doesn't have Node 20 | `nvm install 20 && nvm use 20 && npm ci` |

### Rollback

```bash
# Delete one workstation
gcloud workstations delete citrus-dev-<handle> \
  --cluster=citrus-dev-cluster --config=citrus-dev-config \
  --region=$REGION --project=$PROJECT_ID

# Delete the config
gcloud workstations configs delete citrus-dev-config \
  --cluster=citrus-dev-cluster --region=$REGION --project=$PROJECT_ID

# Delete the cluster (tears down control plane)
gcloud workstations clusters delete citrus-dev-cluster \
  --region=$REGION --project=$PROJECT_ID
```

### Checkpoint

- [ ] Cluster `citrus-dev-cluster` is `ACTIVE`
- [ ] Config `citrus-dev-config` exists with e2-standard-4 + 200GB disk
- [ ] Two workstations created, IAM bound to you and CTO
- [ ] You can open your workstation in the browser and it reaches
      VS Code
- [ ] Inside the workstation, `git clone` + `npm ci` + `npm run test`
      all succeed
- [ ] CTO has received the link to their workstation

---

## Phase 9 — Deploy `@citrus/server` to new Cloud Run (parallel) (20 min)

**Purpose.** Stand up a fully working copy of the API server in the
new project. This does NOT replace prod — old Cloud Run keeps serving
`api.citrusfantasysports.com`. The new service gets its own autogenerated
URL (`https://citrus-api-<hash>.a.run.app`), which we'll wire to the new
Firebase Hosting in Phase 10.

**Run this inside your new Cloud Workstation** if you want — the
environment is identical. Or run from your laptop, still fine.

### 9.1 Prerequisites inside the workstation/laptop

```bash
cd /path/to/citrus-league-storm-main
git status                 # clean working tree, on claude/recover-previous-session-YHNSG
gcloud config get-value project   # → citrus-fantasy-prod
```

If the project is wrong: `gcloud config set project citrus-fantasy-prod`.

### 9.2 First, let's actually build and test locally

Don't deploy a broken build. Takes 2 min.

```bash
npm ci
npm run build                  # builds shared + web
npm run build:server           # builds shared + server
npm run test                   # ~1200+ web tests
npm run test:server            # ~420+ server tests
```

If any of these fail, **stop and fix**. Deploying broken code to the
new stack just adds "new broken stack" to the problem list.

### 9.3 Deploy to the new Cloud Run

Use the declarative config we already have at
`ops/cloudrun/service.yaml` — it's the post-postmortem config
(minScale=1, maxScale=10, 2Gi, 2 CPU). We'll adapt it for the new
project with a one-liner.

```bash
PROJECT_ID=citrus-fantasy-prod
REGION=us-central1
RUNTIME_SA=citrus-api-runtime@$PROJECT_ID.iam.gserviceaccount.com

# Build from source, deploy to new Cloud Run, minimal env vars for now
cd server
gcloud run deploy citrus-api \
  --source=. \
  --region=$REGION \
  --project=$PROJECT_ID \
  --service-account=$RUNTIME_SA \
  --min-instances=1 \
  --max-instances=10 \
  --memory=2Gi \
  --cpu=2 \
  --cpu-boost \
  --no-cpu-throttling \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,VITE_SUPABASE_URL=<your-supabase-url>,SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>,VITE_SUPABASE_ANON_KEY=<your-anon-key>"
cd ..
```

**⚠️ Do not include `PORT` in `--set-env-vars`.** Cloud Run reserves
the `PORT` env var and will reject the deploy with `The following
reserved env names were provided: PORT`. The Hono server already
reads `process.env.PORT` and Cloud Run injects it (default 8080).

**Security note:** env vars for secrets are a stopgap for tonight's
parallel test. Before cutover we migrate these to Secret Manager
(pre-seeded in Phase 7.4). Track in the cutover runbook.

First deploy takes ~3–5 min (Cloud Build compiles the Docker image,
pushes to Artifact Registry, creates a revision, routes 100% traffic).

### 9.4 Grab the new Cloud Run URL

```bash
gcloud run services describe citrus-api \
  --region=$REGION \
  --project=$PROJECT_ID \
  --format="value(status.url)"

# Expected:
# https://citrus-api-<12-char-hash>-uc.a.run.app
```

Write this down: `NEW_API_URL = ____________________`

### 9.5 Smoke-test the new API

```bash
NEW_API_URL=<from 9.4>

# Health check
curl -s $NEW_API_URL/api/health | jq .
# Expected: {"status":"ok","timestamp":"...","version":"..."}

# Public players endpoint (no auth)
curl -s $NEW_API_URL/api/public/player-ids | jq '.[] | select(.id != null)' | head -5
# Expected: 5 player ID records

# 404 for missing routes (not a 500)
curl -s -w "%{http_code}\n" -o /dev/null $NEW_API_URL/api/nonexistent
# Expected: 404
```

If the health check fails, check Cloud Run logs:

```bash
gcloud run services logs read citrus-api \
  --region=$REGION --project=$PROJECT_ID --limit=50
```

### 9.6 Check the GOALIE_GSAX regression test

The April 10 regression that broke every goalie player card. We
shipped a tripwire for it (`d26d232`). Verify it runs against the
new schema:

```bash
# From inside the repo (laptop or workstation, doesn't matter — tests
# hit the real Supabase schema)
npm run test -- GOALIE_GSAX
# Expected: pass
```

If this fails on the new stack, something with the Supabase
service-role key is wrong — the test can't read the projections
table. Re-check env vars in 9.3.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `gcloud run deploy` says "Permission denied on service account" | Deploy SA can't actAs runtime SA | Phase 7 should have granted this; re-run `roles/iam.serviceAccountUser` |
| Build fails at "copying files" | `.gcloudignore` is blocking something needed | `touch server/.gcloudignore` and re-deploy; or `gcloud beta run deploy` for more forgiving defaults |
| Build succeeds but health check 503s | Container didn't bind to $PORT | Check `server/src/index.ts` uses `process.env.PORT`. Should already be fixed on this branch. |
| Deploy succeeds, health check 500s | Supabase env vars wrong | Re-check the --set-env-vars in 9.3; watch logs |
| CORS error when you hit the URL from a browser | Hono CORS config doesn't allow the new origin | Not needed tonight — we're hitting the API directly. In Phase 10, use the Firebase `.web.app` URL which CORS already permits |

### Rollback

```bash
# Delete the Cloud Run service (no cost impact, fully reversible)
gcloud run services delete citrus-api \
  --region=$REGION --project=$PROJECT_ID

# Or roll a revision back if a bad deploy shipped
gcloud run services update-traffic citrus-api \
  --region=$REGION --project=$PROJECT_ID \
  --to-revisions=<previous-revision>=100
```

### Checkpoint

- [ ] `gcloud run services list` in new project shows `citrus-api` as Ready
- [ ] Health endpoint returns `{"status":"ok"}` from the new URL
- [ ] `NEW_API_URL` written down for Phase 10
- [ ] Goalie GSAX tripwire test passes
- [ ] Old prod API (`api.citrusfantasysports.com`) still healthy
      — confirm: `curl https://api.citrusfantasysports.com/api/health`

---

## Phase 10 — Deploy `@citrus/web` to new Firebase Hosting (.web.app URL) (15 min)

**Purpose.** Stand up the SPA in the new Firebase project at the default
`citrus-fantasy-prod.web.app` URL. Points at the new Cloud Run API from
Phase 9. Does NOT touch the custom domain `citrusfantasysports.com` —
that stays on the old project until cutover.

### 10.1 Build the web app pointed at the new API

The web build bakes in `VITE_API_URL` at build time, so we need to
build fresh with the new API URL.

```bash
NEW_API_URL=<from Phase 9.4>

# From repo root
VITE_API_URL=$NEW_API_URL \
VITE_SUPABASE_URL=<your-supabase-url> \
VITE_SUPABASE_ANON_KEY=<your-anon-key> \
VITE_FIREBASE_API_KEY=<from Phase 6.3> \
VITE_FIREBASE_APP_ID=<from Phase 6.3> \
VITE_FIREBASE_MEASUREMENT_ID=<from Phase 6.3 or blank> \
VITE_SENTRY_DSN=<your sentry dsn, or blank for now> \
npm run build
```

The build should complete in ~30–60s. `dist/` now contains the
production bundle.

**Verify no regressions:**

```bash
ls -lh apps/web/dist/assets/*.png 2>/dev/null | awk '{print $5, $9}'
# Total PNG budget: ≤ 512KB per our CI gate. Confirm.

du -sh apps/web/dist/
# Expect < 5MB gzipped per our budget
```

### 10.2 Deploy to Firebase Hosting

```bash
PROJECT_ID=citrus-fantasy-prod

firebase use $PROJECT_ID
firebase deploy --only hosting --project=$PROJECT_ID
```

First deploy ~30s. Output:

```
✔  hosting[citrus-fantasy-prod]: release complete
Hosting URL: https://citrus-fantasy-prod.web.app
```

### 10.3 Smoke-test the new site

Open `https://citrus-fantasy-prod.web.app` in an incognito window.

Check:

1. **Page loads** — landing page renders without console errors
2. **Sign in works** — try signing in with a test account. Supabase
   auth should succeed because the Supabase project is shared.
3. **API calls succeed** — open DevTools Network tab. Click anything
   that triggers an API call (e.g., league list). Confirm requests
   go to `<NEW_API_URL>/api/*` and return 200.
4. **No CORS errors** — if you see CORS errors, add the `.web.app`
   origin to the server's CORS allowlist. Should already be permissive
   in our Hono setup, but verify.
5. **Draft room loads** — navigate to a league's draft room. Confirm
   broadcast / realtime connection establishes (see `ConnectionStatus`
   component top-right).

### 10.4 Update Supabase auth redirect URLs

Supabase auth only allows redirects to URLs you've whitelisted. To
let the new `.web.app` URL work for auth flows (email confirmation,
password reset):

1. https://supabase.com/dashboard → your project → Authentication →
   URL Configuration
2. **Site URL:** leave as `https://citrusfantasysports.com` (prod)
3. **Additional Redirect URLs:** add `https://citrus-fantasy-prod.web.app`
   (and `https://citrus-fantasy-prod.web.app/**` for path patterns)
4. Save

This is the one non-GCP step tonight that touches a shared resource.
Old prod still works — we're only **adding** to the allowlist, not
replacing.

### 10.5 Optional — hook up a "staging" subdomain

If you want a cleaner URL than `.web.app` for parallel testing,
create `staging.citrusfantasysports.com`:

1. Firebase Console → new project → Hosting → **Add custom domain**
2. Enter `staging.citrusfantasysports.com`
3. Firebase generates a TXT record + A records
4. Add them in your DNS provider (wherever `citrusfantasysports.com`
   is registered)
5. Wait for propagation (5 min to 24h)
6. Firebase auto-provisions SSL

This is optional. The `.web.app` URL works fine for tonight's smoke
testing. If you're juggling too much, skip it.

### Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Build fails with "unknown env VITE_*" | Missing env var in the build command | Re-check 10.1; every VITE_* must be set |
| Firebase deploy "site does not exist" | Wrong project | `firebase use citrus-fantasy-prod` then retry |
| Page loads but shows "API not reachable" | `NEW_API_URL` has trailing slash or is wrong | Rebuild with clean URL |
| Supabase sign-in redirects fail | Didn't add the redirect URL | Go back to 10.4 |
| Sentry errors fire on load | Sentry DSN is from old project | Either set VITE_SENTRY_DSN blank for tonight, or create a new Sentry project |

### Rollback

```bash
firebase hosting:disable --project=$PROJECT_ID
# Takes the .web.app URL offline. Can be re-enabled.
```

### Checkpoint

- [ ] `https://citrus-fantasy-prod.web.app` loads
- [ ] Sign-in works (Supabase auth)
- [ ] Network tab shows calls hitting the new Cloud Run URL
- [ ] Draft room opens without console errors
- [ ] Old prod site `citrusfantasysports.com` still working
      — confirm in a different incognito window

---

## Phase 11 — End-to-end smoke test (20 min)

**Purpose.** Prove the new stack works against real user flows before
declaring it ready for cutover later this week. Five scenarios,
executed against `citrus-fantasy-prod.web.app`.

**Before you start:** make sure you have two browsers or one browser
with two profiles, so you can test multi-user flows.

### 11.1 Auth flow (5 min)

- [ ] Open `citrus-fantasy-prod.web.app` in incognito
- [ ] Click **Sign up**
- [ ] Enter a test email + password (use `+citrustest@` alias)
- [ ] Receive and click the confirmation email
- [ ] Redirected back to the new site, now signed in
- [ ] `/api/users/me` returns your user record (check Network tab)

**Failure mode:** Confirmation email links to old site. Fix:
Phase 10.4 — double-check Additional Redirect URLs on Supabase.

### 11.2 League creation + join (5 min)

- [ ] As the test user, click **Create League**
- [ ] Create a standard H2H points league, 10 teams, snake draft
- [ ] Open a second browser, sign up as a different test user
- [ ] From league settings, get the join code
- [ ] Second user joins via code
- [ ] Both users appear in league member list

**Failure mode:** Join fails with 403. The server can't find the
league for the joining user. RLS issue — verify
`LeagueMembershipService` is using the per-request Supabase client.
Already fixed on this branch, but re-verify.

### 11.3 Draft room smoke (5 min)

**Critical flow** — this is what April 10 broke.

- [ ] Both users open the draft room for their league
- [ ] Commissioner (first user) clicks **Start Draft**
- [ ] Timer starts and ticks down in both browsers
- [ ] First user's pick appears in second user's browser within 100ms
- [ ] `ConnectionStatus` component (top-right) shows **Connected**
      in both
- [ ] Open a player card for a goaltender — page loads with GSAX
      numbers (not 500 error)
- [ ] Make a few picks on both sides; confirm pick history, team rosters,
      auto-advance of draft order

**Failure mode:** This is where the April 10 regressions would show
up. If a goalie card 500s, the GSAX_COLUMNS constant is still wrong
in the new env — inspect `packages/shared/src/constants/columns.ts:180`.
If notifications leak between leagues, `NotificationService.ts:109`
isn't the fixed build.

### 11.4 Concurrent load (3 min, optional but recommended)

Using k6 from the repo (already scaffolded in `scripts/load-test/`):

```bash
k6 run \
  --env API_URL=$NEW_API_URL \
  --env WEB_URL=https://citrus-fantasy-prod.web.app \
  scripts/load-test/scenarios/smoke.js
```

- [ ] k6 completes without errors
- [ ] p95 latency < 500ms
- [ ] No 5xx responses

### 11.5 Confirm old prod still healthy (2 min)

You've been swimming in the new project for hours. Spot-check
production is still fine:

- [ ] `curl https://api.citrusfantasysports.com/api/health` → 200
- [ ] Open `https://citrusfantasysports.com` in incognito — landing
      page loads
- [ ] Real user signed in to real league can still see their draft

**If old prod broke while you worked on new:** rare but possible if
Supabase auth redirect URL edits accidentally removed the prod URL.
Go back to Phase 10.4 and confirm `https://citrusfantasysports.com`
is still in the redirect list.

### Checkpoint

- [ ] All 5 scenarios above pass on the new stack
- [ ] Old prod still works
- [ ] You have screenshots or a short video of the new stack working
      (for your CTO/cofounders)

---

## Phase 12 — Document & next steps (15 min)

**Purpose.** Capture what exists now so tomorrow-you (or CTO-you) can
pick up the cutover cleanly.

### 12.1 Write down the IDs you generated tonight

Create a **private** note in your password manager (1Password secure
note, Bitwarden, etc.) with:

```
Citrus Fantasy Sports — New GCP Org — provisioned <date>

ORG_ID                    = <from Phase 1.1>
BILLING_ACCOUNT_ID        = <from Phase 3.2>
PROJECT_ID                = citrus-fantasy-prod
PROJECT_NUMBER            = <from Phase 4.4>
NEW_API_URL               = <from Phase 9.4>
NEW_WEB_URL               = https://citrus-fantasy-prod.web.app

Deploy SA                 = citrus-deploy@citrus-fantasy-prod.iam.gserviceaccount.com
Runtime SA                = citrus-api-runtime@citrus-fantasy-prod.iam.gserviceaccount.com

Deploy SA key             = [stored in 1Password as "GCP_SA_KEY (new org)"]
Firebase config JSON      = [stored in 1Password as "Firebase config — citrus-fantasy-prod"]

Google for Startups app   = submitted <date>, awaiting approval
$300 free trial expires   = <90 days from Phase 3 date>

DO NOT ROTATE GITHUB SECRETS YET. That happens in cutover.
```

### 12.2 DO NOT do these things yet

These are the cutover actions. Doing them tonight would break prod.

- ❌ Change DNS for `citrusfantasysports.com`
- ❌ Change GitHub Actions secrets (`VITE_API_URL`, `GCP_SA_KEY`,
  `FIREBASE_SERVICE_ACCOUNT`) from the old values
- ❌ Disable billing on the old project
- ❌ Delete the old project
- ❌ Remove `gstormsff@gmail.com` from the old project IAM
- ❌ Execute the postmortem ops items (`docs/OPS_CHECKLIST.md`) in
  the new project — wait until after cutover, otherwise you'll
  do the work in the wrong project

### 12.3 What TO do in the next 24–48 hours

- Monitor the new stack for stability (you'll get Firebase/Cloud Run
  usage alerts in your email — eyeball them)
- Let the Google for Startups application bake (1–3 weeks)
- Draft the cutover runbook with your CTO:
  `docs/RUNBOOKS/GCP_PROJECT_CUTOVER.md` (skeleton lives in this repo
  already — expand it with your specific DNS provider and timing
  preferences)

### 12.4 Update `CLAUDE.md` with a dated note

Add a line to `CLAUDE.md` under a new "Migration status" section:

```markdown
## Migration status (as of <date>)

- NEW GCP project `citrus-fantasy-prod` is provisioned under
  `citrusfantasysports.com` org. See
  `docs/RUNBOOKS/GCP_ORG_SETUP.md` for what was built.
- OLD GCP project `citrus-fantasy-sports` (gmail-parented) still
  serves 100% of production traffic at `citrusfantasysports.com`.
- Cutover pending. See `docs/RUNBOOKS/GCP_PROJECT_CUTOVER.md`.
- Do not execute `docs/OPS_CHECKLIST.md` items in the new project
  until after cutover.
```

I'll add that paragraph as a follow-up edit to this branch.

### 12.5 Communicate to your CTO

Short message like:

> "Stood up the new GCP org tonight. Old prod is untouched and serving
> traffic as normal. New stack parallel-running at
> `citrus-fantasy-prod.web.app` — please poke at it over the next 24h
> and let me know if anything looks off. If it looks stable, we'll do
> the DNS cutover this weekend. Your workstation URL: <link>"

### Checkpoint

- [ ] Private note written with all IDs
- [ ] `CLAUDE.md` update PR / edit in flight
- [ ] CTO has the new workstation URL and the `.web.app` smoke URL
- [ ] You've resisted the urge to do any "just one more thing" in the
      old project tonight

---

## Troubleshooting index — anything that went wrong

If you made it this far, you have a working parallel stack. If you did
not, jump to the phase where things stopped working:

- Can't see the org: **Phase 1.1**
- Can't grant yourself roles: **Phase 1.2**
- Billing failed: **Phase 3**
- Project won't create: **Phase 4.2**
- APIs won't enable: **Phase 5.3**
- Firebase won't link: **Phase 6.1**
- SA key download broken: **Phase 7.3**
- Workstation stuck: **Phase 8.2**
- Cloud Run deploy failing: **Phase 9.3**
- Firebase Hosting deploy failing: **Phase 10.2**
- Auth redirect loop: **Phase 10.4**
- Goalie card 500s: **Phase 11.3**

## Total teardown (nuclear option)

If something is so broken you want to start over:

```bash
# 1. Delete workstations
gcloud workstations delete <name> --cluster=citrus-dev-cluster \
  --config=citrus-dev-config --region=us-central1 --project=citrus-fantasy-prod

# 2. Delete the whole project (30-day recovery window)
gcloud projects delete citrus-fantasy-prod

# 3. Billing account can be closed from console → Billing → Close
# 4. Org itself cannot be deleted — it's tied to the Workspace domain.
#    Only way is to delete the Workspace account, which you do not want.
```

Old prod (`citrus-fantasy-sports` under `gstormsff@gmail.com`) is
**unaffected** by any of the above. That's the entire point of doing
this in parallel.

---

## Related documents

- `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md` — the April 10 incident
  this migration helps prevent recurring
- `docs/RUNBOOKS/PRE_DRAFT_CHECKLIST.md` — T-60/45/30/15/5 draft
  readiness (will be re-executed against the NEW project after cutover)
- `docs/OPS_CHECKLIST.md` — 7 console-side ops items (do AFTER cutover)
- `docs/DEPLOY_RUNBOOK.md` — playoff-readiness deploy runbook (applies
  to whichever project is currently serving prod)
- `docs/RUNBOOKS/GCP_PROJECT_CUTOVER.md` — the DNS-flip runbook for
  later this week




