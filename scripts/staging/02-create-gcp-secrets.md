# 02 — Create staging secrets in Google Secret Manager

**Goal:** populate the three secrets that `ops/cloudrun/service-staging.yaml` expects,
so the staging Cloud Run service can boot and talk to the staging Supabase project.

**Prereq:** you've completed `01-mark-migrations-applied.sql` (staging Supabase has schema).

**Runtime:** ~5 minutes. You only do this once.

---

## What we're creating

Three secrets in the STAGING GCP project's Secret Manager. The Cloud Run service
reads them at startup via the `valueFrom.secretKeyRef` bindings in
`service-staging.yaml`.

| Secret name | Contents | Where it comes from |
| --- | --- | --- |
| `SUPABASE_URL` | `https://jjgspcpvqaiitloglxbb.supabase.co` | The staging Supabase project URL |
| `SUPABASE_ANON_KEY` | `eyJ...` (JWT) | Supabase dashboard → staging → Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (JWT) | Supabase dashboard → staging → Settings → API → service_role |

---

## Steps

### 1. Make sure your gcloud is pointed at the staging project

```powershell
gcloud config set project citrus-fantasy-staging
gcloud config get-value project
# Expected: citrus-fantasy-staging
```

### 2. Create each secret

**SUPABASE_URL:**
```powershell
echo "https://jjgspcpvqaiitloglxbb.supabase.co" | gcloud secrets create SUPABASE_URL --data-file=- --project=citrus-fantasy-staging
```

**SUPABASE_ANON_KEY:** (paste the `anon` JWT from Supabase dashboard)
```powershell
# Interactive: this opens your default editor to paste the key, then saves
gcloud secrets create SUPABASE_ANON_KEY --data-file=- --project=citrus-fantasy-staging
# Paste the JWT, press Ctrl+D (or Ctrl+Z on Windows) to finish
```

**SUPABASE_SERVICE_ROLE_KEY:** (paste the `service_role` JWT from Supabase dashboard)
```powershell
gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=- --project=citrus-fantasy-staging
# Paste the JWT, press Ctrl+D (or Ctrl+Z on Windows) to finish
```

### 3. Grant the runtime service account access to read the secrets

First, create the service account that Cloud Run will run AS:

```powershell
gcloud iam service-accounts create citrus-api-runtime --display-name="Citrus API Runtime (staging)" --description="Cloud Run service identity for @citrus/server on staging" --project=citrus-fantasy-staging
```

Then bind it to the three least-privilege roles:

```powershell
$RUNTIME_SA = "citrus-api-runtime@citrus-fantasy-staging.iam.gserviceaccount.com"

foreach ($role in @('roles/secretmanager.secretAccessor', 'roles/logging.logWriter', 'roles/monitoring.metricWriter')) {
  gcloud projects add-iam-policy-binding citrus-fantasy-staging --member="serviceAccount:$RUNTIME_SA" --role=$role --condition=None
}
```

### 4. Verify

```powershell
gcloud secrets list --project=citrus-fantasy-staging
# Expected: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

gcloud iam service-accounts list --project=citrus-fantasy-staging
# Expected: citrus-api-runtime@citrus-fantasy-staging.iam.gserviceaccount.com
```

---

## Rotation

To update a secret (new key version):
```powershell
echo "new-value" | gcloud secrets versions add SUPABASE_SERVICE_ROLE_KEY --data-file=- --project=citrus-fantasy-staging
```

Cloud Run picks up `latest` on the next revision deploy. No downtime.
