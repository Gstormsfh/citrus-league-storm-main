import type { ScoringSettings } from '@citrus/shared';

export interface DeskPlayer {
  key: string; name: string; team: string; position: string; rank: number;
  points: number; games: number | null; goalie: boolean; totals: Record<string, number>;
  research?: Array<{headline:string;body:string;date:string;kind:'history'|'season';sources:Array<{label:string;url:string}>}>;
}
export interface DeskKit {
  version: 1; fingerprint: string; revision: string; projectionDate: string; league: string;
  projectionBasis?: 'remaining_season';
  weights: Record<'skater' | 'goalie', Record<string, number>>; players: DeskPlayer[];
}
export interface DeskRow { key: string; drafted: boolean; target: boolean; note: string }
export interface DeskProgress { version: 1; fingerprint: string; rows: DeskRow[] }
export interface DeskFile { kind: 'citrus-connected-desk'; version: 1; kit: DeskKit; progress: DeskProgress }
export const MAX_DESK_FILE_BYTES = 1_000_000;
const fields = {
  skater: ['goals', 'assists', 'power_play_points', 'short_handed_points', 'shots_on_goal', 'blocks', 'hits', 'penalty_minutes'],
  goalie: ['wins', 'shutouts', 'saves', 'goals_against'],
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function invalid(): never { throw Error('This is not a supported Citrus draft desk. Your current desk has not changed.'); }

/** Strict ID conversion. Never match player names or silently drop unresolved identities. */
export function deskPlayerId(key: string): string {
  const match = /^canonical:([1-9]\d{0,9})$/.exec(key);
  if (!match) return invalid();
  return match[1];
}

export function validateKit(raw: unknown): DeskKit {
  if (!object(raw) || raw.version !== 1 || !digest(raw.fingerprint) || !digest(raw.revision)
    || !text(raw.league, 128) || typeof raw.projectionDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(raw.projectionDate) || !object(raw.weights)
    || (raw.projectionBasis !== undefined && raw.projectionBasis !== 'remaining_season')
    || !Array.isArray(raw.players) || raw.players.length < 1 || raw.players.length > 300) return invalid();
  const weights = {} as DeskKit['weights'];
  for (const group of ['skater', 'goalie'] as const) {
    const values = raw.weights[group];
    // Plus/minus is optional in older offline editions. Preserve their exact
    // weights/fingerprint rather than rewriting a saved desk on import.
    if (!object(values) || fields[group].some(key => !(key in values))
      || Object.keys(values).some(key => !fields[group].includes(key) && !(group === 'skater' && key === 'plus_minus'))
      || Object.values(values).some(v => !finite(v) || Math.abs(v) > 10000)) return invalid();
    weights[group] = { ...values } as Record<string, number>;
  }
  const keys = new Set<string>();
  const players = raw.players.map((p, i): DeskPlayer => {
    if (!object(p) || typeof p.key !== 'string' || keys.has(p.key) || p.rank !== i + 1
      || !text(p.name, 120) || !text(p.team, 12) || !text(p.position, 12)
      || !finite(p.points) || (p.games !== null && (!finite(p.games) || p.games < 0))
      || typeof p.goalie !== 'boolean' || !object(p.totals)
      || Object.keys(p.totals).length > 40
      || Object.entries(p.totals).some(([k, v]) => !/^[a-z_]{1,40}$/.test(k) || !finite(v))) return invalid();
    if (!p.goalie && weights.skater.plus_minus && !finite(p.totals.plus_minus)) return invalid();
    let research:DeskPlayer['research'];
    if(p.research!==undefined){
      if(!Array.isArray(p.research)||p.research.length>3)return invalid();
      research=p.research.map(item=>{
        if(!object(item)||!text(item.headline,180)||!text(item.body,5000)||!['history','season'].includes(String(item.kind))
          ||typeof item.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(item.date)||!Array.isArray(item.sources)||item.sources.length>8)return invalid();
        const sources=item.sources.map(source=>{
          if(!object(source)||!text(source.label,160)||!text(source.url,2000))return invalid();
          try{const url=new URL(source.url);if(url.protocol!=='https:'||url.username||url.password)return invalid();}catch{return invalid();}
          return {label:source.label,url:source.url};
        });
        return {headline:item.headline,body:item.body,date:item.date,kind:item.kind as 'history'|'season',sources};
      });
    }
    deskPlayerId(p.key); keys.add(p.key);
    return { key: p.key, name: p.name, team: p.team, position: p.position, rank: p.rank as number,
      points: p.points, games: p.games as number | null, goalie: p.goalie, totals: { ...p.totals } as Record<string, number>,...(research?{research}:{}) };
  });
  return { version: 1, fingerprint: raw.fingerprint, revision: raw.revision, projectionDate: raw.projectionDate,
    ...(raw.projectionBasis === 'remaining_season' ? { projectionBasis: 'remaining_season' as const } : {}),
    league: raw.league, weights, players };
}

export function validateDeskProgress(raw: unknown, kit: DeskKit): DeskProgress {
  if (!object(raw) || raw.version !== 1 || raw.fingerprint !== kit.fingerprint || !Array.isArray(raw.rows)
    || raw.rows.length > 300) throw Error('Progress belongs to a different desk, or the file is invalid.');
  const allowed = new Set(kit.players.map(p => p.key)), seen = new Set<string>();
  const rows = raw.rows.map((r): DeskRow => {
    if (!object(r) || typeof r.key !== 'string' || !allowed.has(r.key) || seen.has(r.key)
      || typeof r.drafted !== 'boolean' || typeof r.target !== 'boolean' || typeof r.note !== 'string'
      || r.note.length > 500) return invalid();
    seen.add(r.key);
    return { key: r.key, drafted: r.drafted, target: r.target, note: r.note };
  });
  return { version: 1, fingerprint: kit.fingerprint, rows };
}

/** Extract ONLY JSON from our existing HTML download. Never mount, parse as DOM or execute the HTML. */
export function readDeskFile(content: string): DeskFile {
  if (content.length > MAX_DESK_FILE_BYTES) throw Error('Draft desk files must be smaller than 1 MB.');
  if (content.trimStart().startsWith('<')) {
    const matches = [...content.matchAll(/<script id="kit-data" type="application\/json">([\s\S]*?)<\/script>/g)];
    if (matches.length !== 1) return invalid();
    const kit = validateKit(JSON.parse(matches[0][1]));
    return { kind: 'citrus-connected-desk', version: 1, kit, progress: { version: 1, fingerprint: kit.fingerprint, rows: [] } };
  }
  const raw: unknown = JSON.parse(content);
  if (!object(raw) || raw.kind !== 'citrus-connected-desk' || raw.version !== 1) return invalid();
  const kit = validateKit(raw.kit);
  return { kind: 'citrus-connected-desk', version: 1, kit, progress: validateDeskProgress(raw.progress, kit) };
}

/** Compare weights, not points. Scoring stays in the existing Citrus scorer. */
export function deskScoringDifferences(kit: DeskKit, scoring: ScoringSettings): string[] {
  return (['skater', 'goalie'] as const).flatMap(group =>
    [...new Set([...Object.keys(kit.weights[group]), ...Object.keys(scoring[group])])]
      .filter(stat => (kit.weights[group][stat] ?? 0) !== (scoring[group][stat] ?? 0))
      .map(stat => `${group}: ${stat.replace(/_/g, ' ')}`));
}

/** In live mode the server replaces manual drafted flags, including undo and reset. Notes remain local. */
export function liveDeskProgress(kit: DeskKit, rows: DeskRow[], unavailableIds: ReadonlySet<string>): DeskProgress {
  const notes = new Map(rows.map(r => [r.key, r]));
  return { version: 1, fingerprint: kit.fingerprint, rows: kit.players.map(p => ({ key: p.key,
    drafted: unavailableIds.has(deskPlayerId(p.key)), target: notes.get(p.key)?.target ?? false,
    note: notes.get(p.key)?.note ?? '' })) };
}
