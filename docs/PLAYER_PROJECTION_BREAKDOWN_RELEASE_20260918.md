# Player-card projection breakdown

The game-log forecast now shows the published season/remaining-season total in
orange, followed by each league category's raw count, weight and fantasy-point
contribution. Upcoming games have expandable breakdowns instead of a table that
omitted blocks, short-handed points and penalty minutes on phones.

This is a presentation/scoring integration, not a numerical model release.
Existing roster, affiliation, eligibility, provenance and editorial components
are preserved. The shared scorer owns league totals. Zero, negative and missing
values remain distinct. Goalie workload is applied by the existing scorer once,
not multiplied again in the card. Category leagues show counts, not made-up
fantasy points. A flat allocation is labelled as such until contextual forecasts
are published. Calendar-adjusted goalie volume is not a confirmed starting job.

Verified locally:

- 5,209 web tests across 409 files, including 378 focused player-card tests.
- TypeScript check.
- Browser inspection at 320px, 390px and 1200px. No horizontal overflow or
  clipped stat labels at the two phone widths. Synthetic layout data was used;
  these screenshots are not evidence of newly published numerical forecasts.
- Browser screenshots retained privately in
  `/tmp/citrus-player-projection-evidence/`.

Legacy `upcomingRows` remains for compatibility tests and other potential
consumers. The player modal no longer uses its abbreviated projection columns.
Do not remove that definition until an independent reference audit confirms it
has no remaining consumer.
