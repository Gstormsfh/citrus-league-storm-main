# Prior-SOG fidelity and residual audit declaration

No fitting, prediction changes, feature selection or threshold optimization.
Use every original outer-validation event from the completed calibration transfer
run, health SHA `6cf9060710823e8a251518a6c5383cf56fc6b53ecaca89b6d6e45db536e4e44b`.
Preserve fixed and expanding predictions, labels and all prior source artifacts.

Reconstruct the immediate raw predecessor, without skipping non-shot or boundary
events. Independently classify the baseline prior-SOG state: same-period prior
type in {502,503,504,506,507,508,525}, both owners recognized; state one only for
same-team type 506, otherwise zero. All other cases remain null, with exclusive
reason precedence: no predecessor; other period; non-live predecessor type;
invalid current owner; invalid prior owner; observed same-team 506; other eligible
predecessor. Preserve simultaneous raw facts independently of this precedence.

The state has no elapsed-time cutoff. Fixed diagnostic gap bands are: no
same-period predecessor; zero; (0,1]; (1,3); [3,10]; greater than 10 seconds.
The three-second edge is explicitly separated; these are diagnostic strata,
not a new rebound definition. Geometry/side availability never changes the
baseline state. Current outcome/type and future events are not classifier inputs.

Verify the reconstructed state against the exact saved calibration context and
prior-SOG scorecard group, with all event identities and target/prediction joins
checked. Source body and receipt bytes must be in the retained verified closure;
validate raw ordering and preserve source hashes and immediate predecessor IDs.
This targeted check is not an independent reconstruction of every model feature.

After classification, account for counts, games, goals, expected goals, signed
calibration error, Brier and clipped log loss using the saved predictions. Fixed
strata: state, exclusive reason, gap band, and their joint intersection. Include
sparse and null cells; cell sums must conserve each entire fold. These are point
diagnostics, not new uncertainty estimates or causal attribution. No claims of
true historical availability, observed passes/possession or goalie tracking.

Sources and outputs are hash-bound, outputs create-only, failures retained.
No production mutation. A mismatch stops analysis rather than silently repairing
or dropping events. Completion does not close finishing, FPAR or acceptance gates.
