/**
 * NO EM DASHES OUT OF STORMY (2026-09-05). The system prompt forbids them
 * (rule 1) and the model still writes them. This is the belt: every reply
 * passes through here before it leaves the server. An em dash between words
 * becomes a comma; one that opens a line or a quote is dropped; one that
 * sits against punctuation is dropped; an en dash used as a dash (spaced)
 * becomes a comma too, while the en dash inside a range (2025–26, 5–3) is
 * left alone, because that one is punctuation the copy rules allow.
 *
 * Order matters: the line-opening and before-punctuation cases run first,
 * or the spaced-dash rule eats the newline in front of a bullet.
 */
export function plainDashes(text: string): string {
  if (!text) return text;
  return (
    text
      // a dash opening the text, a line, a quote or a bullet: "— Bench him" -> "Bench him"
      .replace(/(^|\n|["'“‘(\[])[ \t]*[—–][ \t]*/g, '$1')
      // a dash against punctuation: "Fine —, really" -> "Fine, really"; "Done —." -> "Done."
      .replace(/[ \t]*[—–][ \t]*(?=[,.;:!?])/g, '')
      // a spaced dash between words: "elite looks — cold stick" -> "elite looks, cold stick"
      .replace(/[ \t]+[—–][ \t]+/g, ', ')
      // an unspaced em dash between words: "looks—cold" -> "looks, cold"
      .replace(/(\S)—(\S)/g, '$1, $2')
      // anything left standing alone
      .replace(/[ \t]*—[ \t]*/g, ', ')
      // never a comma against a comma or a period we just created, never a space before a comma
      .replace(/,\s*,/g, ',')
      .replace(/,\s*\./g, '.')
      .replace(/[ \t]+,/g, ',')
      .replace(/, $/g, '')
  );
}
