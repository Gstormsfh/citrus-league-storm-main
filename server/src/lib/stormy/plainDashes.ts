/**
 * NO EM DASHES OUT OF STORMY (2026-09-05). The system prompt forbids them
 * (rule 1) and the model still writes them. This is the belt: every reply
 * passes through here before it leaves the server. An em dash between words
 * becomes a comma; one that opens a line or a quote is dropped; an en dash
 * used as a dash (spaced) becomes a comma too, while the en dash inside a
 * range (2025–26, 5–3) is left alone, because that one is punctuation the
 * copy rules allow.
 */
export function plainDashes(text: string): string {
  if (!text) return text;
  return text
    // a spaced dash between words: "elite looks — cold stick" -> "elite looks, cold stick"
    .replace(/\s+[—–]\s+/g, ', ')
    // an unspaced em dash between words: "looks—cold" -> "looks, cold"
    .replace(/(\S)—(\S)/g, '$1, $2')
    // a dash opening a line, a quote, or a bullet: "— import ..." -> "import ..."
    .replace(/(^|\n|["'“‘(\[])\s*—\s*/g, '$1')
    // anything left standing alone
    .replace(/—/g, ',')
    // never a comma before a comma or a period we just created
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\./g, '.');
}
