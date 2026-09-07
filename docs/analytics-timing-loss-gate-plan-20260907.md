# Single prequential timing loss-gate comparison

Declared before running this comparison. Preserve the completed recent-timing
experiment as an unchanged shadow candidate and the ridge-10 model as baseline.
No new fitted coefficient, time window or penalty search.

For each fold/month/band, inspect only ORIGINAL-population shadow predictions
from the preceding 90 calendar days, strictly before the current month. Activate
the shadow adjustment only if at least 30 events and 10 games support the band
and both Brier and clipped log loss are strictly lower than baseline on those
earlier predictions. Otherwise use baseline exactly. Apply this rule equally to
all four bands. Recovered outcomes never choose the gate. Early ties remain off.
Stored shadow predictions were themselves made using strictly earlier games.

Report baseline, ungated recent and gated losses separately for original,
recovered and expanded populations; retain monthly and band regressions. Guard:
both original-fold losses must not worsen relative to baseline; additionally
report whether either original-fold loss worsens relative to ungated recent.
Even passing both comparisons is not prospective/model/production acceptance.
This is one adaptively motivated experiment, not proof against selection bias.
