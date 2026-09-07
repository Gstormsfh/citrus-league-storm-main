# Offline finishing quantity contract

Implemented `scripts/proof/finishing_quantity_contract.py` and its synthetic
tests. This is a structural research contract, not a fitted estimator, verified
source receipt, empirical acceptance gate or deployed forecast change.

It separates observed shooting percentage, goals/neutral-xG, percentage above
expected and goals-minus-xG. None automatically becomes estimated talent.
Zero denominators remain unavailable. The SOG exposure and xG-attempt exposure
are explicit: unblocked-attempt xG may include missed shots, whereas shooting
percentage uses SOG. Player, game-type population and neutral-baseline identity
must match when composing forecast and talent evidence.

The composition helper only accepts a neutral **goal-count expectation** and
an explicitly typed estimated **goal-count rate multiplier**. It rejects shot
probabilities, flurry credits, odds ratios and observed G/xG ratios presented
under their own incompatible quantity labels. It records the applied talent
artifact and rejects a second application. A count expectation may exceed one;
there is no imported shot-probability cap.

Both baseline and talent evidence timestamps must precede prediction. These
are caller declarations, not proof that the source was historically available,
that model fitting excluded future outcomes, or that hashes identify a genuine
neutral baseline. Those require independently checked source/artifact receipts.
The output remains nonpublishable.

An important limit: exactly-once bookkeeping prevents mechanical duplication,
not statistical double counting. A forecast based on empirical goal rates may
already contain finishing skill despite a neutral label. Consumer lineage and
the forecast's actual construction must be validated before admission. Likewise,
the identity model's additive log-odds effects cannot be reinterpreted as these
count-rate multipliers.

Verification: 27 focused tests passed, covering quantity confusion, mixed
identities/populations/baselines, same-time/future evidence, double application,
publication rejection, nonfinite inputs, overflow and missing denominators.
Receipt: `scripts/proof/results/finishing-quantity-contract-20260906-tests.xml`.
No predictive improvement is claimed. Original logic/artifacts are unchanged.

Next integration gate: bind actual earlier-only neutral baseline and talent
artifacts to this contract; demonstrate that base goal forecasts contain no
previous finishing effect; then test chronology, goal forecast calibration and
uncertainty coverage. Do not silently normalize the old uncertainty samples or
admit finishing based on the penalty model's tests.
