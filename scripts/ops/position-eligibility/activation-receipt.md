# Primary-position activation receipt

- Implementation: [PR487](https://github.com/Gstormsfh/citrus-league-storm-main/pull/487), merged commit `0bfd7dfc0e686bf4b0f92c20cf8e980b70a4b609`.
- Production migration: `20260913231943_governed_primary_position_corrections.sql`. Supabase assigned this version at application; the repository filename is reconciled to that recorded version without modifying migration history.
- Two reviewed events committed atomically at `2026-09-13T23:19:49.682802Z`, after a fresh empty draft-freeze blocker result and the operation's locked preimage/lineup checks.

| Player | Effective position | Event ID |
|---|---|---|
| Mats Zuccarello (8475692) | RW | `76fa0e35-6a56-45ab-99b9-aaee6c8782ea` |
| Jaden Schwartz (8475768) | LW | `4ec90dbc-a2ee-4d86-89a6-15956f0275e6` |

The post-activation directory read returned RW/LAK and LW/COL respectively. Both raw feed primaries remain C with NULL secondary cells, demonstrating the governed overlay. Zuccarello's existing saved RW slot is unchanged; Schwartz had no ownership or saved slots. There were no current/future daily rows for either player. Production still has **zero multi-position eligibility cells**. No projection, club, raw identity or roster rows were updated.

The post-DDL security advisor returned no findings referencing the new event table or amended directory view. Existing unrelated advisor findings were left outside this change. PR487's required CI checks passed before merge; the actual migration and guarded operation also passed PGlite access, feed-overwrite, date, goalie-domain and lineup-conflict tests.

Database activation does not certify the web/API deployment or signed native binary. Production deployment and visible UI acceptance are recorded separately. Signed Build 19 requires a rebuilt candidate for bundled client fixes; no native archive, upload or submission was performed.
