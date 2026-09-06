# Nullable season xG — narrow consumer correction

The dashboard index previously converted absent season xG into zero. Draft-kit
finishing then subtracted that manufactured zero from actual goals. The player
card separately rejected every zero, including a genuine recorded zero.

The shared index contract now allows null. Its service accepts finite nonnegative
numbers and decimal numeric strings, rejecting absent, blank, Boolean, hexadecimal,
negative and nonfinite values. A supplied numeric zero remains zero; official
goals, points and all other actuals are unchanged. This is input normalization,
not proof that a recorded value covers every eligible shot or has valid model lineage.

Both draft-kit and player-card finishing require present valid xG, finite goals,
and finite positive appearances. Their percentile populations use their same
value guard. The browse adapter maps unavailable xG to its existing optional
field. The dashboard discrepancy note compares only two available finite totals;
it no longer fabricates a difference against missing data.

No table, query, season filter, RLS policy, entitlement, background job or writer
was changed. No additional database requests were added; existing cached reads
and percentile passes remain. This is not a draft-night load benchmark.

Regression coverage includes malformed transport values, absent rows, cache
reads, retained actuals, missing versus genuine-zero card/pool/browse behavior,
appearance guards, and the actual rendered dashboard discrepancy note.

Root verification: web 4,484 tests; server 1,849 passed and six skipped; shared
244 passed. Web/server/shared type checks pass. The initial web suite correctly
caught an older card fixture using zero for absence; it now separately tests
null absence and the retained-zero rendered band. No production data was used
by these service/component tests.

Remaining limits: the history merge and separate legacy player/matchup pathways
still require their own source-completeness and nullability reviews. A valid
numeric stored xG value is not necessarily an accepted model or complete source
population. These changes do not promote the new development model to serving.
