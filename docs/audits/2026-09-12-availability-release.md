# Dated availability and projection-read acceptance — September 12, 2026

This receipt accompanies the [maintained operating map](../../scripts/ops/projection-retirement/CUTOVER.md). Read the published database views and deployment health to establish current state; the identities below describe this dated release.

## Release identity and validation

[PR #469](https://github.com/Gstormsfh/citrus-league-storm-main/pull/469) passed all 16 checks and merged as `a3cdafb1aabbb98c16f7ec09329f9ce192506f9b`. Its [normal production workflow](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34707173164) succeeded, API before web. This is the final serving code identity for this receipt: Cloud Run `citrus-api-00317-8mk`, verified serving/expected digest `sha256:936334b2d8802db4cd4fd9f8f88c7913a412ac4475b79d066bd963630df0cc82`; API health 200 at 17:14:44 UTC; Hosting `03db8c10f0a28425`. At 17:16:29 UTC, public index and six selected JS chunks matched the workflow artifact. Index HTML SHA256: `3c3ea40fb6d0ee6d2417e072019fd1026f63c501af345412af9912f0b0bb5618`; corrected Free Agents chunk: `FreeAgents-CLdHrHvG.js`.

The underlying availability/reader implementation shipped in [PR #468](https://github.com/Gstormsfh/citrus-league-storm-main/pull/468), with all 16 checks passing, merge `e2fd0ad6cf507c639dc417231df2daf2e9c1edca` and successful [API-first workflow](https://github.com/Gstormsfh/citrus-league-storm-main/actions/runs/34706114404). Both release verifications used the normal workflow serving-revision/digest checks plus independent public artifact comparisons; no independent local Cloud Run control-plane query is claimed.

| Publication | Identity |
|---|---|
| Reviewed source | `728f003d42ee087391d216c7308d18ec98f72859b2c3b92291ac7e0321cc7f27` / UUID `8557ce70-33a0-424d-a55c-b726ef013d61` |
| Effective runtime | `5af8ba32971387f84671c6e8a9e8bbae2f1f6f40e90d36601d49aa7303f72d16` / UUID `945ee26e-aa25-47e3-88c8-8d622a4983db` |
| Runtime raw SHA256 | `08f3a208338e047e90da73f5be8be6ca4f53f4d8d62fd9c05f76944fd70a01a4` |
| Publication time | September 12, 16:40:21.440815 UTC |
| Inherited model refresh | September 12, 10:02:13.183476 UTC; unchanged |

The runtime revision is the SHA256 of its exact PostgreSQL JSONB preimage excluding `revision`. Actual production validation returned `valid: true` with no errors. An independent postcommit read at 16:43:14 UTC matched the approved payload and found all 674 ROS and 56,616 daily rows stamped with the new runtime. This was a metadata publication, not a model refresh.

Independent comparison preserved all 56,347 existing numerical tokens at their original paths and all 1,325 player profiles except Fiala's availability metadata. SQL also compared every output row and field, excluding only the intentional run/revision/timestamp changes and the generated daily `projection_id`. The comparable hashes before and after were identical:

- ROS: `baf006ec10582a13fccbb1bdc653e036`.
- Daily: `ca7a9f14ef20bca7628ab481554840ce`.

These hash `to_jsonb(row)` minus `projection_run_id`, `projection_revision`, `created_at`, `updated_at`, and additionally daily `projection_id`, ordered by `player_id` for ROS and `player_id, game_id` for daily, within season 2026. Zero, negative, missing, GP, goalie exposure and plus/minus fields were preserved.

All 70 leagues retained both saved-settings fingerprints. `986d4c3caccca2f9fa7fc410c4a742bd` hashes `jsonb_build_array(id, scoring_settings, settings)::text`; `e13cfa2f83a7a930dce05e40eaffc5a5` hashes `id::text || scoring_settings::text`, each concatenated in ID order and MD5-hashed. The latter excludes general `settings` and skips null concatenations. Their different values reflect different scopes; both matched their own baselines. No saved eligibility or lineup rules changed.

## Status source coverage

Fiala's structured availability now records OUT, supported by the [September 10 NHL report](https://www.nhl.com/news/kings-kevin-fiala-to-miss-start-of-training-camp-after-procedure-for-leg-injury) that he will miss camp start. The unsupported September 30 return claim was removed; return remains undetermined. September 17 is an evidence-review deadline, not a predicted recovery date. Merzlikins remains unknown: his dated surgery report and zero-start scenario do not establish a current roster designation.

The dated ownership check found all 940 inspected talent rows without status provenance, no injury job in the inspected pg_cron schedule, and no successful inspected injury workflow run. The live talent rebuild removes goalie/no-TOI rows. No feed table or runner was enabled. This release implements consistent evidence handling, not complete fresh league-wide injury coverage. Imported scenarios, expired/absent evidence and IR eligibility remain separate; unknown never implies healthy.

## Code, native and acceptance limits

The reviewed implementation is `61213330ff344f2a4673fdd14a86cadec36163fa`. Local focused checks passed: 725 web tests, 219 server tests, 30 shared availability/scoring tests, 18 source-validator tests, type checks and a production build. Independent code and publication reviews found no blocking defect.

The latest unsigned Build19 candidate uses exact `2326319ad743dc0f9077066a7ad90f6fcc9214e6` app inputs, including the Free Agents row correction: 413 focused tests (45 shared, 368 web), type checks, native assertions/sync, simulator compilation and unsigned device archive passed; 215 assets matched both native apps. Manifest SHA256: `63883801f793ad33433d607a84ac1c71bc7e8f2ddc4e8db741ec7dab2fa3b9bc`. Device executable SHA256: `f19ddabc3f046590dd2d7e985b0bb0b53067f01c9ba7ac61a824e88547da6932`. The prior `61213330` candidate's executable, manifest and all 215 assets were verified preserved; earlier archives and Build18 remain untouched. No signing, device installation, launch, upload or distribution occurred.

The daily/ROS revision guard adds two pointer queries per stable assembled response, up to four with one full-result retry. It does not eliminate ordinary client-cache or idle-render delays. Matchup efficiency claims remain limited to the [documented request graph and fixture evidence](2026-09-12-matchup-earned-scoring.md); no production before/after latency benchmark was performed.

Focused authenticated replay of that release confirmed Fiala's modal OUT report with September 10 evidence, September 17 review deadline and the explicit IR-eligibility distinction; Merzlikins' modal showed Unknown while retaining his legitimate zero-start projection scenario. It also found a real missed consumer: the desktop Free Agents table printed the legacy `active` flag for both players. [PR #469](https://github.com/Gstormsfh/citrus-league-storm-main/pull/469), reviewed head `2326319ad743dc0f9077066a7ad90f6fcc9214e6`, replaces that span with the existing dated availability badge. Its 48 focused tests and web typecheck passed; independent review found no blocker. Corrected serving is verified above. Actual authenticated paired replay on `FreeAgents-CLdHrHvG.js` and `index-ChOidrRS.js` passed: Fiala’s row and modal both showed OUT with the reviewed September 10 evidence, September 17 review deadline and IR-eligibility distinction; Merzlikins’ row and modal both showed Unknown/current availability not confirmed, preserving his zero-start scenario.

The preceding `e2fd0ad6` focused replay preserved Test September 27–October 3 Matchup projections 224.2/224.0 and Finalsz September 28–October 4 projections 128.6/108.9, with actual totals zero. Finalsz Free Agents retained J.T. Miller 14.0 points over four games and Shesterkin 13.0 points, 2.7 expected starts over four team games. These are focused examples, not independent full-roster recomputation. The `a3cdafb1` replay covered paired availability only; numerical preservation at that release follows from unchanged numerical inputs/source and the display-only application diff, not a new numerical browser replay.

For both the first availability release and the corrected row release, the initial ordinary new tab and reload still served the preceding bundle. Temporary tab cache/service-worker bypass loaded the new client; after restoring both settings to false, ordinary reload retained the new assets and corrected Fiala OUT row. No storage was deleted and no user data was written. Pre-recovery worker-state diagnostics were unavailable. No default upgrade guarantee follows from this recovery. Premium draft access, installed-device behavior, comprehensive zero/missing UI cases and independent full-roster totals remain unproven.

Private raw recovery snapshots remain outside git. The runtime backup was saved with mode 0600 and file/directory-fsynced before commit; its SHA256 is `4276ca3fccbc5a426c4b025151975d1f84aa4e8a60a905997559fe979ebda8c6`. Recovery must use current guarded CAS activation of the retained prior runtime, with fresh date/schema/output/settings checks; it creates legitimate new publication metadata. Never replay an obsolete pre-plus/minus refresh function or delete history. No rollback was performed.

## Snapshot exports

New default and Finalsz draft PDF/XLSX editions were generated from the exact published `5af8ba32` runtime and its PostgreSQL preimage. Both 189-page PDFs passed content/navigation/bounds checks and visual inspection. Across both workbooks, 2,650 cached scores matched the shared scorer; all 43,771 formulas and 62,536 numeric cells remained unchanged from the preceding `858d8a9c` editions, with no formula errors. Availability/exposure records matched all 1,325 profiles. All eight historical artifact hashes were preserved.

These are local snapshot exports, not continuously refreshing projections. Unsupported forecasts remain unavailable, including Tij Iginla's missing plus/minus in Finalsz; a zero exposure scenario does not supply a missing forecast. The default edition has 674 ranked profiles, Finalsz 673.

| Edition | PDF SHA256 | XLSX SHA256 |
|---|---|---|
| default | `dc4a4f1807aa20b5cb565a016431db6a3171bf674aa57d9d9d1943e00c4f4e92` | `3e5b4fadce7a94af1fae9c2c9c8b0f50fc3bfd33161ad5b59b7852140d76f08c` |
| Finalsz | `fdced7d0c583c9ecb1a04406ac58e515069c81aed24a5bbe43488d6360af1dc6` | `33b8c547b0c30069342e3dd1cebd1a9c0913e81d5b1a7d2fc7fbc42632855010` |

## Local editor closeout

The local source-review editor now preserves `reviewed_report`, `healthy` and `injured` in its dropdowns. The matching offline Python type declarations were aligned. A render/no-op patch regression verifies that these values stay selected and create no patch. Both the default and published-source UI fixtures passed, alongside four local review-server tests and 18 canonical-review tests. An actual local editor check showed Fiala as reviewed-report OUT with the September 17 review deadline and no pending edit. This repair does not publish a source or alter projections.

The closeout changes only this receipt, the operating map, the local editor HTML/test and the offline Python availability type. API Docker COPY inputs, web/native sources and assets, shared code, dependencies, migrations, deployment workflows and build scripts remain identical to the verified `a3cdafb1` serving release, whose app inputs match the reviewed `2326319a` row correction. The local editor is served only by its dedicated read-only Python review server; its HTML and test are outside the app build. The Python change is an additive `TypedDict`/`Literal` declaration, outside the Node workspaces and container inputs. This local tooling closeout adds no native app input beyond the separately reviewed row correction.
