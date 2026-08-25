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
