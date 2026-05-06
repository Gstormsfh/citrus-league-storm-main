# `data-pipeline/data/historical/` — MoneyPuck multi-season training data

Large CSV exports from MoneyPuck.com used as training input for the Citrus
xG v3 model. Files here are **gitignored** (this directory holds ~500 MB of
data). Each developer who needs to retrain regenerates locally.

## Files (when populated)

| File | Source | Rows | Coverage |
|---|---|---|---|
| `shots_2017.csv` | https://peter-tanner.com/moneypuck/downloads/shots_2017.zip | 119,715 | NHL 2017-18 season |
| `shots_2018-2024.csv` | https://peter-tanner.com/moneypuck/downloads/shots_2018-2024.zip | 786,244 | NHL 2018-19 → 2024-25 (7 seasons) |

Combined: **905,959 shot rows across 8 NHL seasons**.

## How to populate

```bash
# From repo root:
mkdir -p data-pipeline/data/historical
curl -L -o /tmp/shots_2018-2024.zip https://peter-tanner.com/moneypuck/downloads/shots_2018-2024.zip
unzip -p /tmp/shots_2018-2024.zip > data-pipeline/data/historical/shots_2018-2024.csv

curl -L -o /tmp/shots_2017.zip https://peter-tanner.com/moneypuck/downloads/shots_2017.zip
unzip -p /tmp/shots_2017.zip > data-pipeline/data/historical/shots_2017.csv

# Verify row counts:
wc -l data-pipeline/data/historical/shots_*.csv
# Expected: 786,245 (shots_2018-2024) + 119,716 (shots_2017) — both include the CSV header
```

## How these are consumed

- `scripts/utilities/train_xg_v3.py` — primary xG model training entry point.
  Reads `shots_2018-2024.csv` for the 786K-row historical corpus and combines
  it with the current-season Citrus PbP shots from `data/shots_full_features_2025.csv`
  to produce the production `models/xg_model_moneypuck.joblib` (commit `d6be75d`,
  AUC 0.817).
- `data/TRAINING_DATA_MANIFEST.md` — workflow documentation.

## Why these are gitignored

- File sizes are 64 MB (`shots_2017.csv`) and 447 MB (`shots_2018-2024.csv`).
  Combined ~500 MB would bloat every clone.
- The training data is reproducible — anyone with internet access can
  re-download from peter-tanner.com.
- The trained model artifact in `data-pipeline/models/xg_model_moneypuck.joblib`
  is what's committed and what production reads. Training data is reproducible
  scaffolding, not the canonical artifact.

## Coverage caveat

The 7 Citrus pre-shot moat features (`pass_quality_score`, `pass_immediacy_score`,
`goalie_movement_score`, `pass_zone_encoded`, `pass_lateral_distance`,
`pass_to_net_distance`, `has_pass_before_shot`) **DO NOT EXIST** in the
MoneyPuck historical data. `train_xg_v3.py` substitutes 0 / "no_pass"
placeholders during training. For analyses that depend on the moat features,
the historical data is 2025-26 forward only. See
`apps/web/docs/HISTORICAL_DATA_LOCATION_HUNT.md` §Caveat for details.

## Backup

Original `.zip` files remain in `~/Downloads/` as natural backups until
the canonical location is proven stable across multiple training runs.
Cleanup of those zips happens in a later reorg phase (R6 or follow-up)
once R3 has been validated by real-world use.
