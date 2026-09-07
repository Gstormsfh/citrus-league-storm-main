# Single bounded-influence timing prior comparison

Declare before fitting. The completed recent candidate stays the control.
Only replace its scalar offset penalty: from 5*delta² to
2*log(cosh(delta/2)), up to an irrelevant constant. The new penalty is convex,
identity-centred and has derivative 2*sigmoid(delta)-1, bounded between -1 and 1.
This reduces persistent shrinkage pressure on large, evidence-supported offsets;
it does not imply superiority or a known physical timing mechanism.

All four timing bands use the same penalty. Preserve the 90-day earlier-only
original-population window, 30-event/10-game support rules, monthly updates,
first-month fallback, raw model and existing baseline calibrator. Recovered games
are evaluation-only. No alternative penalty/window/support values are swept.
Solve the convex one-dimensional derivative on [-10,10] using 80 bisections;
fail if the root is not bracketed. Keep probability clipping at 1e-6.

Compare baseline, ridge recent and bounded-prior candidate separately on original,
recovered and expanded populations, monthly and by timing band. Primary point
guard: no worsening of either original-fold Brier or log loss versus ridge recent.
Retain all subgroup regressions and negative results. This adaptively motivated
historical development comparison is not model, prospective or production acceptance.
