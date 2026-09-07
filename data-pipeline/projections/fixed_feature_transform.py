"""Non-serving JSON transform fitted only on explicitly supplied training rows.

Caller owns chronological selection. None means missing; absent columns fail.
All-missing numeric training columns fail rather than fabricate a median.
Output order: numeric values, numeric missing indicators, categorical integer
codes. Categorical codes 0/1 mean missing/unseen; known strings start at 2.
This contract is not compatible with legacy models by implication.
"""
import math

VERSION = 'citrus-fixed-feature-transform-v1'


def _names(value):
    if not isinstance(value, list) or any(not isinstance(x, str) or not x for x in value):
        raise ValueError('Feature names must be nonempty strings in an ordered list')
    if len(set(value)) != len(value):
        raise ValueError('Duplicate feature names')
    return value


def _number(value):
    if type(value) not in (int, float):
        raise ValueError('Expected finite numeric value, not Boolean or string')
    try:
        valid = math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise ValueError('Expected finite numeric value')


def _row(row, numeric, categorical):
    if not isinstance(row, dict) or set(row) != set(numeric + categorical):
        raise ValueError('Row columns must exactly match the declared schema')
    for name in numeric:
        if row[name] is not None:
            _number(row[name])
    for name in categorical:
        if row[name] is not None and not isinstance(row[name], str):
            raise ValueError('Category must be a string or None')


def validate(contract):
    """Validate a JSON-loaded contract; reject incomplete or extra schema fields."""
    keys = {'version', 'numeric', 'categorical', 'medians', 'vocabularies', 'output_width'}
    if not isinstance(contract, dict) or set(contract) != keys or contract['version'] != VERSION:
        raise ValueError('Invalid transform contract')
    numeric, categorical = _names(contract['numeric']), _names(contract['categorical'])
    _names(numeric + categorical)
    if not numeric and not categorical:
        raise ValueError('At least one feature required')
    if not isinstance(contract['medians'], list) or len(contract['medians']) != len(numeric):
        raise ValueError('Invalid median width')
    for median in contract['medians']:
        _number(median)
    vocabs = contract['vocabularies']
    if not isinstance(vocabs, list) or len(vocabs) != len(categorical):
        raise ValueError('Invalid vocabulary width')
    for vocab in vocabs:
        if not isinstance(vocab, list) or any(not isinstance(x, str) for x in vocab):
            raise ValueError('Invalid vocabulary')
        if vocab != sorted(set(vocab)):
            raise ValueError('Vocabulary must be unique and sorted')
    if type(contract['output_width']) is not int or contract['output_width'] != 2 * len(numeric) + len(categorical):
        raise ValueError('Invalid output width')
    return contract


def fit(training_rows, *, numeric, categorical):
    """Fit only supplied rows; never infer feature names or refit at transform."""
    numeric, categorical = list(_names(numeric)), list(_names(categorical))
    _names(numeric + categorical)
    if not isinstance(training_rows, list) or not training_rows:
        raise ValueError('Nonempty training row list required')
    for row in training_rows:
        _row(row, numeric, categorical)
    medians = []
    for name in numeric:
        observed = [row[name] for row in training_rows if row[name] is not None]
        if not observed:
            raise ValueError('All-missing numeric training column: ' + name)
        ordered = sorted(observed)
        mid = len(ordered) // 2
        if len(ordered) % 2:
            medians.append(ordered[mid])
        else:
            low, high = ordered[mid - 1], ordered[mid]
            # Same-sign subtraction avoids overflow and preserves equal subnormals.
            medians.append(low + (high - low) / 2 if (low >= 0) == (high >= 0)
                           else low / 2 + high / 2)
    return validate({'version': VERSION, 'numeric': numeric, 'categorical': categorical,
                     'medians': medians,
                     'vocabularies': [sorted({row[name] for row in training_rows if row[name] is not None})
                                      for name in categorical],
                     'output_width': 2 * len(numeric) + len(categorical)})


def transform(contract, rows):
    """Return JSON-compatible vectors without modifying contract or rows."""
    validate(contract)
    if not isinstance(rows, list):
        raise ValueError('Rows must be a list')
    numeric, categorical = contract['numeric'], contract['categorical']
    mappings = [{name: index + 2 for index, name in enumerate(vocab)}
                for vocab in contract['vocabularies']]
    output = []
    for row in rows:
        _row(row, numeric, categorical)
        values = [median if row[name] is None else row[name]
                  for name, median in zip(numeric, contract['medians'])]
        values += [int(row[name] is None) for name in numeric]
        values += [0 if row[name] is None else mapping.get(row[name], 1)
                   for name, mapping in zip(categorical, mappings)]
        output.append(values)
    return output
