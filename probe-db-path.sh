#!/usr/bin/env bash
# Citrus - draft engine network path probe. Read-only. Changes nothing.
echo "===== 1. what the VM resolves ====="
for h in db.iezwazccqqrhrjupxzvf.supabase.co \
         aws-0-ca-central-1.pooler.supabase.com \
         aws-1-ca-central-1.pooler.supabase.com; do
  printf '%-46s ' "$h"
  getent ahosts "$h" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' '
  echo
done

echo
echo "===== 2. TCP from the VM host ====="
probe() {
  local host="$1" port="$2" label="$3"
  local out
  out=$(timeout 8 bash -c "exec 3<>/dev/tcp/${host}/${port}" 2>&1)
  local rc=$?
  if [ $rc -eq 0 ]; then
    echo "OK       ${label}"
  elif [ $rc -eq 124 ]; then
    echo "TIMEOUT  ${label}   (packets dropped - firewall/route)"
  else
    echo "REFUSED  ${label}   ${out##*: }"
  fi
}
probe google.com 443 "google.com:443            (control - egress works?)"
probe db.iezwazccqqrhrjupxzvf.supabase.co 5432 "prod DIRECT:5432"
probe aws-0-ca-central-1.pooler.supabase.com 5432 "pooler aws-0 :5432 (session)"
probe aws-1-ca-central-1.pooler.supabase.com 5432 "pooler aws-1 :5432 (session)"
probe aws-0-ca-central-1.pooler.supabase.com 6543 "pooler aws-0 :6543 (txn - do not use)"

echo
echo "===== 3. the engine container ====="
C=$(sudo docker ps --format '{{.Names}} {{.Image}}' | grep -i draft-engine | head -1 | cut -d' ' -f1)
[ -z "$C" ] && C=$(sudo docker ps --format '{{.Names}}' | head -1)
echo "container   : ${C:-NONE RUNNING}"
if [ -n "$C" ]; then
  echo "network mode: $(sudo docker inspect -f '{{.HostConfig.NetworkMode}}' "$C" 2>/dev/null)"
  echo "image       : $(sudo docker inspect -f '{{.Config.Image}}' "$C" 2>/dev/null)"
  echo "db host cfg : $(sudo docker exec "$C" printenv SUPABASE_DB_URL 2>/dev/null | sed -E 's#(://[^:]+):[^@]+@#\1:PASSWORD@#')"
  echo
  echo "----- last subscription log lines -----"
  sudo docker logs --since 30m "$C" 2>&1 \
    | grep -E 'event_subscription|deployment.fingerprint' | tail -12
fi

echo
echo "===== 4. host-side outbound identity ====="
echo "egress IP   : $(timeout 8 curl -s -m 6 https://api.ipify.org 2>/dev/null)"
echo "done."
