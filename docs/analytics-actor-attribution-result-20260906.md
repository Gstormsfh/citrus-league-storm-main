# Source-replayed player/goalie attribution checkpoint

Status: complete local diagnostic and independent ledger review. Model quality,
foundation, serving, official actuals, TOI and FPAR remain **not accepted**.
Production and hosted databases are unchanged.

## End-to-end result

The new run starts from original frozen NHL body/receipt bytes, passes the
unchanged source gates and development feature projector, reproduces the exact
original validation membership/source/feature digests, and executes the pinned
JSON raw model plus saved context-aware monotone calibration map. It then joins
the resulting probabilities to raw event actors and that game's roster.
No fitting, unknown legacy deserialization or MoneyPuck data/model input occurs.

Both folds reproduce **every raw and calibrated probability exactly** (observed
maximum absolute difference zero; predeclared tolerance 1e-12). The comparison
also requires exact labels, contexts, event identities and all three cohort
digests. Original models, probabilities, source captures and future reservations
remain unchanged. This is inspected retrospective development, not historical
as-of or untouched validation.

| Accounting scope | Fold 1 | Fold 2 |
|---|---:|---:|
| Selected games | 1,378 | 1,383 |
| Eligible model events / attributed shooter events | 120,080 | 121,033 |
| Attributed defending-goalie events | 119,250 | 120,159 |
| Verified empty-net events, not assigned to a goalie | 774 | 827 |
| Events with goalie state unresolved by the current decoder | 56 | 47 |
| Actor rows, separated by season/type/role/player | 1,609 | 1,569 |
| Available / withheld actor rows | 1,544 / 65 | 1,515 / 54 |
| Actor rows with multiple team stints | 105 | 77 |
| Events with a goalie acting as shooter | 10 | 10 |

Actor-row counts are scoped records, **not unique people or official appearances**.
Goalies who shoot remain in the shooter population. Goalies can have both shooter
and defending-goalie records; regular and playoff records are separate. Team
stints sum into one scoped actor record without replacing historical teams with
the player's current team.

For unresolved attribution, complete totals stay NULL and all known contributions
remain explicitly labeled subtotals. An unresolved defending actor conservatively
withholds applicable roster-listed goalies for that game, including a backup when
the evidence does not establish who faced the attempt. Empty nets are explicitly
not applicable, never a pseudo-goalie or the previously recorded goalie.

Exposure here means **eligible unblocked event count**, including misses. Roster
listing is not proof of an appearance or time on ice. Appearance counts, TOI and
xG/60 remain NULL; no official `nhl_*` actual or fantasy score is changed.
The public methodological distinction between unblocked-attempt xG against and
ice-time-based rates informed this separation; no external values were used.
[MoneyPuck methodological glossary](https://www.moneypuck.com/glossary.htm)

## Independent review and calibration limits

The separate reviewer checks raw event hashes, actor IDs, game-roster teams,
goalie position/state, original source age, exact aggregate population, every
actor/team-stint subtotal and all unavailable totals. It reconstructs the ledger
without calling the attribution implementation and rehashes **15,626 bound files**.
Game traversal reversal also leaves the primary aggregate identical.

Partitioning the saved model's aggregate goal bias clarifies what attribution
does—and does not—fix:

| Diagnostic partition | Fold 1 xG / observed goals | Fold 2 xG / observed goals |
|---|---:|---:|
| Attributed defending-goalie events | 8,637.13 / 8,175 | 8,035.59 / 7,988 |
| Verified empty net | 471.19 / 456 | 470.96 / 473 |
| Unresolved special goalie state | 11.88 / 17 | 10.33 / 17 |

These are eligible-event accounting diagnostics, not official goalie GSAx,
persistent talent estimates or evidence of superiority. The first fold still
substantially overpredicts goals on goalie-attributed events. Correct actor
accounting does not solve the earlier calibration bias or subgroup regressions.
No new parameter search was performed on these inspected outcomes.

## Specific special-state finding, preserved without reassignment

All 103 unresolved events have raw situation code `1010` (67) or `0101` (36),
outside the existing ordinary-strength decoder. They are **not simply missing
goalie IDs**. The supplementary source-context inspection retains every raw
event, same-clock predecessor, actor field and byte/hash reference:

- 82 have one same-clock `PS` penalty marker with the same drawn player.
- 16 have the marker but no drawn-player field.
- Two have the marker with a different drawn player. That difference alone is
  not proof of an invalid penalty shot; substitution/award semantics need review.
- Three have no same-clock `PS` marker. All three occur at 05:00 of regular-season
  overtime: game/event 2022020349/723, 2022020399/748 and 2022021270/785.

A primary NHL report confirms the first inspected case as Kerfoot's penalty
shot at 17:20 of period two.
[NHL game summary](https://www.nhl.com/scores/htmlreports/20222023/GS020007.HTM)

That spot check does not adjudicate every event. Attempts to open the three
unpaired games' NHL summary pages through web retrieval did not return usable
content; no replacement from MoneyPuck's mirrored files was used. Their special
code alone must not authorize reassignment or a silent feature repair.

The v1 model/features/attribution remain frozen, including all 103 unavailable
goalie-state events. The supplementary inspection is explicitly review-only.
A future version must separately handle supported penalty-shot semantics and
independently adjudicate the three unpaired overtime cases, preserving originals.

## Tests, evidence and next steps

Full offline Python: **1,784 passed**, 16 network tests deselected, 33 existing
datetime warnings. This includes 42 new actor tests. Standalone inference/review
tests: 48 passed (21 inference boundaries and 27 independent-review cases).
Ten special-state context tests pass. There were no failed real attribution
attempts in this lane. Earlier failed publication attempts remain untouched.

All **56** separately indexed prior artifact/result/archive pins still match,
including all original prospective reservations and the 17 legacy artifact files.
Those files were hashed, not deserialized. The complete source-model-actor result,
independent review and special-state context are pinned in the
[machine index](analytics-actor-attribution-result-index-20260906.json).

Next: a separately versioned penalty-shot/special-state contract, independent
adjudication of the unpaired cases, and an exact appearance/TOI join before rates.
Then complete the remaining nightly writer/dependency path, including the native
v5 lane that still has no eligible rows. Keep calibration-quality confirmation,
prospective evidence and validated physical forecasts as distinct gates.
FPAR must not consume these diagnostic subtotals as accepted projections.
