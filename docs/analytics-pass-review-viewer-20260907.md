# Local pass review viewer

Open http://127.0.0.1:8767/ while the local server is running. To restart from the repository root:

```sh
python3 -m http.server 8767 --bind 127.0.0.1 --directory scripts/proof/results/pass-review-viewer-20260907
```

The saved Hall clip is paired with NHL replay coordinates. Shared playback, frame stepping, actor selection, coordinate trails and an adjustable provisional offset support visual review. Export saves an unreviewed position note, not a possession annotation or training label.

Boxes mark supplied coordinates; they are not computer-vision body detections. Coordinates remain in native renderer units, not calibrated feet. Stable-control candidates are hypotheses. Goal-selected footage cannot establish all-shot pass coverage or model accuracy. Production and model weights are unchanged.

Validation: video loads locally as a blob so seeking works without HTTP Range support. Playback advances tracking using presented video frames when supported. Final frame 60 sought to video 5.724267 seconds at offset -0.275733 seconds. Browser reported no warning/error logs during the final check. Layout checks found no horizontal overflow at 360 and 736 CSS pixels. Source JavaScript passed `node --check`.

Source: `scripts/proof/pass-review-viewer.html`, `scripts/proof/pass-review-viewer.js`, and `scripts/proof/build_pass_review_viewer.py`. Packaged assets are under `scripts/proof/results/pass-review-viewer-20260907/`. The final verification receipt supersedes the initial build receipt's HTML/JavaScript hashes; the initial receipt is preserved.

Next evidence gate: independently review alignment and possession transitions across clips, including failures and missing observations, before using inferred passing features in an out-of-sample model experiment.
