# Forward shooter: no-fit diagnostic specification

Declared 2026-09-06 22:00 UTC, after inspecting the completed forward-shooter
experiment and its aggregate scorecards. This is adaptive diagnostic analysis,
not a preregistered superiority test. It cannot accept or promote a model.

Use only saved predictions and validation identity records from
`official-forward-shooter-movement-20260906-retry1`, bound to health SHA-256
`829119131d856969b5278d1b14d1a711c19b4a5a404b6b932ee40cf29af9fe22`
and independent review health SHA-256
`93e9d10c339f3b53e683f992abfaa7d2d85b534fe8d834f6e74178e2b10b8b2d`.
Retain original input, fitted-model and prediction files unchanged.

For each event, evaluate Brier loss and log loss clipped at 1e-12. Define:

- Total: shooter minus frozen conditional.
- Map pipeline: new neutral minus frozen conditional.
- Global adjustment: global control minus new neutral.
- Shooter increment: shooter minus global control.

The three incremental loss differences must sum to the total. This is an exact
accounting identity, not causal attribution. The map-pipeline comparison changes
calibration training support and fitted parameters together. The shooter
increment compares complete fitted identity models, including their separately
estimated intercepts; it does not isolate a pure causal player effect.

Membership is identical between candidates: anchor probability bands to the
frozen conditional prediction, cross with validation calendar month and original
prior-SOG context. Use edges 0, .01, .025, .05, .1, .2, .35, .5, .75, 1, with
left-inclusive bands and the final upper bound included. Preserve null context
distinct from a string label. Include every observed sparse cell and roll up
each axis, as well as the full fold. Do not manufacture unobserved cells.

Use 256 shared whole-game multinomial bootstrap draws, seed 60906, separately
within each fold. Cell conditional means exclude and count draws with no cell
events; weighted contributions use the full resampled fold's event count,
including zero contributions. Report percentile 95% intervals. Sparse means
fewer than 100 events or 30 games; all intervals remain exploratory and
conditional on the fixed fitted models. Check component and cell conservation.

Before running, test exact identity joins, dates, labels, contexts, finite
probabilities, deterministic ordering, fixed anchor membership, sparse/unknown
retention and shared resampling. Freeze source before real execution. An
independent implementation checks saved point results and contribution sums;
it must distinguish those checks from independent bootstrap or refit validation.

No fitting, actor filtering, new split selection, probability correction,
download, external write or production change is allowed in this analysis.
Any later fitted proposal needs its own earlier-only design and new declaration.
