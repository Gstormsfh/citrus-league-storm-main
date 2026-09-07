"""Package and replay frozen full-feature candidates; no fitting or publishing."""
import argparse
import hashlib
from pathlib import Path
from projections.xg_candidate_inference import XGCandidate, VERSION
from projections.calibration_candidate import context_from_row
from run_calibration_transfer import ROOT, encode, reuse, pin_run, fingerprint, file_sha

SOURCE = 'scripts/proof/results/official-timing-ridge10-20260906-full'
SHA = '12eb666e35ab63c3c3f58206d81f8332794c904c5594e92a1fcf7ed69afa1a82'
RAW = 'scripts/proof/results/official-calibration-transfer-20260906-full'
RAW_SHA = '6cf9060710823e8a251518a6c5383cf56fc6b53ecaca89b6d6e45db536e4e44b'


def keyed(rows):
    result = {(r['game_id'],r['event_id']):r for r in rows}
    if len(result) != len(rows): raise ValueError('Duplicate event')
    return result


def run(output):
    output = Path(output).absolute()
    if output.parent != ROOT/'scripts/proof/results' or any(p.is_symlink() for p in (output,*output.parents)):
        raise ValueError('Scoped create-only result required')
    output.mkdir(exist_ok=False); files = {}; closure = reuse.Closure(ROOT)
    def save(name,value):
        raw = encode(value); p = output/name; p.parent.mkdir(parents=True,exist_ok=True)
        with p.open('xb') as stream: stream.write(raw)
        files[name] = hashlib.sha256(raw).hexdigest()
        return p,files[name]
    for name in ('scripts/proof/run_composed_xg_replay.py','data-pipeline/projections/xg_candidate_inference.py','scripts/proof/test_composed_xg.py'):
        closure.pin(name,file_sha(ROOT/name))
    pin_run(closure,SOURCE,SHA,'complete-timing-ridge10-development-not-accepted')
    closure.mapping(closure.read(SOURCE+'/consumed-file-sha256.json'))
    pin_run(closure,RAW,RAW_SHA,'complete-calibration-transfer-development-not-accepted')
    print('Certified source closure checked; loading full movement vectors',flush=True)
    features = reuse.load(ROOT); summaries = {}; manifest = []
    for fold in ('fold1','fold2'):
        rows = features.folds[fold]['validation']['rows']; indexed = keyed(rows)
        expected = keyed(closure.read(f'{SOURCE}/{fold}/predictions.json'))
        source = keyed(closure.read(f'{RAW}/{fold}/source-validation.json'))
        if set(indexed) != set(expected) or set(indexed) != set(source): raise ValueError('Full cohort membership required')
        raw_model = closure.read(f'{RAW}/{fold}/model.json'); seen = set(); raw_error = final_error = 0.; outputs = []
        for month in sorted({r['game_date'][:7] for r in rows}):
            prefix = f'{SOURCE}/{fold}/{month}'
            block = closure.read(prefix+'/fit-receipt.json')['block']
            inputs = closure.read(prefix+'/test-inputs.json'); input_keys = list(keyed(inputs))
            actual_keys = {k for k,r in indexed.items() if r['game_date'][:7] == month}
            if set(input_keys) != actual_keys or seen & actual_keys: raise ValueError('Exact monthly coverage required')
            batch = [indexed[k] for k in input_keys]
            bundle = {'contract':VERSION,'publishable':False,'usage':'offline_replay_only',
                'raw_model':raw_model,'calibrator':closure.read(prefix+'/map.json'),
                'schema_sha256':fingerprint(features.schema),'train_through':block['train']['end'],
                'valid_from':block['test']['start'],'valid_to':block['test']['end'],'source_health_sha256':SHA}
            path,digest = save(f'{fold}/{month}/bundle.json',bundle)
            candidate = XGCandidate.load(path,digest); predicted = candidate.predict(batch)
            gap_index = features.schema['names'].index('seconds_since_immediate_event')
            for row,old,result in zip(batch,inputs,predicted):
                k = row['game_id'],row['event_id']; context = context_from_row(row,features.schema)
                if context != old['context'] or context != source[k]['context']: raise ValueError('Context parity failure')
                if context['prior_sog_same_team'] == '1' and row['features'][gap_index] != old['gap_seconds']:
                    raise ValueError('Applied timing gap parity failure')
                if int(row['label']) != expected[k]['target'] or int(row['label']) != source[k]['target']: raise ValueError('Target join failure')
                raw_error = max(raw_error,abs(result['raw_xg']-source[k]['raw_probability']))
                final_error = max(final_error,abs(result['neutral_xg']-expected[k]['predictions']['timing']))
            seen.update(actual_keys); outputs.extend(predicted)
            manifest.append({'fold':fold,'month':month,'bundle':str(path.relative_to(output)),'sha256':digest,'events':len(batch)})
            print(f'{fold} {month}: {len(batch)} full-vector predictions replayed',flush=True)
        if seen != set(indexed) or raw_error > 1e-12 or final_error > 1e-12: raise ValueError('End-to-end parity failed')
        save(f'{fold}/predictions.json',outputs)
        summaries[fold] = {'events':len(outputs),'numeric_inputs':len(features.schema['names']),
            'categorical_inputs':len(features.schema['categorical_names']),'max_raw_error':raw_error,'max_calibrated_error':final_error}
    features.verify(); closure.verify()
    save('consumed-file-sha256.json',{**features.closure.checked,**closure.checked})
    save('manifest.json',{'usage':'offline_replay_only','publishable':False,'bundles':manifest})
    save('summary.json',{'folds':summaries,'publishable':False,'production_changed':False,
        'scope':'Certified saved full movement vectors through composed inference; not fresh raw-event reconstruction or prospective validation.'})
    save('health.json',{'status':'complete-composed-xg-retrospective-replay','publishable':False,'files':dict(files)})
    print(summaries,flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output',required=True)
    run(parser.parse_args().output)
