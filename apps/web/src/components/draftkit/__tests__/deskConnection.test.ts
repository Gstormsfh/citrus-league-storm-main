import { describe, expect, it } from 'vitest';
import { projectionSettings } from '@citrus/shared';
import { deskPlayerId, deskScoringDifferences, liveDeskProgress, readDeskFile, validateDeskProgress, validateKit } from '../deskConnection';
import { deskFixture } from './deskFixture';

describe('Connected desk file boundary', () => {
  it('preserves the remaining-season basis through a session backup and rejects unknown bases', () => {
    const file = deskFixture(); file.kit.projectionBasis = 'remaining_season';
    expect(readDeskFile(JSON.stringify(file))).toEqual(file);
    expect(() => validateKit({ ...file.kit, projectionBasis: 'made-up' })).toThrow();
  });
  it('accepts a session and preserves every imported rank and number', () => {
    const file = deskFixture();
    expect(readDeskFile(JSON.stringify(file))).toEqual(file);
  });
  it('accepts optional signed plus/minus without breaking older editions or allowing goalie plus/minus', () => {
    const file = deskFixture();
    expect(readDeskFile(JSON.stringify(file))).toEqual(file);
    file.kit.weights.skater.plus_minus = -2;
    for (const player of file.kit.players) if (!player.goalie) player.totals.plus_minus = -12;
    expect(readDeskFile(JSON.stringify(file))).toEqual(file);
    delete file.kit.players[0].totals.plus_minus;
    expect(() => readDeskFile(JSON.stringify(file))).toThrow();
    file.kit.weights.skater.plus_minus = 0;
    expect(readDeskFile(JSON.stringify(file))).toEqual(file);
    file.kit.weights.goalie.plus_minus = 1;
    expect(() => readDeskFile(JSON.stringify(file))).toThrow();
  });
  it('extracts JSON from the original HTML without interpreting any executable markup', () => {
    const file = deskFixture();
    const html = `<html><img src="https://invalid.test"><script>throw Error('never run')</script><script id="kit-data" type="application/json">${JSON.stringify(file.kit)}</script></html>`;
    expect(readDeskFile(html).kit).toEqual(file.kit);
    expect(readDeskFile(html).progress.rows).toEqual([]);
  });
  it('rejects missing, ambiguous and oversize payloads', () => {
    for (const s of ['{}', '<html></html>', 'x'.repeat(1_000_001), '<script id="kit-data" type="application/json">{}</script>'.repeat(2)]) expect(() => readDeskFile(s)).toThrow();
  });
  it('rejects malformed IDs, duplicate players, reordered ranks and non-finite numbers', () => {
    for (const change of [
      (f: ReturnType<typeof deskFixture>) => { f.kit.players[0].key = 'Connor McDavid'; },
      (f: ReturnType<typeof deskFixture>) => { f.kit.players[1].key = f.kit.players[0].key; },
      (f: ReturnType<typeof deskFixture>) => { f.kit.players[0].rank = 4; },
      (f: ReturnType<typeof deskFixture>) => { f.kit.players[0].points = Infinity; },
      (f: ReturnType<typeof deskFixture>) => { f.kit.weights.skater.hits = NaN; },
    ]) { const f = deskFixture(); change(f); expect(() => validateKit(f.kit)).toThrow(); }
    expect(deskPlayerId('canonical:8478402')).toBe('8478402');
    expect(() => deskPlayerId('canonical:08478402')).toThrow();
  });
  it('requires progress identity and rejects unknown IDs and long notes', () => {
    const { kit, progress } = deskFixture();
    for (const value of [{ ...progress, fingerprint: 'c'.repeat(64) }, { ...progress, rows: [...progress.rows, ...progress.rows] },
      { ...progress, rows: [{ ...progress.rows[0], note: 'x'.repeat(501) }] },
      { ...progress, rows: [{ ...progress.rows[0], key: 'canonical:999' }] }]) expect(() => validateDeskProgress(value, kit)).toThrow();
  });
  it('compares all scoring fields, including unsupported categories, without rescoring', () => {
    const { kit } = deskFixture();
    const same = projectionSettings(kit.weights);
    expect(deskScoringDifferences(kit, same)).toEqual([]);
    same.skater.hits = 2; same.skater.faceoff_wins = 1;
    expect(deskScoringDifferences(kit, same)).toEqual(['skater: hits', 'skater: faceoff wins']);
    expect(kit.players[0].points).toBe(900);
  });
  it('server availability replaces manual marks, reverses undos and preserves targets and notes', () => {
    const { kit, progress } = deskFixture();
    expect(liveDeskProgress(kit, progress.rows, new Set()).rows[0]).toEqual({ ...progress.rows[0], drafted: false });
    const selected = liveDeskProgress(kit, progress.rows, new Set(['8478402', '9999999']));
    expect(selected.rows[0]).toEqual(progress.rows[0]);
    expect(selected.rows).toHaveLength(2);
    expect(liveDeskProgress(kit, selected.rows, new Set()).rows[0]).toEqual({ ...progress.rows[0], drafted: false });
  });
});
