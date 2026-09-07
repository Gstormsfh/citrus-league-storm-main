"""Read the pinned local dictionary only; never load shot rows or fitted models."""
import argparse
import csv
import hashlib
import io
from datetime import datetime, timezone
from pathlib import Path

from archive_development_checkpoint import persist, safe

ROOT = Path(__file__).resolve().parents[2]
DICTIONARY = 'data/MoneyPuck_Shot_Data_Dictionary.CSV'
SHA = '77f2e46f77f252d9571f96bbb85230ecb77a795f806769319753b4d92b1c6d6c'
TARGETS = {'homeTeamWon', 'timeUntilNextEvent', 'event', 'goal',
    'shotPlayContinuedOutsideZone', 'shotPlayContinuedInZone', 'shotGoalieFroze',
    'shotPlayStopped', 'shotGeneratedRebound', 'shotWasOnGoal'}
OUTPUTS = {'xGoal', 'xFroze', 'xRebound', 'xPlayContinuedInZone',
    'xPlayContinuedOutsideZone', 'xPlayStopped', 'xShotWasOnGoal'}
METADATA = {'shotID', 'season', 'isPlayoffGame', 'game_id', 'id',
    'homeTeamCode', 'awayTeamCode', 'teamCode', 'playerNumThatDidEvent',
    'playerNumThatDidLastEvent', 'goalieIdForShot', 'goalieNameForShot',
    'shooterPlayerId', 'shooterName'}


def inspect(raw):
    if type(raw) is not bytes or hashlib.sha256(raw).hexdigest() != SHA:
        raise ValueError('Only the pinned explanatory dictionary may be inspected')
    rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
    if rows[0][:2] != ['Variable', 'Definition']:
        raise ValueError('Explanatory dictionary header required')
    names = [row[0].strip() for row in rows[1:] if row and row[0].strip()]
    if len(names) != len(set(names)) or not (TARGETS | OUTPUTS | METADATA) <= set(names):
        raise ValueError('Unique complete known dictionary field names required')
    context = set(names) - TARGETS - OUTPUTS - METADATA
    return {'contract': 'citrus-methodological-schema-inspection-v1',
        'source_path': DICTIONARY, 'source_sha256': SHA, 'source_bytes': len(raw),
        'unique_named_fields': len(names),
        'categories': {'outcome_or_future_not_pre_shot_inputs': sorted(TARGETS),
                       'external_fitted_outputs_not_citrus_training_inputs_or_targets': sorted(OUTPUTS),
                       'identifiers_and_inventory_not_automatically_predictors': sorted(METADATA),
                       'descriptive_context_requiring_independent_source_reconstruction': sorted(context)},
        'shift_context_field_names': sorted(n for n in context if 'TimeOnIce' in n
                                           or n in ('timeDifferenceSinceChange', 'averageRestDifference')),
        'shot_data_rows_read': 0, 'external_predictions_fitted': False,
        'model_artifacts_deserialized': 0, 'training_performed': False,
        'exact_external_model_reconstructed': False, 'commercial_rights_inferred': False,
        'source_availability_or_predictor_suitability_verified': False,
        'publishable': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    output = Path(parser.parse_args().output).absolute()
    if (output.parent != ROOT / 'scripts/proof/results'
            or not output.name.startswith('moneypuck-dictionary-inspection-')
            or any(p.is_symlink() for p in (output, *output.parents))):
        raise ValueError('New scoped nonsymlink output directory required')
    raw = safe(ROOT, DICTIONARY).read_bytes()
    result = inspect(raw)
    result['observed_at'] = datetime.now(timezone.utc).isoformat()
    result['code_sha256'] = {p: hashlib.sha256(safe(ROOT, p).read_bytes()).hexdigest()
        for p in ('scripts/proof/inspect_moneypuck_dictionary.py',
                  'scripts/proof/test_inspect_moneypuck_dictionary.py')}
    output.mkdir(exist_ok=False)
    persist(output, 'inspection.json', result)
    print(f"Read explanatory dictionary: {result['unique_named_fields']} field names; no shot rows or model loading.")


if __name__ == '__main__':
    main()
