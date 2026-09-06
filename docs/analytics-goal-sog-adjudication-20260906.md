# Goal credit is not always another shot on goal

The initial 498-game conflict-enriched frozen sample contains 32 games where
counting non-shootout typeCode 505 plus 506 exceeds the reported team SOG by
exactly one. These are unresolved statistical semantics, not automatically feed
corruption. Thirty games are regular-season and two playoff. Each affected team
has one goal lacking shotType; all other team-games in this sample lack that
pattern. Correlation is not an affirmative awarded-goal marker.

Independent primary reports confirm these exact awarded-goal examples:

| Game / event | Identity | Official evidence |
|---|---|---|
| 2025020184 / 104 | MacKinnon, COL, P2 09:10 | [Avalanche recap](https://www.nhl.com/avalanche/news/game-recap-11-01-25): goal awarded after net displacement |
| 2025020208 / 1052 | Johansson, MIN, P4 03:38 | [NHL recap](https://www.nhl.com/news/nashville-predators-minnesota-wild-game-recap-november-4-2025): goal awarded after net displacement |
| 2025020683 / 1021 | Slafkovsky, MTL, P3 17:59 | [NHL recap](https://www.nhl.com/news/florida-panthers-montreal-canadiens-game-recap-january-8-2026): awarded empty-net goal after a slashed stick. [Official summary](https://www.nhl.com/scores/htmlreports/20252026/GS020683.HTM) records the empty net as one goal against and zero shots |

No explicit awarded-goal/statistical-shot marker was found in the captured JSON
fields for the 32 affected goals. `final_game_evidence.py` therefore continues
to quarantine unresolved totals, preserving raw events and existing observation
hashes. It must not infer SOG contribution from missing shotType or invent a shot
location/model input. The [NHL glossary](https://www.nhl.com/info/hockey-glossary)
defines SOG through attacking shots/tips/deflections, not every credited goal.

An eventual adjudication record must bind game, event, team, player, period/time
and original snapshot/event hashes; retain an official statistical source URL,
actual retrieval time and raw-response SHA-256; and independently specify goal
credit and SOG contribution with a supported reason. These research links alone
are not yet frozen machine-verifiable adjudication receipts. Other cases remain
unresolved, and no source rows or model probabilities have been rewritten.
