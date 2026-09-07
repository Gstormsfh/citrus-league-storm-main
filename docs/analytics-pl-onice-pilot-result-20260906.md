# Retained official on-ice membership pilot

The separate parser recovered recorded membership from existing official PL
HTML columns that the original feature parser left unread. The original parser,
raw reports, PBP bodies and fitted model inputs are unchanged.

Create-only evidence: `scripts/proof/results/pl-onice-pilot-20260906-retained45/`.
The deterministic pilot covers 45 successfully captured report/PBP pairs from
the retained historical inventory, not the full development model population.

- 14,667 report rows and 3,967 PBP shot events retained.
- 3,941 shots uniquely matched in both directions; both teams' recorded
  memberships resolve for every matched shot.
- 26 unmatched or ambiguous shots retained, not dropped or greedily assigned.
- 37 author/independent parser tests passed before final verification.

The parser preserves raw cell HTML, sweater/position/title annotations, exact
report and PBP event identities, resolved player IDs and withheld reasons.
Independent review exposed and corrected ambiguous roster mappings, misplaced
nested positions and malformed identity handling before the successful pilot.

This establishes a bounded delivery path for **retrospective recorded on-ice
annotations**. It does not establish continuous shift intervals, goalie/player
coordinates, pre-shot temporal validity, full historical availability or better
predictions. `prediction_eligible` and `publishable` remain false. The pilot
does not expand or change the frozen movement/zone/calibration experiments.

Next gates are broader report coverage, independently checked event-time
semantics, interval-source reconciliation and a separately declared chronological
experiment only after causal eligibility is established. Empty/unavailable
reports and ambiguous identities must remain visible throughout.
