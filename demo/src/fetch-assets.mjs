/* The three things the sandbox cannot get, in one command.
 *
 *     node fetch-assets.mjs
 *
 * Neither Claude sandbox has outbound access to nhle.com, which is why the
 * crest, the faces and the all-time roster have sat "wired and waiting" for
 * this whole build. Every one of them is already plumbed in: the baker
 * looks for these exact filenames and the page swaps to them the moment
 * they exist. So this is a download, not a feature.
 *
 *     art/crest.svg            replaces every drawn maple leaf in the build
 *     art/hs-<lastname>.png    every row, slate and picker swaps to the man
 *     art/leafs-alltime.json   the second Immaculate Grid appears
 *
 * Then:  powershell -ExecutionPolicy Bypass -File checks.ps1 -Rebake
 *
 * Each of the three is independent. One failing does not stop the others,
 * and a partial headshot delivery is a partial upgrade -- anybody who did
 * not come down keeps his numbered sweater and no row breaks.
 */
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ART  = join(HERE, 'art');
mkdirSync(ART, { recursive: true });

const TEAM = 'TOR';
const FRANCHISE = 5;                       // Toronto Maple Leafs
let failed = 0;

const say  = m => console.log('  ' + m);
const head = m => console.log('\n' + m + '\n' + '-'.repeat(m.length));

async function get(url, as = 'json') {
  const r = await fetch(url, { headers: { 'User-Agent': 'citrus-demo' } });
  /* say what the server said, not just the number. A bare 404 on an API
     that moved tells you nothing about where it moved to. */
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error('HTTP ' + r.status + '  ' + url +
                    (body ? '\n         ' + body.slice(0, 160).replace(/\s+/g, ' ') : ''));
  }
  return as === 'json' ? r.json()
       : as === 'text' ? r.text()
       : Buffer.from(await r.arrayBuffer());
}

/* ── 1. the crest ────────────────────────────────────────────────────
   The club's own mark, shown back to the people who own it. The build
   draws a leaf until this lands and then stops drawing it. */
async function crest() {
  head('THE CREST');
  const tries = [
    `https://assets.nhle.com/logos/nhl/svg/${TEAM}_light.svg`,
    `https://assets.nhle.com/logos/nhl/svg/${TEAM}_dark.svg`,
  ];
  for (const u of tries) {
    try {
      const svg = await get(u, 'text');
      if (!/<svg/i.test(svg)) throw new Error('not an svg');
      writeFileSync(join(ART, 'crest.svg'), svg);
      say('art/crest.svg  ' + Math.round(svg.length / 1024) + ' KB  <- ' + u);
      return;
    } catch (e) { say('no luck: ' + e.message); }
  }
  failed++; say('FAILED. Drop the mark in by hand as art/crest.png or art/crest.svg.');
}

/* ── 2. the faces ────────────────────────────────────────────────────
   Every man on the roster, not just the sixteen in the slate: the file is
   matched by surname at bake time, so downloading the lot means a roster
   move cannot leave somebody as a sweater. About 15 KB each. */
async function faces() {
  head('THE FACES');
  let roster = null;
  for (const season of ['current', '20252026', '20262027']) {
    try {
      roster = await get(`https://api-web.nhle.com/v1/roster/${TEAM}/${season}`);
      say('roster: ' + season);
      break;
    } catch (e) { say('no roster for ' + season + ' (' + e.message + ')'); }
  }
  if (!roster) { failed++; say('FAILED. No roster, so no faces.'); return; }

  const all = [...(roster.forwards || []), ...(roster.defensemen || []), ...(roster.goalies || [])];
  if (!all.length) { failed++; say('FAILED. The roster came back empty.'); return; }

  /* the same key the page uses: surname, unaccented, letters only */
  const key = n => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                   .toLowerCase().replace(/[^a-z]/g, '');

  let got = 0, missed = 0;
  for (const p of all) {
    const last = p.lastName?.default || '';
    const url  = p.headshot;
    if (!last || !url) { missed++; continue; }
    try {
      const png = await get(url, 'bin');
      const stem = join(ART, 'hs-' + key(last));
      writeFileSync(stem + '.png', png);
      /* the baker keeps a cropped .webp beside each mug and prefers it, so
         a stale one would quietly outrank the face just downloaded */
      rmSync(stem + '.webp', { force: true });
      got++;
    } catch (e) { missed++; say('  no face for ' + last + ': ' + e.message); }
  }
  say(got + ' faces in art/, ' + missed + ' without one');
  if (!got) failed++;
}

/* ── 3. every Leaf there has ever been ───────────────────────────────
   Two requests, not a thousand: records.nhl.com publishes the franchise's
   all-time skaters and goalies with exactly the four fields the grid
   reads. See ALLTIME-LEAFS.md for the schema and what it unlocks. */
async function alltime() {
  head('EVERY LEAF THERE HAS EVER BEEN');
  const base = 'https://records.nhl.com/site/api';
  /* Two ways of asking, because the filtered form 404'd once and there is
     no reason for that to cost the whole file. The unfiltered form returns
     every club and is filtered here instead -- bigger, and it works. */
  const grab = async t => {
    const urls = [
      `${base}/franchise-${t}-records?cayenneExp=franchiseId=${FRANCHISE}`,
      `${base}/franchise-${t}-records`,
    ];
    for (const u of urls) {
      try {
        const { data } = await get(u);
        const mine = (data || []).filter(r =>
          Number(r.franchiseId) === FRANCHISE || r.franchiseName === 'Toronto Maple Leafs');
        if (mine.length) { say(t + ': ' + mine.length + ' rows'); return mine; }
        say(t + ': that URL answered but held no Leafs');
      } catch (e) { say(t + ': ' + e.message); }
    }
    return [];
  };
  try {
    /* NOT Promise.all. The first run of this had them joined, one endpoint
       404'd, and the failure took the other down with it -- so the output
       said nothing at all about whether the skaters had come back fine. */
    const skaters = await grab('skater');
    const goalies = await grab('goalie');
    if (!skaters.length && !goalies.length) throw new Error('neither endpoint returned rows');
    if (!goalies.length) say('no goalies; the grid will have no goalie squares');
    if (!skaters.length) say('no skaters, which is most of a franchise');

    /* fail loudly rather than quietly writing another club's roster */
    const wrong = [...skaters, ...goalies]
      .find(r => r.franchiseName && r.franchiseName !== 'Toronto Maple Leafs');
    if (wrong) throw new Error(`franchiseId ${FRANCHISE} returned ${wrong.franchiseName}`);

    const yr  = id => Math.floor(Number(id) / 10000);        // 19261927 -> 1926
    const row = (r, g) => ({
      n  : `${r.firstName} ${r.lastName}`.trim(),
      pos: g ? 'G' : (r.positionCode || 'C'),
      y0 : yr(r.firstSeasonId),
      y1 : yr(r.lastSeasonId || r.firstSeasonId),
      gp : Number(r.gamesPlayed) || 0,
    });

    const players = [...skaters.map(r => row(r, false)), ...goalies.map(r => row(r, true))]
      .filter(p => p.n && p.gp > 0 && p.y0 > 1900 && p.y1 >= p.y0)
      .sort((a, b) => b.gp - a.gp);

    /* one name per man: the records API splits a few across stints */
    const merged = new Map();
    for (const p of players) {
      const k = p.n.toLowerCase() + '|' + p.pos;
      const e = merged.get(k);
      if (!e) { merged.set(k, p); continue; }
      e.gp += p.gp; e.y0 = Math.min(e.y0, p.y0); e.y1 = Math.max(e.y1, p.y1);
    }
    const out = [...merged.values()].sort((a, b) => b.gp - a.gp);
    if (out.length < 50) throw new Error('only ' + out.length + ' rows; expected the franchise');

    writeFileSync(join(ART, 'leafs-alltime.json'), JSON.stringify({
      built: new Date().toISOString().slice(0, 10),
      source: 'records.nhl.com franchise-skater-records + franchise-goalie-records',
      players: out,
    }));
    say(out.length + ' Leafs, ' + Math.min(...out.map(p => p.y0)) +
        ' to ' + Math.max(...out.map(p => p.y1)));
    say('top five by games: ' + out.slice(0, 5).map(p => `${p.n} ${p.gp}`).join(', '));
  } catch (e) {
    failed++; say('FAILED: ' + e.message);
  }
}

await crest();
await faces();
await alltime();

head('WHAT LANDED');
for (const [f, what] of [['crest.svg', 'the club mark'],
                         ['leafs-alltime.json', 'the all-time grid']]) {
  say((existsSync(join(ART, f)) ? 'yes  ' : 'no   ') + f.padEnd(20) + what);
}
const { readdirSync } = await import('node:fs');
const n = readdirSync(ART).filter(f => /^hs-.*\.png$/.test(f)).length;
say((n ? 'yes  ' : 'no   ') + ('hs-*.png').padEnd(20) + n + ' faces');

console.log('\nNow rebuild so the page picks them up:');
console.log('  powershell -ExecutionPolicy Bypass -File checks.ps1 -Rebake\n');
process.exit(failed ? 1 : 0);
