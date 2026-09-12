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

/** Conservative automated checks; these cannot prove every semantic claim. */
export function validNewsSummary(summary: string, item: WireItem): boolean {
  const words = summary.trim().split(/\s+/);
  if (summary.length < 12 || summary.length > 360 || words.length > 45 ||
    containsNewsInstructions(summary) || /https?:|[<>]|["“”]/i.test(summary)) return false;
  const evidence = `${item.title} ${item.snippet}`.toLowerCase();
  const normalized = summary.toLowerCase();
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
