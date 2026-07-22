# Training Data Manifest

Files required for xG v3 model training. Large files are `.gitignore`d and stored locally.
Only the trained model binary (~2.5 MB) gets committed to Git.

Per the R3 reorg (2026-05-05) the MoneyPuck historical data lives at
`data-pipeline/data/historical/` (gitignored). Current-season Citrus PbP
exports continue to live at `data/` (the smaller files there are tracked).

## Required Files

| File | Size | Rows | Source | How to Obtain |
|------|------|------|--------|---------------|
| `data-pipeline/data/historical/shots_2018-2024.csv` | ~447 MB | 786,244 | MoneyPuck 2018-2024 | `curl -L -o /tmp/shots_2018-2024.zip https://peter-tanner.com/moneypuck/downloads/shots_2018-2024.zip && unzip -p /tmp/shots_2018-2024.zip > data-pipeline/data/historical/shots_2018-2024.csv` |
| `data-pipeline/data/historical/shots_2017.csv` (optional, 8th season for extended training) | ~64 MB | 119,715 | MoneyPuck 2017 | `curl -L -o /tmp/shots_2017.zip https://peter-tanner.com/moneypuck/downloads/shots_2017.zip && unzip -p /tmp/shots_2017.zip > data-pipeline/data/historical/shots_2017.csv` |
| `data/shots_full_features_2025.csv` | ~25 MB | 76,877+ | Our PBP pipeline | `python scripts/utilities/export_raw_shots_csv.py --training` |

## Complete Retrain Workflow

```bash
# Step 1: Export latest shots from Supabase (picks up newly scraped games)
python scripts/utilities/export_raw_shots_csv.py --training

# Step 2: Train v3 model (~2 min on 863K+ shots)
python scripts/utilities/train_xg_v3.py

# Step 3: Commit the updated model (only ~2.5 MB)
git add models/xg_model_moneypuck.joblib models/model_features_moneypuck.joblib
git add models/shot_type_encoder.joblib models/last_event_category_encoder.joblib models/pass_zone_encoder.joblib
git commit -m "Retrain xG v3 with updated shot data"
```

## How It Works

```
NHL Games Scraped (data_acquisition.py)
        |
        v
Supabase raw_shots table (grows with each game)
        |
        v
export_raw_shots_csv.py --training
        |
        v
data/shots_full_features_2025.csv (our PBP shots)
    +
data-pipeline/data/historical/shots_2018-2024.csv (MoneyPuck historical)
    +
data-pipeline/data/historical/shots_2017.csv (optional 8th-season extension)
        |
        v
train_xg_v3.py (combines 863K+ shots, trains XGBoost)
        |
        v
models/xg_model_moneypuck.joblib (production model)
```

## Adding New Season Data

When new seasons become available from MoneyPuck:
1. Download from https://peter-tanner.com/moneypuck/downloads/
2. Concatenate with existing data or replace `shots_2018-2024.csv`
3. Re-run training pipeline

Our PBP shots grow automatically as games are scraped. Run the export + retrain
workflow periodically (e.g., monthly) to keep the model fresh.

## Data Dictionary

See https://peter-tanner.com/moneypuck/downloads/MoneyPuck_Shot_Data_Dictionary.csv
for the full MoneyPuck column reference.
