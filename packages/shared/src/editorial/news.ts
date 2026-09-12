/** Only publisher text is evidence. Generated `summary` is deliberately absent. */
export interface EditorialNewsItem {
  player_ids: readonly number[];
  title: string;
  snippet?: string | null;
  url: string;
  source_id: string;
  published_at: string;
}
export interface EditorialNewsEvidence {
  kind: 'practice' | 'out' | 'uncertain' | 'cleared' | 'power-play' | 'transaction' | 'starter';
  source: string;
  url: string;
  publishedAt: string;
  report: string;
  implication: string;
}
export const EDITORIAL_NEWS_MAX_AGE_MS = 14 * 86400000;
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’]/g, "'");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const instructions = /\b(?:ignore|disregard|override)\b.{0,60}\b(?:instructions?|prompts?|rules?)\b|ignore\s+(?:all\s+|previous\s+|prior\s+)?instructions|system\s*(?:prompt|message)|you are (?:an? |the )?(?:assistant|chatgpt)|<\/?(?:system|assistant)|guaranteed\s+(?:return|points)|output exactly/i;

// A small deterministic parser cannot resolve editorial hypotheticals or a
// retrospective inside fresh news. Omission is safer than inventing certainty.
const qualified = /\?|\b(?:if|unless|could|might|may|should|would|rumou?rs?|reportedly|speculat\w*|denied|denies|false|untrue|not|never|wasn't|isn't|hasn't|didn't|won't|but|however|since)\b/i;
const retrospective = /\b(?:19|20)\d{2}\b|\b(?:last (?:season|year|month)|previous (?:season|year)|years? ago|look(?:ing)? back|retrospective|remember when)\b/i;
const healthSignal = /\b(?:injur\w*|healthy|health|ready|clear\w*|available|availability|unavailable|practice|practiced|skating|skated|questionable|day.to.day|timetable|ruled out|sidelined)\b/i;

function subjectTails(text: string, name: string): string[] {
  if (!name.trim() || name.trim().split(/\s+/).length < 2) return [];
  const subject = escapeRe(fold(name.trim())).replace(/\s+/g, '\\s+');
  return fold(text).split(/[.!?;\n]+/).flatMap(clause => {
    // Full name must be the grammatical subject, not inside a quotation,
    // hypothetical, possessive, or a clause about somebody else.
    const match = new RegExp(`^\\s*${subject}\\s+(.+)$`).exec(clause);
    return match ? [match[1].trim()] : [];
  });
}

export function canonicalNewsUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
    return u.toString().replace(/\/$/, '');
  } catch { return null; }
}

/**
 * Conservative subject predicates, not a keyword bag. A tagged roundup about
 * two players cannot transfer one player's injury to the other. Unknown or
 * speculative language is omitted rather than promoted to confirmed news.
 */
function eventFor(text: string, name: string): Pick<EditorialNewsEvidence, 'kind' | 'report' | 'implication'> | null {
  if (instructions.test(text)) return null;
  // A separate statement that no return date was announced does not negate
  // the direct injury/practice report, and cannot supply a medical timeline.
  const qualifications = text.replace(/(?:the team |the club |he )?(?:did not|has not|hasn't) (?:announce|announced|provide|provided) (?:a |an? exact )?(?:return date|timetable)[^.!?]*[.!?]?/gi, '');
  if (qualified.test(qualifications) || retrospective.test(text)) return null;
  const tails = subjectTails(text, name);
  // Multiple conflicting health statements cannot be resolved by first-match
  // order. Suppress the story and let the latest-health barrier below apply.
  const healthStates = new Set(tails.flatMap(tail => {
    if (!healthSignal.test(tail)) return [];
    if (/clear|healthy|ready|activated/.test(tail)) return ['clear'];
    if (/ruled out|sidelined|out with|injured reserve/.test(tail)) return ['out'];
    if (/practice|practiced|skating|skated/.test(tail)) return ['practice'];
    return ['unknown'];
  }));
  if (healthStates.size > 1) return null;
  for (const tail of tails) {
    if (/^(?:(?:(?:was|is|has been) )?ruled out (?:a |as |the possibility)|(?:signed|signs) with (?:fans|supporters))/.test(tail)) continue;
    if (/^(?:could|might|may|should|would|will not|won't|did not|didn't|is not|isn't|has not|hasn't|not|unlikely|hopes|expected|reportedly)/.test(tail)) continue;
    if (/^(?:(?:is|remains|was)\s+)?(?:day.to.day|questionable|a game.time decision)|^(?:has|faces)\s+no\s+(?:return\s+)?timetable/.test(tail)) return {
      kind: 'uncertain', report: 'has an uncertain availability report',
      implication: 'Citrus read: availability remains unresolved; verify game status before committing a lineup spot. This report does not establish a return date.',
    };
    if (/^(?:(?:has been|was|is|remains)\s+)?(?:ruled out\b|sidelined\b|out with (?:an? )?(?:injury|illness|upper.body|lower.body|concussion)|out indefinitely\b|out for (?:the (?:season|game)|tonight|(?:\d+|one|two|three|four|several) (?:days?|weeks?|months?|games?))\b|placed on injured reserve\b)/.test(tail)) return {
      kind: 'out', report: 'was reported unavailable',
      implication: 'Citrus read: the immediate issue is access to games, not a change in scoring ability. Check for a newer clearance report before starting him.',
    };
    if (/^(?:(?:has|is|was)\s+)?(?:returned? to practice|returns? to practice|practiced|practising|practicing|skated|skating)/.test(tail) && !/first (?:power.play )?unit|top (?:power.play )?unit/.test(tail)) return {
      kind: 'practice', report: 'took part in practice or skating',
      implication: 'Citrus read: practice is a step to monitor, not game clearance. Confirm availability and any workload restriction before using the roster spot.',
    };
    if (/^(?:(?:has been|was|is)\s+)?(?:cleared to play|cleared for (?:a |the )?return|activated from injured reserve)/.test(tail)) return {
      kind: 'cleared', report: 'received a clearance or activation update',
      implication: 'Citrus read: clearance improves availability, but the first game back still needs a confirmed lineup place and workload.',
    };
    if (/^(?:(?:is|was|has been)\s+)?(?:skating|practicing|practising|working|practiced|worked|promoted|moved)\s+(?:on|with|to)\s+(?:the\s+)?(?:first|top|no\.?\s*1)\s+(?:power.play\s+unit|unit\s+(?:of |on )?the power play)/.test(tail)) return {
      kind: 'power-play', report: 'was reported working with the first power-play unit',
      implication: 'Citrus read: that assignment creates a path to more power-play scoring if it carries into games. Track whether he keeps the unit; practice deployment alone does not justify raising the projection.',
    };
    if (/^(?:(?:has|was|is)\s+)?(?:traded to|signed with|signs with|re.signed with|re.signs with)/.test(tail)) return {
      kind: 'transaction', report: 'was the subject of a confirmed team transaction',
      implication: 'Citrus read: establish his line and power-play assignment in the new roster context before pricing in extra opportunity. A transaction alone does not establish either.',
    };
    if (/^(?:will start in (?:goal|net)|starts in (?:goal|net)|gets the start in (?:goal|net)|is confirmed to start)/.test(tail)) return {
      kind: 'starter', report: 'was named for a start in goal',
      implication: 'Citrus read: a named start adds a game of opportunity, not ownership of the crease. Verify that this dated report applies to the game you are setting a lineup for.',
    };
  }
  return null;
}

export function selectEditorialNews(
  player: { id: number | string; name: string },
  items: readonly EditorialNewsItem[] | null | undefined,
  now: Date = new Date(),
): EditorialNewsEvidence[] {
  const id = Number(player.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(now.getTime())) return [];
  const seen = new Set<string>();
  const domains = new Set<string>();
  const result: EditorialNewsEvidence[] = [];
  const validItems = (Array.isArray(items) ? items : []).filter(item => item &&
    typeof item.title === 'string' && typeof item.url === 'string' &&
    typeof item.source_id === 'string' && typeof item.published_at === 'string' &&
    (item.snippet == null || typeof item.snippet === 'string') && Array.isArray(item.player_ids));
  const sorted = [...validItems].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  for (const item of sorted) {
    const at = Date.parse(item.published_at);
    const age = now.getTime() - at;
    if (!Number.isFinite(at) || age < 0 || age > EDITORIAL_NEWS_MAX_AGE_MS || !item.player_ids?.includes(id)) continue;
    const url = canonicalNewsUrl(item.url);
    if (!url || !item.source_id?.trim()) continue;
    const key = fold(item.title).replace(/[^a-z0-9]/g, '');
    if (seen.has(url) || seen.has(key)) continue;
    const raw = `${item.title}\n${item.snippet ?? ''}`;
    if (instructions.test(raw)) continue;
    const event = eventFor(raw, player.name);
    if (!event) {
      // A newer direct health statement may use unsupported wording. Do not
      // fall through to an older injury just because that wording was parsable.
      if (subjectTails(raw, player.name).some(tail => healthSignal.test(tail))) domains.add('health');
      continue;
    }
    // One latest health/role event avoids appending an old injury after clearance.
    const domain = ['practice', 'out', 'uncertain', 'cleared'].includes(event.kind) ? 'health' : 'role';
    if (domains.has(domain)) continue;
    // Starting-goalie confirmations have a shorter useful life than team news.
    if (event.kind === 'starter' && age > 36 * 3600000) continue;
    seen.add(url); seen.add(key); domains.add(domain);
    result.push({ ...event, source: new URL(url).hostname.replace(/^www\./, ''), url, publishedAt: new Date(at).toISOString() });
    if (result.length === 2) break;
  }
  return result;
}

export function editorialNewsText(playerName: string, evidence: readonly EditorialNewsEvidence[]): { summary: string; analysis: string } {
  return {
    summary: evidence.map(e => `${e.source} (${e.publishedAt.slice(0, 10)}): ${playerName} ${e.report}.`).join(' '),
    analysis: evidence.map(e => e.implication).join(' '),
  };
}
