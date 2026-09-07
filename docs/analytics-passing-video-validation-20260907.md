# Passing validation: original footage reviewed

## New evidence

Retrieved the actual public media resource requested by the official [Hall highlight page](https://nhl.com/video/car-vgk-hall-scores-goal-against-carter-hart-6398421474112). No alternative data provider, credentials or access workaround was introduced. Decoded the footage locally and visually inspected a contact sheet spanning the beginning of the highlight.

The broadcast sequence shows a pass to the far-side Carolina receiver, who advances with the puck before shooting. Together with the page's Slavin/Hall identification, this corroborates the initial candidate as a pass-then-carry sequence rather than an immediate one-timer. Player identities are not independently resolved solely from jersey pixels in every sampled frame.

This distinction matters: pass flight is not reception-to-shot delay. A large displacement during the pass does not establish that the subsequent shot immediately forced the goalie to move. The implemented measurement API keeps those durations and receiver movement separate.

## Evidence preserved

`scripts/proof/results/passing-video-review-20260907/` contains the original observed media reference, decoded highlight, video hash receipt, individual sampled frames, contact sheet and `review-observations.json`. The media reference contains an expiring delivery URL and should not be published as a stable source citation. Use the official page link instead.

Reproducer: `scripts/proof/render_pass_video_review.py`, with local isolated `imageio-ffmpeg` and Pillow dependencies in `/tmp/citrus-video-review-deps`. It does not modify production dependencies. Temporary browser tabs were closed.

## What is and is not validated

- New: visual evidence of a pass followed by receiver movement before shooting.
- Still unresolved: exact mapping of pass release, reception and shot release between the broadcast video and the tracking frame indices; physical rink scale and exact net reference.
- The video sampling labels are an FFmpeg output grid, not certified exact contact times.
- The observation record deliberately leaves exact tracking frame labels null. It is not supplied as exhaustive detector-evaluation truth or a production feature.
- No independent second reviewer has checked these labels; no detector precision/recall or xG accuracy gain is claimed.

Next validation work is synchronizing multiple visible landmarks between video and tracking and assigning frame intervals, including uncertainty, before computing reviewed measurements. Do not use the current detector's predicted endpoints as their own ground truth.
