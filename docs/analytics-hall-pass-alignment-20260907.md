# Hall sequence: provisional video/tracking alignment

Reviewed the original NHL highlight at denser sampling, preserving decoded source presentation timestamps (PTS) rather than assigning approximate times from a resampled frame counter. The selected frames, hashes and contact sheets are in `scripts/proof/results/passing-landmarks-20260907/`.

Three landmarks were bracketed conservatively by the same reviewer: pass departure, receiver acquisition, and shot departure. The video intervals were selected visually; the tracking intervals were selected from source motion. These are not independently adjudicated stick-contact labels. Small/partly occluded puck images and rendered tracking limit precision.

| Landmark | Video PTS interval, seconds | Relative replay frame interval |
|---|---:|---:|
| Pass departure | 5.605600–5.805800 | 59–61 |
| Receiver acquisition | 6.473133–6.806800 | 69–71 |
| Shot departure | 8.942267–9.142467 | 92–94 |

At the existing 0.1-second replay tick convention, these intervals admit a common video-minus-replay-elapsed offset of **−0.457733 to −0.094200 seconds**. This is an interval-consistency check, not a fitted exact offset or proof that every landmark is correct.

The provisional tracking ranges imply **0.8–1.2 seconds of pass flight** and **2.1–2.5 seconds from reception to shot**. Separately, the visually selected video ranges imply approximately **0.67–1.20 seconds** and **2.14–2.67 seconds**, respectively. Those overlapping ranges support the same substantive observation: pass, then substantial receiver carry/hold time, then shot—not an immediate catch-and-shoot.

The bounds describe annotation uncertainty, not statistical confidence intervals. Do not substitute their midpoint into production or score detector accuracy against them as exact ground truth. This remains a single goal-selected clip, without independent second review or exhaustive labels.

Authoritative result: `reconciliation-v2.json`. The first `reconciliation.json` is retained as evidence but superseded: two receiver video timestamp values were transcribed 0.0006 seconds high. The revised script reads all video timestamps directly from the preserved index, removing manual timestamp transcription. The common-offset result and qualitative finding did not change.

Reproducers: `scripts/proof/render_pass_landmarks.py` and `scripts/proof/reconcile_hall_pass_landmarks.py`. No physical coordinate scale or net reference was invented. No xG training, detector threshold adjustment or production change occurred.
