# 03 — Wire up staging CI deploys (GitHub Actions)

**Goal:** enable `.github/workflows/staging-deploy.yml` to auto-deploy on every push to the `staging` branch. Replaces the hour of manual gcloud/firebase commands from `02-create-gcp-secrets.md` and the initial local deploy.

**Prereq:** `02-create-gcp-secrets.md` is done (staging Cloud Run is live; runtime SA + secrets exist).

**Runtime:** ~20 minutes. One-time setup per repo.

---

## Overview

The staging-deploy workflow needs to authenticate as two service accounts:

1. **`citrus-deploy-staging`** — pushes Cloud Run revisions and container images
2. **Firebase service account** — pushes the web bundle to Firebase Hosting

Each needs a JSON key stored as a GitHub Actions secret. Plus four `VITE_*` secrets for the Vite build step.

---

## Step 1 — Create the deploy service account

```powershell
gcloud iam service-accounts create citrus-deploy-staging --display-name="Citrus CI Deploy (staging)" --description="GitHub Actions uses this SA to push staging Cloud Run revisions" --project=citrus-fantasy-staging
```

Grant the roles it needs:

```powershell
$DEPLOY_SA = "citrus-deploy-staging@citrus-fantasy-staging.iam.gserviceaccount.com"

foreach ($role in @(
    'roles/run.admin',
    'roles/iam.serviceAccountUser',
    'roles/artifactregistry.writer',
    'roles/cloudbuild.builds.editor',
    'roles/storage.admin',
    'roles/firebasehosting.admin'
  )) {
  gcloud projects add-iam-policy-binding citrus-fantasy-staging --member="serviceAccount:$DEPLOY_SA" --role=$role --condition=None
}
```

## Step 2 — Create a JSON key for the deploy SA

On fresh GCP orgs, key creation may be blocked by `constraints/iam.disableServiceAccountKeyCreation`. If so, temporarily allow it:

```powershell
# Check current enforcement
gcloud resource-manager org-policies describe iam.disableServiceAccountKeyCreation --project=citrus-fantasy-staging 2>$null

# If enforced, create a policy file that disables enforcement at the project level
@"
name: projects/citrus-fantasy-staging/policies/iam.disableServiceAccountKeyCreation
spec:
  rules:
    - enforce: false
"@ | Set-Content $env:TEMP\allow-sa-keys.yaml

gcloud org-policies set-policy $env:TEMP\allow-sa-keys.yaml
```

Wait 30 seconds for propagation, then create the key:

```powershell
gcloud iam service-accounts keys create $env:USERPROFILE\citrus-deploy-staging-key.json --iam-account=citrus-deploy-staging@citrus-fantasy-staging.iam.gserviceaccount.com --project=citrus-fantasy-staging
```

Key file is now at `C:\Users\garre\citrus-deploy-staging-key.json`.

**CRITICAL:** this JSON file IS the credential. Do not commit it. Add to GitHub secrets next, then delete the local file.

## Step 3 — Add GitHub Actions secrets

Open: https://github.com/Gstormsfh/citrus-league-storm-main/settings/secrets/actions

Click **"New repository secret"** for each of these:

| Secret name | Value |
|---|---|
| `STAGING_GCP_SA_KEY` | Contents of `citrus-deploy-staging-key.json` (paste the entire JSON blob) |
| `STAGING_FIREBASE_SERVICE_ACCOUNT` | Same JSON blob for now (firebasehosting.admin is included in step 1 roles) |
| `STAGING_VITE_SUPABASE_URL` | `https://jjgspcpvqaiitloglxbb.supabase.co` |
| `STAGING_VITE_SUPABASE_ANON_KEY` | Staging anon key JWT (from your password manager or Supabase dashboard) |
| `STAGING_VITE_FIREBASE_API_KEY` | `AIzaSyBqG1dKoUYoQlv89Ph-pLIHxspbNUoJuQQ` |
| `STAGING_VITE_FIREBASE_APP_ID` | `1:85541179096:web:e76ff9a8f5e70b384a11ad` |

**After pasting the JSON key into GitHub:** delete the local file.

```powershell
Remove-Item $env:USERPROFILE\citrus-deploy-staging-key.json
```

Re-enable the key-creation constraint you disabled in step 2:

```powershell
@"
name: projects/citrus-fantasy-staging/policies/iam.disableServiceAccountKeyCreation
spec:
  rules:
    - enforce: true
"@ | Set-Content $env:TEMP\block-sa-keys.yaml

gcloud org-policies set-policy $env:TEMP\block-sa-keys.yaml
```

## Step 4 — Create the `staging` GitHub Environment

Workflow uses `environment: staging` on the deploy jobs, which requires an Environment configured in GitHub. This lets us add per-env protections later (deployment approvals, secret scoping).

1. Go to: https://github.com/Gstormsfh/citrus-league-storm-main/settings/environments
2. Click **"New environment"**, name it `staging`
3. Leave all protections off for now (no approval required, no wait timer)
4. Click **Configure environment** to save

## Step 5 — Test by pushing to the `staging-setup` branch

(The workflow is configured to trigger on pushes to `staging` OR `staging-setup`.)

Any push to `staging-setup` from this point on will trigger the workflow. To test immediately, just do a trivial change and push — or trigger manually from:
https://github.com/Gstormsfh/citrus-league-storm-main/actions/workflows/staging-deploy.yml

Watch the run complete. Expected duration: ~8-10 minutes end-to-end.

## Step 6 — Once verified, cut over to `staging` as the real branch

```powershell
# Create staging branch from staging-setup (once everything is green)
git checkout staging-setup
git pull
git checkout -b staging
git push -u origin staging
```

Then remove `staging-setup` from the workflow's trigger list so only `staging` pushes deploy:

Edit `.github/workflows/staging-deploy.yml`:
```yaml
on:
  push:
    branches:
      - staging    # remove the staging-setup line
```

Commit + push + merge to master when ready.

---

## Future rotation

To rotate the deploy SA key (good hygiene ~quarterly):
1. Re-run step 2 to generate a new key
2. Update `STAGING_GCP_SA_KEY` in GitHub Secrets
3. Delete the old key: `gcloud iam service-accounts keys delete OLD_KEY_ID --iam-account=...`
