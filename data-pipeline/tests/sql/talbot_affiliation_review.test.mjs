import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const schema = readFileSync('supabase/migrations/20260913182124_governed_current_player_affiliations.sql', 'utf8').split('CREATE VIEW')[0];
const review = readFileSync('scripts/ops/review-cam-talbot-affiliation-20260919.sql', 'utf8');
const prior = 'b7ecc553-0b26-4daf-8ba0-6bb8c1b15b15';
async function setup() {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(schema);
  await db.exec(`
    CREATE TABLE player_directory(season int,player_id int,team_abbrev text);
    INSERT INTO player_directory VALUES (2026,8475660,'CBJ');
    INSERT INTO player_affiliation_events(id,season,player_id,status,authority,effective_on,source_urls,reason,recorded_by)
      VALUES ('${prior}',2026,8475660,'free_agent','official_roster','2026-09-10','["https://www.nhl.com"]','Earlier unsigned review','test');
    CREATE VIEW player_current_directory AS SELECT DISTINCT ON(season,player_id)
      season,player_id,team_abbrev,jsonb_build_object('event_id',id,'status',status) as current_affiliation
      FROM player_affiliation_events ORDER BY season,player_id,sequence DESC;
  `);
  return db;
}

test('operator review defaults to rollback; explicit commit appends and preserves prior evidence', async () => {
  const db = await setup();
  try {
    await db.exec(review);
    assert.equal((await db.query('SELECT count(*)::int as n FROM player_affiliation_events')).rows[0].n, 1);
    await db.exec(review.replace(/ROLLBACK;\s*$/, 'COMMIT;'));
    const rows = (await db.query('SELECT status,team_abbrev,supersedes,authority FROM player_affiliation_events ORDER BY sequence')).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'free_agent');
    assert.deepEqual(rows[1], {status: 'affiliated', team_abbrev: 'CBJ', supersedes: prior, authority: 'official_transaction'});
    await assert.rejects(db.exec(review), /changed since review/);
    await db.exec('ROLLBACK');
  } finally {await db.close();}
});

test('a changed roster feed requires fresh review and never appends an event', async () => {
  const db = await setup();
  try {
    await db.exec("UPDATE player_directory SET team_abbrev='DET'");
    await assert.rejects(db.exec(review), /feed changed since review/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int as n FROM player_affiliation_events')).rows[0].n, 1);
  } finally {await db.close();}
});

test('a serving view ignoring the appended evidence prevents commit', async () => {
  const db = await setup();
  try {
    await db.exec(`CREATE OR REPLACE VIEW player_current_directory AS SELECT
      season,player_id,team_abbrev,jsonb_build_object('event_id',id,'status',status) as current_affiliation
      FROM player_affiliation_events WHERE id='${prior}'`);
    await assert.rejects(db.exec(review.replace(/ROLLBACK;\s*$/, 'COMMIT;')), /did not reach current identity/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int as n FROM player_affiliation_events')).rows[0].n, 1);
  } finally {await db.close();}
});
