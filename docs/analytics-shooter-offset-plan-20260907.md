# Declared shooter-offset development experiment

Written before this experiment's outcomes are computed. No production changes.

Keep the verified recent-timing neutral probabilities fixed. Test one separate shooter-conditioned probability: logistic(logit(neutral probability) + player offset). Estimate each player's offset by penalized Bernoulli likelihood, with a fixed zero-centered Gaussian prior of standard deviation 0.25 in log-odds units (precision 16). This is a deliberately declared regularizer, not an empirically validated talent-population distribution. No parameter search, legacy probability cap, goals/xG multiplier or flurry discount.

Fit at each month boundary using only earlier dates within the same fold and game type. Use only original-cohort events for fitting; recovered events remain evaluation-only throughout. Keep player history across team changes but not across regular/playoff populations. Empty history gives exactly zero adjustment. Store exact training event keys, source baseline identity, cutoff, fit gradient and support. Reject train/test game overlap. All input probabilities were generated prequentially; historical source revisions still make this retrospective development, not a historical-as-of or untouched prospective test.

Evaluate the original, recovered and expanded cohorts, by month, game type and prior-support status. Compare Brier and log loss with the unchanged neutral reference on identical populations. Both original-fold losses must not worsen for the point guard; this alone cannot authorize acceptance. Preserve failed outcomes. No post-result tuning this run.

This is a predictive shooter-residual experiment, not proof of intrinsic or persistent talent: missing context, empty-net mix, goalie/opponent quality and remaining calibration issues can be absorbed into player offsets. TOI is not needed for conditional conversion on observed attempts, but appearance/TOI, opportunity forecasts, uncertainty coverage, multi-season stability and downstream apply-once validation remain required for daily forecasts, talent percentages and FPAR. Never substitute this output for neutral xG or reuse it as the denominator to estimate another finishing adjustment.

Public methodological reference: https://www.moneypuck.com/about.htm distinguishes neutral chance quality from shrinkage-based shooting talent. Its exact implementation and parameters are not disclosed there; this experiment is Citrus's own formulation, not an exact reproduction. No MoneyPuck files, observations or model artifacts are used.
