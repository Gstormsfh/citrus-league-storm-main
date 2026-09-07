# Passing-method reproduction: source distinction and implemented geometry

## Direct precedent using our existing source

[NHL Fantasy Data's passing-angle research](https://nhlfantasydata.com/research/passing-angles.html) uses NHL goal-replay sprites. It measures the change between net-to-release and net-to-reception bearings, allowing the endpoints to have different depths. It also examines quick receptions preceding goals. The author explicitly calls the analysis descriptive because the data is limited to goal sequences and does not establish effectiveness without non-goal passes.

This supports pursuing replay-derived passing insights with our existing source. It does not establish a hidden full-game pass feed, validated contact detection for Citrus, or predictive xG improvement. We inspected the public explanation, not its player tables or downloadable datasets.

## Predictive passing example uses a different underlying dataset

[Dan Morse's Expected Primary Assists project](https://github.com/danmorse314/Expected-Primary-Assists) uses Stathletes Big Data Cup OHL event data with explicit passing information. It incorporates pass distance, receiver movement and one-timer context into shot modeling. This demonstrates a practical modeling approach when such inputs are available, but does not make that data available in the ordinary NHL PBP. Its reported evaluation is not a like-for-like benchmark against Citrus. No external dataset or code was imported.

## Implemented in Citrus

`data-pipeline/projections/passing_sequence_geometry.py` independently implements standard endpoint geometry for externally identified pass release, reception, shot and net locations:

- Continuous lateral and longitudinal displacement and endpoint distance.
- Exact net-centred bearing change from release to reception, reception to shot, and release to shot, using cross/dot products.
- Receiver endpoint movement after reception.
- Separate continuous pass-flight and reception-to-shot durations; they must not be conflated.
- Endpoint speed and bearing rate only for positive flight time. A point at the net has undefined bearing, represented as missing.

Coordinates and units must be supplied explicitly. The function does not infer feet from renderer units, infer shot timing from the clip end, assign probability weights, or claim actual goalie movement. It does not validate the pass itself. Production eligibility is false.

Eight geometry tests pass, including unequal endpoint depth, distance-dependent angle, continuous delay, missing-rate handling and invalid inputs. Combined with five co-motion tests, the run passes thirteen tests. These are software/geometry tests, not pass-classifier accuracy results.

## Next gate

The geometry layer is ready for independently reviewed endpoints, but the current co-motion endpoints remain candidates. Frame-level pass and shot-release annotations must be validated before applying these measurements as actual pre-shot passing. Retrospective sequence analysis can proceed on reviewed goal clips; predictive xG still needs representative non-goal coverage and a controlled model comparison.

Production and existing xG inputs are unchanged. No new data provider was added.
