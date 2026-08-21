#!/usr/bin/env bash
# ---------------------------------------------------------------------
# engine-fix-remote.sh  (fix <expected-sha256> | wait)
# Citrus - runs ON the prod draft-engine VM, uploaded by
# finish-engine-fix.ps1.
#
#   fix <sha>  Recreate the engine container so it picks up the
#              corrected supabase-db-url secret, then PROVE the env
#              matches Secret Manager byte for byte.
#   wait       Poll the engine's own LISTEN self-test until green.
#
# Why recreation is required: docker env vars are baked at `docker
# run`. The VM startup script's idempotency check (Step 4c) skips the
# replace when the image digests and Caddyfile are unchanged - it never
# considered secrets - so the earlier VM stop/start resurrected the old
# container, stale password and all.
# ---------------------------------------------------------------------
set -u
MODE="${1:-}"
TS() { date -u +%H:%M:%SZ; }

if [ "$MODE" = "fix" ]; then
  EXPECTED="${2:-}"
  if [ -z "$EXPECTED" ]; then
    echo "usage: engine-fix-remote.sh fix <expected-sha256>"
    exit 9
  fi

  echo "[$(TS)] === 1. the container we are replacing ==="
  sudo docker inspect -f 'created={{.Created}}  started={{.State.StartedAt}}' citrus-draft-engine 2>/dev/null || echo "no engine container present"

  echo "[$(TS)] === 2. remove it (also stops the bad-password retries that keep re-arming the ban) ==="
  sudo docker rm -f citrus-draft-engine >/dev/null 2>&1 && echo "removed" || echo "was not running"

  echo "[$(TS)] === 3. re-run the VM startup script (re-reads Secret Manager, recreates containers) ==="
  if command -v google_metadata_script_runner >/dev/null 2>&1; then
    sudo google_metadata_script_runner startup
    RC=$?
  else
    echo "google_metadata_script_runner not found - fetching startup-script metadata directly"
    curl -s -H "Metadata-Flavor: Google" \
      "http://metadata.google.internal/computeMetadata/v1/instance/attributes/startup-script" \
      | sudo tee /tmp/citrus-startup-manual.sh >/dev/null
    sudo bash /tmp/citrus-startup-manual.sh
    RC=$?
  fi
  echo "[$(TS)] startup runner exit code: $RC"
  echo "[$(TS)] tail of /var/log/citrus-startup.log:"
  sudo tail -n 15 /var/log/citrus-startup.log
  if [ "$RC" -ne 0 ]; then
    echo "[$(TS)] WARNING: nonzero exit from the startup runner. The verification below is the real test."
  fi

  echo "[$(TS)] === 4. verify the engine env now matches Secret Manager, byte for byte ==="
  if ! sudo docker inspect -f 'created={{.Created}}' citrus-draft-engine >/dev/null 2>&1; then
    echo "[$(TS)] FATAL: the engine container was not recreated. Fuller startup log:"
    sudo tail -n 50 /var/log/citrus-startup.log
    exit 3
  fi
  sudo docker inspect -f 'new container: created={{.Created}}' citrus-draft-engine
  GOT="$(sudo docker exec citrus-draft-engine printenv SUPABASE_DB_URL | sha256sum | awk '{print $1}')"
  echo "expected  sha256: $EXPECTED"
  echo "container sha256: $GOT"
  if [ "$GOT" != "$EXPECTED" ]; then
    echo "[$(TS)] FATAL: the recreated container does NOT hold the stored secret. Paste this back."
    exit 4
  fi
  echo "[$(TS)] MATCH - the engine now holds the exact bytes you stored and live-tested."
  exit 0
fi

if [ "$MODE" = "wait" ]; then
  echo "[$(TS)] polling /health/subscription every 30s, up to 80 minutes."
  echo "The engine retries its DB connection every 60s; the first attempt"
  echo "after the IP ban lapses (or is removed) will connect and the"
  echo "self-test fires within a few seconds of that."
  i=0
  while [ "$i" -lt 160 ]; do
    i=$((i+1))
    H="$(curl -s -m 5 http://localhost:3001/health/subscription 2>/dev/null || echo unreachable)"
    echo "[$(TS)] poll $i/160: $H"
    case "$H" in
      *'"ok":true'*)
        echo ""
        echo "[$(TS)] SUCCESS - the LISTEN subscription is connected."
        echo "recent subscription log lines:"
        sudo docker logs --since 5m citrus-draft-engine 2>&1 | grep event_subscription | tail -n 8
        exit 0
        ;;
    esac
    if sudo docker logs --since 2m citrus-draft-engine 2>&1 | grep -q 'password authentication failed'; then
      echo ""
      echo "[$(TS)] FATAL: the database rejected the NEW password. That contradicts"
      echo "the live test from your machine. Stop and paste this output back."
      exit 5
    fi
    sleep 30
  done
  echo "[$(TS)] TIMEOUT: not connected after 80 minutes. Paste this output back."
  exit 6
fi

echo "usage: engine-fix-remote.sh fix <expected-sha256> | wait"
exit 9
