import { describe, expect, it } from 'vitest';
import { buildWriteupFromSources, writeupExtrasFromSources } from '../../playerWriteup/fromIndex';
import { generatePlayerWriteup } from '../../playerWriteup';
import type { DashboardIndexEntry } from '../../types/playerDashboard';

const now = new Date('2026-09-12T12:00:00Z');
const base = { id: 1, name: 'Sample Forward', position: 'C', actuals_season: 2025,
  projection_season: 2026, as_of: '2026-09-10T12:00:00Z', gp: 80, goals: 30, assists: 50, points: 80,
  sog: 240, proj_gp: 83, proj_goals: 35, proj_assists: 55,
} as DashboardIndexEntry;
const canonical = {
  revision: 'review-r2', run_id: 'published-run-1',
  availability: { status: 'out', authority: 'verified', as_of: '2026-09-11T18:00:00Z',
    reason: 'The club reported an upper-body injury.', review_after: '2026-09-15T12:00:00Z', return_window: null,
    source: { evidence_url: 'https://example.com/player-update', purpose: 'Club availability update' } },
  role: null, sources: [], team_notes: [],
};

const sources = (context?: unknown) => ({
  entry: { ...base, ...(context ? { canonical_context: context } : {}) } as DashboardIndexEntry, index: [base], now,
  scoring: { skater: { goals: 4, assists: 2 } },
});

describe('published canonical context in the shared writing pipeline', () => {
  it('consumes optional published context with revision and original source clocks', () => {
    const s = sources(canonical);
    const w = buildWriteupFromSources(s);
    expect(w.summary).toContain('Verified availability record');
    expect(w.summary).toContain('2026-09-11');
    expect(w.summary).toContain('upper-body injury');
    expect(w.sourceContext).toMatchObject({ actualsSeason: 2025, projectionSeason: 2026,
      indexAsOf: '2026-09-10T12:00:00Z', canonicalRevision: 'review-r2', canonicalRunId: 'published-run-1' });
    expect(w.canonicalSources).toContainEqual(canonical.availability.source);
  });

  it('preserves the same forecast under verified versus imported availability', () => {
    const plain = buildWriteupFromSources(sources());
    const snapshot = JSON.stringify(canonical);
    const verified = buildWriteupFromSources(sources(canonical));
    const imported = buildWriteupFromSources(sources({ ...canonical,
      availability: { ...canonical.availability, authority: 'imported_scenario' } }));
    const projection = (s: string) => s.match(/Projects to [^.]+\./)?.[0];
    expect(projection(verified.analysis)).toBe(projection(plain.analysis));
    expect(projection(imported.analysis)).toBe(projection(plain.analysis));
    expect(projection(plain.analysis)).toContain('83 games');
    expect(imported.summary).toContain('not a verified status');
    expect(JSON.stringify(canonical)).toBe(snapshot);
  });

  it('the bundle consumes the same adapter and optional source absence stays safe', () => {
    const s = sources(canonical);
    const assembled = writeupExtrasFromSources(s);
    const bundle = generatePlayerWriteup({ id: 1, name: 'Sample Forward', position: 'C', statsSeason: 2025,
      stats: { gamesPlayed: 80, goals: 30, assists: 50, points: 80, shots: 240 } }, assembled);
    expect(bundle.summary).toBe(buildWriteupFromSources(s).summary);
    expect(bundle.sourceContext).toEqual(buildWriteupFromSources(s).sourceContext);
    expect(buildWriteupFromSources(sources()).summary).not.toContain('availability record');
  });

  it('expired or uncertain imported evidence cannot become a current medical fact', () => {
    const w = buildWriteupFromSources(sources({ ...canonical, availability: {
      ...canonical.availability, review_after: '2026-09-12T11:00:00Z', authority: 'verified' } }));
    expect(w.summary).not.toContain('upper-body injury');
    expect(w.sourceContext?.canonicalRevision).toBe('review-r2');
    expect(w.canonicalSources).toContainEqual(canonical.availability.source);
  });
});
