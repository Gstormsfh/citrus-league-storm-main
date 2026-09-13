/** Published per-player context only. Unknown fields remain untrusted data. */
export interface EditorialCanonicalContext {
  revision?: string;
  run_id?: string;
  availability?: Record<string, unknown> | null;
  role?: Record<string, unknown> | null;
  sources?: readonly unknown[];
  team_notes?: unknown;
}

export interface CanonicalEditorialResult {
  summary: string;
  availabilityExplanation?: string;
  analysis: string;
  sources: Record<string, unknown>[];
  revision?: string;
  runId?: string;
  availability?: { status: string; authority: 'verified' | 'imported_scenario' | 'reviewed_report'; asOf: string };
  /** Whether the model used role conditioning; not a claim about role certainty. */
  role?: { conditioned?: boolean };
}

const MAX_AGE_MS = 14 * 86400000;
const instruction = /ignore\s+(?:(?:all|previous|prior|above)\s+)*instructions|system\s*(?:prompt|message)|developer\s+message|you are (?:an? |the )?(?:assistant|chatgpt)|<\/?(?:system|assistant)|output exactly|follow (?:these|my) instructions|guaranteed\s+(?:return|points)|\b(?:javascript|data):/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function text(value: unknown, max = 180): string | null {
  if (typeof value !== 'string' || instruction.test(value) || /<[^>]+>/.test(value)) return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[—–]/g, ', ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, '').trimEnd()}…`;
}

/** Dates belong to their evidence, never the context activation or stat season. */
function freshDate(value: unknown, reviewAfter: unknown, now: Date): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const at = Date.parse(value);
  const age = now.getTime() - at;
  if (!Number.isFinite(at) || !Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;
  if (reviewAfter != null) {
    const review = typeof reviewAfter === 'string' ? Date.parse(reviewAfter) : NaN;
    if (!Number.isFinite(review) || review <= now.getTime()) return null;
  }
  return new Date(at).toISOString().slice(0, 10);
}

/** Preserve supplied locator/hash/URL provenance; never manufacture article URLs. */
function source(value: unknown): Record<string, unknown> | null {
  if (!record(value)) return null;
  const adopted = value.confirmation_scope === 'owner_adopted_workbook_baseline';
  const input = { ...value, evidence_url: value.evidence_url ?? value.url, sha256: value.sha256 ?? (adopted ? value.workbook_sha256 : undefined) };
  const out: Record<string, unknown> = {};
  // Source objects are provenance, not freeform instructions or executable links.
  for (const key of ['file', 'sha256', 'locator', 'evidence_url', 'purpose', 'name', 'published_at', 'as_of']) {
    const limit = key === 'evidence_url' || key === 'file' ? 1000 : 240;
    const raw = input[key];
    const field = text(raw, limit);
    // Hashes, filenames, locators and URLs must not be clipped or rewritten.
    if (field && typeof raw === 'string' && raw.length <= limit && !/[\u0000-\u001f\u007f]/.test(raw)) out[key] = raw.trim();
    else if (input[key] != null) return null;
  }
  if (typeof out.evidence_url === 'string') {
    try {
      const url = new URL(out.evidence_url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    } catch { return null; }
  }
  return out.evidence_url || (out.file && (out.sha256 || out.locator)) ? out : null;
}

function sourceLabel(provenance: Record<string, unknown>): string {
  if (typeof provenance.evidence_url === 'string') return new URL(provenance.evidence_url).hostname.replace(/^www\./, '');
  const file = String(provenance.file).split(/[\\/]/).pop();
  return `${file}${provenance.locator ? `, ${provenance.locator}` : ''}`;
}

function evidenceSources(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value.slice(0, 50) : [value]).map(source).filter((s): s is Record<string, unknown> => s !== null);
}

const STATUS: Record<string, string> = {
  injured: 'listed injured', active: 'listed active', out: 'listed out', ir: 'listed on injured reserve',
  ltir: 'listed on long-term injured reserve', day_to_day: 'listed day-to-day', suspended: 'listed suspended',
};

/**
 * Interpret provenance, not forecasts. No rate, game count or return window is
 * computed or mutated. Imported rows remain assumptions even after publication.
 */
export function canonicalEditorialContext(
  player: { id: number | string; name: string },
  context: EditorialCanonicalContext | null | undefined,
  now: Date = new Date(),
): CanonicalEditorialResult {
  const result: CanonicalEditorialResult = { summary: '', analysis: '', sources: [] };
  if (!record(context) || !Number.isFinite(now.getTime())) return result;
  const name = text(player?.name, 100);
  if (!name || name.split(/\s+/).length < 2 || !Number.isFinite(Number(player.id))) return result;
  const revision = text(context.revision, 120);
  const runId = text(context.run_id, 120);
  if (!revision || !runId) return result;
  if (revision) result.revision = revision;
  if (runId) result.runId = runId;
  const summaries: string[] = [];
  const analysis: string[] = [];
  const seen = new Set<string>();
  const retain = (sources: Record<string, unknown>[]) => {
    for (const item of sources) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) { result.sources.push(item); seen.add(key); }
    }
  };
  // Root records remain provenance metadata even when the dated claim expires.
  const rootSources = evidenceSources(context.sources);
  retain(rootSources);
  const availability = record(context.availability) ? context.availability : null;
  if (availability) {
    const provenance = source(availability.source);
    if (provenance) retain([provenance]);
    const date = freshDate(availability.as_of, availability.review_after, now);
    const status = typeof availability.status === 'string' && Object.prototype.hasOwnProperty.call(STATUS, availability.status) ? STATUS[availability.status] : null;
    const reason = text(availability.reason, 1400);
    const reasonSafe = availability.reason == null || reason !== null;
    if (date && provenance && status && reasonSafe && ['verified', 'imported_scenario', 'reviewed_report'].includes(String(availability.authority))) {
      const scenario = availability.authority === 'imported_scenario';
      const reviewed = availability.authority === 'reviewed_report';
      const adopted = record(availability.source) && availability.source.confirmation_scope === 'owner_adopted_workbook_baseline';
      const label = adopted ? 'Owner-maintained availability baseline' : reviewed ? 'Reviewed availability record' : scenario ? 'Imported availability scenario, not a verified status' : 'Verified availability record';
      summaries.push(`${label} (${date}; ${sourceLabel(provenance)}): ${name} ${status}.${reason ? ` ${scenario ? 'Scenario reason' : adopted ? 'Baseline context' : 'Reported reason'}: ${reason.replace(/[.!?]+$/, '')}.` : ''}`);
      if (adopted) {
        const rawNote = record(context.role) ? context.role.notes : null;
        const note = text(rawNote, 1800);
        const historical = note?.split('Historical forecast reasoning:')[1]?.trim();
        if (historical) summaries.push(`Historical workload assumption, not a current recovery forecast: ${historical}`);
        summaries.push('Return timing is unconfirmed. Current IR, LTIR, OUT and INJ status qualifies for fantasy IR slots.');
      }
      result.availabilityExplanation = summaries.join(' ');
      result.availability = { status: String(availability.status), authority: reviewed ? 'reviewed_report' : scenario ? 'imported_scenario' : 'verified', asOf: new Date(String(availability.as_of)).toISOString() };
    }
  }

  const role = record(context.role) ? context.role : null;
  if (role) {
    const evidence = evidenceSources(role.evidence);
    const provenance = evidence.length ? evidence : rootSources;
    retain(evidence);
    const line = text(role.line, 80) ?? (typeof role.line === 'number' && Number.isFinite(role.line) ? String(role.line) : null);
    const pp = text(role.pp, 80) ?? (typeof role.pp === 'number' && Number.isFinite(role.pp) ? String(role.pp) : null);
    const notes = availability?.authority === 'reviewed_report' ? null : text(role.notes);
    if (typeof role.conditioned === 'boolean') result.role = { conditioned: role.conditioned };
    const safe = [role.line, role.pp, role.notes].every(value => typeof value !== 'string' || text(value) !== null);
    // Role has no authoritative deployment flag. Even a sourced published row
    // cannot promote it from a scenario to a current line/PP assignment.
    const roleDateSafe = role.as_of == null && role.review_after == null || freshDate(role.as_of, role.review_after, now) !== null;
    if (safe && roleDateSafe && provenance.length && (line || pp || notes)) {
      const parts = [line ? `line: ${line}` : null, pp ? `power play: ${pp}` : null, notes ? `note: ${notes}` : null].filter(Boolean);
      analysis.push(`Imported role scenario, not verified deployment (${sourceLabel(provenance[0])}): ${parts.join('; ')}.`);
    }
  }

  const notes = Array.isArray(context.team_notes) ? context.team_notes : [];
  const subject = new RegExp(`^${escapeRe(fold(name)).replace(/\s+/g, '\\s+')}\\s+(?!jr\\b|sr\\b)`, 'i');
  for (const note of notes.slice(0, 40)) {
    if (!record(note) || !['verified', 'imported_scenario'].includes(String(note.authority))) continue;
    const ids = Array.isArray(note.player_ids) ? note.player_ids : note.player_id != null ? [note.player_id] : null;
    if (ids && !ids.some(id => Number(id) === Number(player.id))) continue;
    const raw = text(note.text ?? note.note ?? note.notes ?? note.body, 600);
    const date = freshDate(note.as_of ?? note.published_at, note.review_after, now);
    const provenance = source(note.source);
    if (!raw || !date || !provenance) continue;
    // A tagged team roundup cannot transfer another subject's injury. Keep
    // only a sentence that starts with this player's full name; no pronouns.
    const sentence = raw.split(/(?<=[.!?])\s+|[;\n]/).find(part => subject.test(fold(part.trim())));
    const limited = text(sentence, 180);
    if (!limited || /\b(?:with|while|whereas|but)\b/i.test(limited)) continue;
    // Reject a second named subject, even after a player-matched sentence lead.
    if (/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(limited.slice(name.length))) continue;
    retain([provenance]);
    analysis.push(`${note.authority === 'verified' ? 'Attributed player note' : 'Imported team-note scenario, not verified reporting'} (${date}; ${sourceLabel(provenance)}): ${limited.replace(/[.!?]+$/, '')}.`);
    break;
  }
  result.summary = summaries.join(' ');
  result.analysis = analysis.join(' ');
  return result;
}
