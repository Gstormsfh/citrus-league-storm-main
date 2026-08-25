/* Where did the all-time roster go?
 *
 *     node probe-alltime.mjs
 *
 * records.nhl.com/site/api/franchise-skater-records is what ALLTIME-LEAFS.md
 * has always said to use, and it now answers 404 with a Jetty error page --
 * both with the franchise filter and without it. So the path moved, or the
 * whole /site/api prefix did, and one 404 tells you nothing about where to.
 *
 * This asks a spread of candidates once and prints what each one actually
 * returns: the status, the content type, and for anything that comes back as
 * JSON, how many rows and what the first row's fields are called. That last
 * part is the bit that matters -- an endpoint is only useful here if it
 * carries a name, a position, first and last season, and games played.
 *
 * It writes nothing and changes nothing. Paste the output back.
 */
const TEAM = 'TOR';
const FRANCHISE = 5;

const CANDIDATES = [
  // the documented home, and its neighbours
  ['records', `https://records.nhl.com/site/api/franchise`],
  ['records', `https://records.nhl.com/site/api/franchise-skater-records?cayenneExp=franchiseId=${FRANCHISE}`],
  ['records', `https://records.nhl.com/site/api/skater-career-records?cayenneExp=franchiseId=${FRANCHISE}`],
  ['records', `https://records.nhl.com/site/api/goalie-career-records?cayenneExp=franchiseId=${FRANCHISE}`],
  ['records', `https://records.nhl.com/site/api/franchise-detail?cayenneExp=mostRecentTeamId=10`],
  ['records', `https://records.nhl.com/site/api/franchise-season-results?cayenneExp=franchiseId=${FRANCHISE}`],

  // the stats REST api, which is alive for current seasons
  ['stats',   `https://api.nhle.com/stats/rest/en/franchise`],
  ['stats',   `https://api.nhle.com/stats/rest/en/skater/summary?limit=3&cayenneExp=franchiseId=${FRANCHISE}%20and%20gameTypeId=2`],
  ['stats',   `https://api.nhle.com/stats/rest/en/skater/summary?limit=3&isAggregate=true&cayenneExp=franchiseId=${FRANCHISE}%20and%20gameTypeId=2`],
  ['stats',   `https://api.nhle.com/stats/rest/en/goalie/summary?limit=3&isAggregate=true&cayenneExp=franchiseId=${FRANCHISE}%20and%20gameTypeId=2`],
  ['stats',   `https://api.nhle.com/stats/rest/en/team`],

  // known good, so a total failure here means the network and not the API
  ['control', `https://api-web.nhle.com/v1/roster-season/${TEAM}`],
];

const WANT = ['name', 'firstname', 'lastname', 'playername', 'skaterfullname',
              'goaliefullname', 'position', 'positioncode', 'firstseasonid',
              'lastseasonid', 'seasonid', 'gamesplayed', 'gp', 'franchiseid'];

const short = s => String(s).replace(/\s+/g, ' ').slice(0, 110);

for (const [group, url] of CANDIDATES) {
  const label = '[' + group + '] ' + url.replace(/^https:\/\//, '');
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'citrus-demo' } });
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok) {
      console.log('  ' + r.status + '  ' + label);
      continue;
    }
    const body = await r.text();
    let out = 'ok   ' + label + '\n         ' + ct;
    if (/json/.test(ct)) {
      try {
        const j = JSON.parse(body);
        const rows = Array.isArray(j) ? j : (j.data || j.items || null);
        if (Array.isArray(rows)) {
          out += '  ' + rows.length + ' rows';
          if (rows.length) {
            const keys = Object.keys(rows[0]);
            const useful = keys.filter(k => WANT.includes(k.toLowerCase()));
            out += '\n         fields: ' + short(keys.join(', '));
            out += '\n         useful: ' + (useful.join(', ') || 'NONE of the five the grid needs');
            out += '\n         row 1 : ' + short(JSON.stringify(rows[0]));
          }
        } else {
          out += '  top-level keys: ' + short(Object.keys(j).join(', '));
        }
      } catch { out += '  (said json, did not parse)'; }
    } else {
      out += '  ' + short(body);
    }
    console.log('  ' + out);
  } catch (e) {
    console.log('  ERR  ' + label + '\n         ' + short(e.message));
  }
}

console.log('\nThe grid needs five things per man: a name, a position, the first');
console.log('and last season he wore the sweater, and games played for Toronto.');
console.log('Any endpoint above with all five is enough to rebuild the file.\n');
