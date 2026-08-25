# All-time Leafs: one script, two requests

The Immaculate Grid runs on 2017-18 onward because that is where the Citrus
database starts. A Leafs grid that cannot ask about Sittler, Salming, Keon,
Gilmour or Sundin is not really a Leafs grid.

**The build is already wired for this.** Drop the file in, rebuild, and a
second set of boards appears with era, longevity and position squares
generated from the roster. Until then the panel says so plainly instead of
pretending the boards exist.

Neither Claude sandbox has outbound access to nhle.com -- verified, not
assumed: the container reaches npm and GitHub and gets nothing at all from
api-web.nhle.com, assets.nhle.com or records.nhl.com. That is why this is a
job for your terminal rather than something already done.

**There is now one command for this and the other two.** `fetch-assets.mjs`
gets the crest, the faces and this roster in one go:

```
node fetch-assets.mjs
powershell -ExecutionPolicy Bypass -File checks.ps1 -Rebake
```

The rest of this file is the roster half on its own, kept because it
documents the schema and because two requests are worth understanding.

---

## What to run

`records.nhl.com` publishes franchise all-time records with exactly the four
fields the build needs, so this is two requests, not a thousand. Save as
`scripts/fetch-alltime-leafs.mjs` and run `node scripts/fetch-alltime-leafs.mjs`.

```js
// Every player who has ever dressed for the Toronto Maple Leafs.
// Output: art/leafs-alltime.json
import { writeFileSync, mkdirSync } from 'node:fs';

const FRANCHISE = 5;                       // Toronto Maple Leafs
const BASE = 'https://records.nhl.com/site/api';
const url = t =>
  `${BASE}/franchise-${t}-records?cayenneExp=franchiseId=${FRANCHISE}`;

const grab = async t => {
  const r = await fetch(url(t));
  if (!r.ok) throw new Error(`${t}: HTTP ${r.status}`);
  const { data } = await r.json();
  if (!data?.length) throw new Error(`${t}: no rows`);
  return data;
};

const [skaters, goalies] = await Promise.all([grab('skater'), grab('goalie')]);

// Fail loudly rather than quietly writing another club's roster.
const wrong = [...skaters, ...goalies]
  .find(r => r.franchiseName && r.franchiseName !== 'Toronto Maple Leafs');
if (wrong) throw new Error(`franchiseId ${FRANCHISE} returned ${wrong.franchiseName}`);

const yr = id => Math.floor(Number(id) / 10000);   // 19261927 -> 1926

const row = (r, isGoalie) => ({
  n  : `${r.firstName} ${r.lastName}`.trim(),
  pos: isGoalie ? 'G' : (r.positionCode || 'C'),
  y0 : yr(r.firstSeasonId),
  y1 : yr(r.lastSeasonId || r.firstSeasonId),
  gp : Number(r.gamesPlayed) || 0,
});

const players = [...skaters.map(r => row(r, false)),
                 ...goalies.map(r => row(r, true))]
  .filter(p => p.n && p.gp > 0 && p.y0 > 1900 && p.y1 >= p.y0)
  .sort((a, b) => b.gp - a.gp);

// One name per man: the records API splits a few players across stints.
const merged = new Map();
for (const p of players) {
  const k = p.n.toLowerCase() + '|' + p.pos;
  const e = merged.get(k);
  if (!e) { merged.set(k, p); continue; }
  e.gp += p.gp;
  e.y0 = Math.min(e.y0, p.y0);
  e.y1 = Math.max(e.y1, p.y1);
}
const out = [...merged.values()].sort((a, b) => b.gp - a.gp);

mkdirSync('art', { recursive: true });
writeFileSync('art/leafs-alltime.json', JSON.stringify({
  built: new Date().toISOString().slice(0, 10),
  source: 'records.nhl.com franchise-skater-records + franchise-goalie-records',
  players: out,
}, null, 0));

console.log(`${out.length} Leafs, ${Math.min(...out.map(p => p.y0))} to ${Math.max(...out.map(p => p.y1))}`);
console.log('top 5 by games:', out.slice(0, 5).map(p => `${p.n} ${p.gp}`).join(', '));
```

Then:

```
python3 bake_art.py && python3 build.py
```

The baker inlines it, the grid panel flips from "wired and empty" to
"All-time Leafs loaded", and a **Play the all-time board** button appears.

---

## The schema, if you would rather build the file another way

Four fields per player. Nothing else is read, so nothing else can go stale.

```json
{ "built": "2026-08-24",
  "players": [
    { "n": "George Armstrong", "pos": "R", "y0": 1949, "y1": 1970, "gp": 1187 },
    { "n": "Tim Horton",       "pos": "D", "y0": 1949, "y1": 1969, "gp": 1185 }
  ] }
```

- `n` full name as a fan would type it
- `pos` one of `C L R W D G`
- `y0` `y1` first and last **season start year** in the sweater
- `gp` games played for Toronto

`gp` doubles as the fame score: it decides which answer the board calls the
obvious one, and it drives the rarity number at the end of a grid. Nobody
plays 800 games for Toronto quietly, so it is a fair proxy and it needs no
extra source.

The baker refuses anything under 50 usable rows, so a truncated download
fails at build time rather than shipping a half-empty grid.

---

## What you get once it lands

Criteria generated from those four fields, no hand-authoring:

- **Eras** Original Six (1942 to 1967), the 1970s, 1980s, 1990s, 2000s, 2010s
- **Longevity** 100+, 500+, 1,000+ games in the sweater; exactly one season;
  ten seasons or more
- **Position** centre, winger, defenceman, goaltender

Twelve boards are built from the combinations, every square checked to have
between 3 and 120 valid answers so none is impossible and none is a gimme.
Squares read as sentences, the way the modern boards do:

> Name a Leaf who played 1,000 or more games in the sweater and wore the
> sweater in the Original Six era.

> Name a defenceman who played for Toronto in the 1970s.

A criterion with fewer than eight men in it is dropped automatically, so a
partial file degrades to fewer boards rather than to broken ones.

---

## Two things this deliberately does not do

**Cups, captaincies and retired numbers.** They would make the best squares
in the game and none of them is in the four fields above. They need a second
source and a second pass, and inventing them from memory in a file that goes
in front of MLSE is exactly the kind of mistake that ends a meeting. Left out
on purpose.

**Merging the all-time pool into the modern boards.** The two pools stay
separate: the modern boards keep asking about 2017-18 onward across all 33
clubs, and the all-time boards are Leafs only. Mixing them would mean a fan
typing "Sittler" into a square about Vegas.
