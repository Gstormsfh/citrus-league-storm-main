"""Regression guard: serving batches must never refit the saved input design."""
from copy import deepcopy
import json

import numpy as np

from projections import portable_context_model as portable


def test_saved_design_and_predictions_ignore_batch_composition():
    design = {
        'schema': {'version': 'batch-proof', 'names': ['x'], 'categorical_names': ['zone']},
        'numeric_names': ['x'], 'categorical_names': ['zone'],
        'medians': {'x': 4.0}, 'vocabulary': {'zone': ['crease', 'deep']},
    }
    # Export an in-memory synthetic fixture only; never deserialize legacy models.
    from sklearn.ensemble import HistGradientBoostingClassifier
    from threadpoolctl import threadpool_limits
    training = [{'features': [float(i % 10)], 'categorical': {'zone': 'crease' if i % 2 else 'deep'}}
                for i in range(120)]
    with threadpool_limits(limits=1):
        fitted = HistGradientBoostingClassifier(max_iter=4, max_leaf_nodes=3,
            early_stopping=False, random_state=60906).fit(
                portable.design_rows(design, training), [i % 10 > 5 for i in range(120)])
    model = json.loads(json.dumps(portable.export_model(fitted, design), allow_nan=False))
    before = deepcopy(model)
    rows = [
        {'features': [None], 'categorical': {'zone': None}},
        {'features': [0.0], 'categorical': {'zone': 'unseen'}},
        {'features': [1e6], 'categorical': {'zone': 'crease'}},
        {'features': [-1e6], 'categorical': {'zone': 'deep'}},
    ]
    original_rows = deepcopy(rows)
    batch_design = portable.design_rows(model['design'], rows)
    batch_predictions = portable.predict_rows(model, rows)
    for index, row in enumerate(rows):
        np.testing.assert_array_equal(portable.design_rows(model['design'], [row])[0], batch_design[index])
        assert portable.predict_rows(model, [row])[0] == batch_predictions[index]
    order = [3, 1, 0, 2]
    np.testing.assert_array_equal(portable.predict_rows(model, [rows[i] for i in order]), batch_predictions[order])
    np.testing.assert_array_equal(portable.predict_rows(model, rows + rows), np.tile(batch_predictions, 2))
    assert model == before
    assert rows == original_rows
