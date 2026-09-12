import type { NewsItemRow, WireItem } from './NewsRoomService';

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const INSTRUCTIONS = /\b(?:ignore|disregard|override)\b.{0,60}\b(?:instructions?|prompts?|rules?)\b|\bsystem\s*(?:prompt|message)\b|\b(?:assistant|system)\s*:|\b(?:reveal|print)\b.{0,30}\b(?:secret|api.key|prompt)\b/i;
export const containsNewsInstructions = (text: string): boolean => INSTRUCTIONS.test(text);

export function sourceDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return null; }
}

/** Unknown dates are not evidence of freshness. Newest duplicate wins. */
export function selectFreshWireItems(items: readonly WireItem[], now = Date.now()): WireItem[] {
  const urls = new Set<string>();
  const stories = new Set<string>();
  return [...items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).flatMap((item) => {
    const date = sourceDate(item.publishedAt);
    const time = Date.parse(date);
    const url = canonicalUrl(item.url);
    if (!url || !Number.isFinite(time) || time > now || time <= now - MAX_AGE_MS ||
      containsNewsInstructions(`${item.title} ${item.snippet}`)) return [];
    const story = `${item.sourceId}:${item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
    if (urls.has(url) || stories.has(story)) return [];
    urls.add(url);
    stories.add(story);
    return [{ ...item, url, publishedAt: date }];
  });
}

export function newsAttribution(item: WireItem): string {
  let source = item.sourceName || item.sourceId;
  if (!source || containsNewsInstructions(source)) {
    try { source = new URL(item.url).hostname; } catch { source = 'Source'; }
  }
  const date = sourceDate(item.publishedAt);
  return `${source.replace(/[<>\r\n]/g, '').slice(0, 80)} (${date ? date.slice(0, 10) : 'date unavailable'})`;
}

/** A labelled, bounded excerpt, never an invented assessment or a long copied paragraph. */
export function fallbackNewsSummary(item: WireItem): string {
  const raw = [item.snippet, item.title].find((text) => text && !containsNewsInstructions(text)) || '';
  const words = raw.replace(/[<>"“”]/g, '').trim().split(/\s+/).filter(Boolean);
  const excerpt = words.slice(0, 22).join(' ');
  return excerpt ? `${newsAttribution(item)}: “${excerpt}${words.length > 22 ? '…' : ''}”` : '';
}

const foldEditorialText = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/’/g, "'").toLowerCase();
// Sentence openers and hockey categories are not player/team entities. Other
// capitalized tokens must occur in publisher text, including surnames alone.
const NON_ENTITY_WORDS = new Set(('A An The He His Him It Its They Their This That These Those No There If When With Without For In On At After Before But And However Still ' +
  'Practice Practicing Skating Clearance Availability Injury Injuries Return Returning Activation Deployment Minutes More Less Fewer Additional Increased Reduced ' +
  'Projected Reported Shots Goals Assists Points Saves Wins Fantasy Power NHL Citrus Check Confirm Monitor Track Keep').split(' '));

function hasUnsupportedEntities(summary: string, evidence: string): boolean {
  const foldedEvidence = foldEditorialText(evidence);
  const sourceTokens = new Set(foldedEvidence.match(/[\p{L}\p{M}'-]+/gu)?.map(word => word.replace(/'s$/, '')) || []);
  const entities = summary.match(/[\p{Lu}][\p{L}\p{M}'’–-]*/gu) || [];
  if (entities.some(word => !NON_ENTITY_WORDS.has(word) && !sourceTokens.has(foldEditorialText(word).replace(/'s$/, '')))) return true;
  // Lowercasing an invented name must not bypass the entity check. Only inspect
  // compact subjects before common reporting predicates; pronouns remain valid.
  const subjects = summary.matchAll(/(?:^|[.;]\s*)([\p{L}'’-]+(?:\s+[\p{L}'’-]+)?)\s+(?:is|was|has|had|will|skated|practiced|signed|traded|remains|returned)\b/giu);
  for (const match of subjects) {
    const subject = foldEditorialText(match[1]);
    if (/^(?:a|an|the|he|his|it|its|they|their|this|that|these|those)\b/.test(subject)) continue;
    if (!foldedEvidence.includes(subject)) return true;
  }
  // Token presence alone cannot turn Jack Eichel + Quinn Hughes into Jack Hughes.
  const groups = summary.match(/[\p{Lu}][\p{L}\p{M}'’–-]*(?:\s+[\p{Lu}][\p{L}\p{M}'’–-]*)+/gu) || [];
  return groups.some(group => {
    const names = group.split(/\s+/).filter(word => !NON_ENTITY_WORDS.has(word));
    return names.length > 1 && !foldedEvidence.includes(foldEditorialText(names.join(' ')).replace(/'s$/, ''));
  });
}

/** Event vocabulary is only a conservative support check, not an event model.
 * In particular, an uncertain availability report does not establish an absence.
 */
function hasUnsupportedEvents(summary: string, evidence: string): boolean {
  const events: Array<[RegExp, RegExp]> = [
    [/\b(?:trad(?:e|ed|ing)|acquir(?:e|ed|es)|deal sent)\b/i, /\b(?:trad(?:e|ed|es|ing)|acquir(?:e|ed|es)|deal sent)\b/i],
    [/\b(?:sign(?:s|ed|ing)?|re[- ]sign(?:s|ed|ing)?|contract extension)\b/i, /\b(?:sign(?:s|ed|ing)?|re[- ]sign(?:s|ed|ing)?|contract extension|renewed)\b/i],
    [/\b(?:injur(?:y|ies|ed)|concussion|fractur\w*|sprain\w*|surgery|torn|tear)\b/i, /\b(?:injur(?:y|ies|ed)|concussion|fractur\w*|sprain\w*|surgery|torn|tear|upper.body|lower.body)\b/i],
    [/\b(?:ruled out|sidelined|unavailable|will miss|injured reserve)\b/i, /\b(?:ruled out|sidelined|unavailable|will miss|injured reserve|out with|out for|out indefinitely)\b/i],
    [/\b(?:suspend(?:ed|sion)?|suspension|banned|ban)\b/i, /\b(?:suspend(?:ed|sion)?|suspension|banned|ban)\b/i],
    [/\b(?:promot(?:ed|ion)|demot(?:ed|ion)|top[- ]six|top[- ]pair|first[- ]pair|starting role|starter|backup)\b/i, /\b(?:promot(?:ed|ion)|demot(?:ed|ion)|top[- ]six|top[- ]pair|first[- ]pair|starting role|starter|backup)\b/i],
    [/\b(?:power[- ]play|penalty[- ]kill)\b/i, /\b(?:power[- ]play|penalty[- ]kill|pp1|pp2)\b/i],
  ];
  if (events.some(([claim, support]) => claim.test(summary) && !support.test(evidence))) return true;
  // A generic injury must not license a specific diagnosis.
  for (const diagnosis of ['concussion', 'fracture', 'sprain', 'surgery', 'torn', 'tear']) {
    if (new RegExp(`\\b${diagnosis}\\w*\\b`, 'i').test(summary) && !new RegExp(`\\b${diagnosis}\\w*\\b`, 'i').test(evidence)) return true;
  }
  const uncertainEvent = /\b(?:could|might|may|rumou?r(?:ed|s)?|possible|potential|not|never)\b.{0,65}\b(?:trad\w*|sign\w*|suspend\w*|promot\w*|demot\w*)\b|\b(?:trad\w*|sign\w*|suspend\w*|promot\w*|demot\w*)\b.{0,25}\b(?:rumou?r(?:ed|s)?|possible|potential)\b/i;
  const assertedEvent = /\b(?:was|is|has been|has|will be)\s+(?:traded|signed|suspended|promoted|demoted)\b/i;
  return uncertainEvent.test(evidence) && assertedEvent.test(summary) && !uncertainEvent.test(summary);
}

/** Conservative automated checks; these cannot prove every semantic claim. */
export function validNewsSummary(summary: string, item: WireItem): boolean {
  const words = summary.trim().split(/\s+/);
  if (summary.length < 12 || summary.length > 360 || words.length > 45 ||
    containsNewsInstructions(summary) || /https?:|[<>]|["“”]/i.test(summary)) return false;
  const evidence = `${item.title} ${item.snippet}`.toLowerCase();
  const normalized = summary.toLowerCase();
  if (hasUnsupportedEntities(summary, evidence) || hasUnsupportedEvents(summary, evidence)) return false;
  // Dates/numbers from publication metadata cannot become medical timelines or stats.
  const numbers = normalized.match(/\d+(?:[.:/-]\d+)*%?/g) || [];
  const sourceNumbers: string[] = evidence.match(/\d+(?:[.:/-]\d+)*%?/g) || [];
  if (numbers.some((n) => !sourceNumbers.includes(n))) return false;
  const dates = normalized.match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\b/g) || [];
  if (dates.some((date) => !evidence.includes(date))) return false;
  const claims: Array<[RegExp, RegExp]> = [
    [/\b(?:healthy|cleared|ready to play)\b/i, /\b(?:healthy|cleared|ready to play)\b/i],
    [/\b(?:pp1|first[- ]unit|top power[- ]play unit)\b/i, /\b(?:pp1|first[- ]unit|top power[- ]play unit)\b/i],
    [/\b(?:top[- ]line|first[- ]line)\b/i, /\b(?:top[- ]line|first[- ]line)\b/i],
  ];
  if (claims.some(([claim, support]) => claim.test(summary) && !support.test(evidence))) return false;
  const negatedClearance = /\b(?:not|never|isn't|hasn't|yet to be)\b.{0,25}\b(?:cleared|healthy|ready to play)\b/i;
  if (negatedClearance.test(evidence) && /\b(?:cleared|healthy|ready to play)\b/i.test(summary) && !negatedClearance.test(summary)) return false;
  if (/\b(?:may|might|could|questionable|day.to.day|uncertain|no timetable)\b/i.test(evidence) &&
    /\b(?:will (?:return|play|miss)|returns on|is (?:healthy|cleared))\b/i.test(summary)) return false;
  if (/\b(?:last season|in 20\d{2}[-–]\d{2,4})\b/i.test(evidence) &&
    /\b(?:has|averages|is averaging|scores|produces)\s+\d/i.test(summary)) return false;
  // Reject extended reproduction even if the model forgot quotation marks.
  const sourceWords = evidence.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).join(' ');
  const outputWords = normalized.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/);
  for (let i = 0; i <= outputWords.length - 18; i++) {
    if (sourceWords.includes(outputWords.slice(i, i + 18).join(' '))) return false;
  }
  return true;
}

/** Apply the current guardrails to legacy rows without a paid regeneration pass.
 * Historical stories remain available with explicit dates; unknown/future dates
 * and instruction-contaminated records cannot enter the newsroom response.
 */
export function readableNewsItems(rows: readonly NewsItemRow[], now = Date.now()): NewsItemRow[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const publishedAt = sourceDate(row.published_at);
    const url = canonicalUrl(row.url);
    if (!publishedAt || Date.parse(publishedAt) > now || !url || seen.has(url) ||
      containsNewsInstructions(`${row.title} ${row.snippet || ''}`)) return [];
    seen.add(url);
    const item: WireItem = { sourceId: row.source_id, externalId: null, url: row.url,
      title: row.title, snippet: row.snippet || '', author: row.author,
      imageUrl: row.image_url, publishedAt, taggedPlayerIds: row.player_ids || [] };
    // Rebuild attribution from row metadata; a stored prefix is never evidence.
    const prose = (row.summary || '').replace(/^[^:\n]{1,100} \(\d{4}-\d{2}-\d{2}\):\s*/, '');
    return [{ ...row, summary: validNewsSummary(prose, item)
      ? `${newsAttribution(item)}: ${prose}` : fallbackNewsSummary(item) }];
  });
}
