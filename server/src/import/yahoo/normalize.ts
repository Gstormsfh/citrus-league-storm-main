/**
 * Yahoo's JSON is a literal transliteration of its XML: an element with
 * children becomes an array of single-key objects, a collection becomes an
 * object keyed "0", "1", ... with a `count`, repeated elements become an
 * array of same-key objects, and numbers arrive as strings. `unpack` turns
 * that into plain objects and arrays once, so the parser reads
 * `league.settings.stat_categories.stats[0].stat_id` instead of walking arrays.
 *
 * Rules, in order, for an array:
 *   1. Every item is an object with exactly one key, all keys the same, and
 *      either there are several of them or that key is the singular of the
 *      parent key (managers > manager, stats > stat)
 *      -> a list of the inner values          [{stat},{stat}]  -> [stat, stat]
 *   2. Every item is an object or array and no field name repeats
 *      -> one merged object                    [{team_key},{name}] -> {team_key, name}
 *   3. Otherwise -> the array with each item unpacked
 * For an object whose keys are all digits plus an optional `count`:
 *   -> an array in numeric order, each entry unwrapped from its singular element
 *      name                                    {"0": {team}, "1": {team}, count: 2}
 * A numeric key beside named keys is XML's child element: its fields are merged
 * into the object                             {week, "0": {matchups}} -> {week, matchups}
 *
 * Empty arrays (Yahoo's placeholders inside a team element) merge to nothing.
 * Nothing here knows what a team or a league is; it is shape only.
 */

type Json = unknown;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function unpack(node: Json, parentKey: string | null = null): Json {
  if (Array.isArray(node)) return unpackArray(node, parentKey);
  if (isPlainObject(node)) return unpackObject(node, parentKey);
  return node;
}

function isSingularOf(key: string, parent: string | null): boolean {
  if (!parent) return false;
  return `${key}s` === parent || (key.endsWith('y') && `${key.slice(0, -1)}ies` === parent);
}

function unpackArray(arr: unknown[], parentKey: string | null): Json {
  if (arr.length === 0) return {};

  // Rule 1: repeated single-key elements are a list.
  const singleKeys = arr.map((raw) => (isPlainObject(raw) && Object.keys(raw).length === 1 ? Object.keys(raw)[0] : null));
  const oneKey = singleKeys.every((k) => k !== null) && new Set(singleKeys).size === 1 ? (singleKeys[0] as string) : null;
  if (oneKey && (arr.length > 1 || isSingularOf(oneKey, parentKey))) {
    return arr.map((raw) => unpack((raw as Record<string, unknown>)[oneKey], oneKey));
  }

  const items = arr.map((raw) => unpack(raw, parentKey));

  // Rule 2: a bag of distinct fields (possibly nested bags) is one object.
  if (items.every((it) => isPlainObject(it))) {
    const seen = new Set<string>();
    let distinct = true;
    for (const it of items as Record<string, unknown>[]) {
      for (const k of Object.keys(it)) {
        if (seen.has(k)) { distinct = false; break; }
        seen.add(k);
      }
      if (!distinct) break;
    }
    if (distinct) return Object.assign({}, ...(items as Record<string, unknown>[]));
  }

  // Rule 3.
  return items;
}

function unpackObject(obj: Record<string, unknown>, parentKey: string | null): Json {
  const keys = Object.keys(obj);
  const numeric = keys.filter((k) => /^\d+$/.test(k));
  if (numeric.length > 0 && keys.every((k) => /^\d+$/.test(k) || k === 'count')) {
    // A collection: {"0": {team: [...]}, "1": {team: [...]}, count: 2}. Each
    // entry is wrapped in the singular element name; unwrap it.
    return numeric
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => {
        const entry = obj[k];
        if (isPlainObject(entry)) {
          const ks = Object.keys(entry);
          if (ks.length === 1 && isSingularOf(ks[0], parentKey)) return unpack(entry[ks[0]], ks[0]);
        }
        return unpack(entry, parentKey);
      });
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    // A numeric key beside named ones ({week: "12", "0": {matchups: ...}}) is
    // XML's child element; its fields belong to this object.
    if (/^\d+$/.test(k)) {
      const inner = unpack(v, parentKey);
      if (isPlainObject(inner)) { Object.assign(out, inner); continue; }
    }
    out[k] = unpack(v, k);
  }
  return out;
}

/** Numbers arrive as strings ("144", ".578", "1"); "-" is Yahoo's null. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function bool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true') return true;
  if (s === '0' || s === 'false') return false;
  return null;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Ensure a list even when a lone element was unpacked into a bare object. */
export function asList<T = unknown>(v: unknown): T[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v as T[];
  if (isPlainObject(v) && Object.keys(v).length === 0) return [];
  return [v as T];
}
