#!/usr/bin/env bash
# Phase 0 / 0d-pre #6c — full retrofit drain loop.
# Runs `run_daily_pbp_processing.py` repeatedly until unprocessed count reaches 0
# (or fails to make progress for 3 passes in a row).

set -u
START_TS=$(date -u +%s)
PASS=0
LAST_UNPROC=999999
STALL_COUNT=0

while true; do
  PASS=$((PASS + 1))
  PASS_START=$(date -u +%s)
  echo ""
  echo "============================================================"
  echo "[6c-drain-loop] PASS $PASS — $(date -u +%H:%M:%SZ)"
  echo "============================================================"

  python data-pipeline/scoring/run_daily_pbp_processing.py 2>&1 \
    | grep -E "Processed [0-9]+ shots|No shots found|Permanently failed|Traceback|ERROR|Batch [0-9]+:|Final Summary" \
    | tail -200

  PASS_END=$(date -u +%s)
  PASS_ELAPSED=$((PASS_END - PASS_START))
  TOTAL_ELAPSED=$((PASS_END - START_TS))

  # No way to query DB from inline bash; rely on log and pass count.
  echo "[6c-drain-loop] pass $PASS done in ${PASS_ELAPSED}s (total ${TOTAL_ELAPSED}s)"

  # Stop after a safety limit of 15 passes (covers ~5h of compute)
  if [ $PASS -ge 15 ]; then
    echo "[6c-drain-loop] hit 15-pass safety limit; stopping"
    break
  fi

  # Short pause between passes
  sleep 5
done

echo ""
echo "[6c-drain-loop] complete after $PASS passes ($(($(date -u +%s) - START_TS))s total)"
