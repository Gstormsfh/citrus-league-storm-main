# Availability reconciliation — 2026-09-14

Two weeks before the season, every injury the public reports know about was
reconciled against the canonical source document (source revision
`1abb5e7e…`, 1,344 players, active runtime `39896604…`). The result is
`data-pipeline/draftkit/availability/2026-09-14-injury-reconciliation.csv`:
**73 rows** — 33 existing owner-reviewed rows rewritten as manager-facing
facts with a URL each, and **40 players added** who had no availability
record at all.

## Why every row was rewritten

The 2026-09-12 owner-adopted baseline carried its `reason` field as an audit
note ("Owner-adopted working out baseline from retained explicit workbook
status/notes. Original injury observation date is not established…"). That
text rendered verbatim on the player card. Thirteen rows marked `day_to_day`
had a games-played note and no injury in the reason at all; all thirteen were
real (on the CBS report as "questionable for start of season"), but nobody
reading the card could tell.

## Sources

- CBS Sports NHL injury report — https://www.cbssports.com/nhl/injuries/
- Puckpedia injuries (roster designations: IR / LTIR / SELTIR) — https://puckpedia.com/injuries
- Per-player articles where a timeline was stated: Heavy (Andersen/Savoie),
  Pro Hockey Rumors (Domi), RMNB (Sandin), Daily Faceoff (Demko), RotoWire
  (Arvidsson, Sanderson), Gino Hard (Matthews), DobberHockey Injury Ward
  Aug 19 (Kulich, Bedard, Terry, Jarvis, Gustavsson), NHL.com (Fiala).

## Status changes worth knowing

- Auston Matthews: `day_to_day` → `healthy`. MCL surgery in March; GM says
  full green-light for camp (Sep 14).
- Chris Tanev, Niko Mikkola: `unknown` → `ltir` (Puckpedia designation).
- Thatcher Demko: `injured` → `ltir`. William Karlsson: `day_to_day` → `ltir`.
- Kevin Fiala, Jonathan Huberdeau: `out` → `ir`.
- Tij Iginla: `unknown` → `day_to_day`.

## On the reports but not in the canonical document

Not patchable here; none is in the `players` table either except Caleb Jones,
so none reaches a draft pool:

- Season-ending, not in the directory: Alex Pietrangelo (VGK, hip, SELTIR),
  Torey Krug (STL, ankle, SELTIR), Logan Couture (SJS, groin, IR),
  Ryan Ellis (CHI, back, IR).
- Isac Lundestrom (CBJ, Achilles, out until at least Nov 10) — not in the
  directory.
- Caleb Jones (PIT, shoulder, IR, questionable) — in `players` as active,
  not in the canonical document. Adding him is a `player_additions` review.
- Prospects/AHL on Puckpedia's day-to-day list who are not in the directory:
  Cole Beaudoin, Max Psenicka, Cameron Lund, Aidan Thompson, Artyom Gonchar,
  Henry Mews, Cameron Schmidt.

## The finding underneath

`player_talent_metrics.roster_status`, `roster_status_source`,
`roster_status_updated_at` — the columns the ESPN injuries adapter writes and
the resolver's `reported_status` candidate reads — hold **zero rows in
production**. The feed has never populated. Until it does, the reviewed
baseline is the only availability evidence in the product, which is why this
pass carries 73 players instead of the handful a working feed would leave to
manual review. Fixing the feed is post-launch work; the runbook
(`docs/RUNBOOKS/AVAILABILITY_REVIEW.md`) is how availability stays right
until then.
