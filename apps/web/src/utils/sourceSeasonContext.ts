/** Labels stored source metadata; never infers a season from today's date. */
export function sourceSeasonLabel(season: unknown): string {
  return typeof season === 'number' && Number.isInteger(season) && season >= 1900 && season <= 2200
    ? `${season}-${String((season + 1) % 100).padStart(2, '0')}`
    : 'Season unavailable';
}

/** Publication context belongs beside stored prose, not inside quoted text. */
export function citrusNoteContext(note: { season?: unknown; published_at?: unknown }): string {
  const date = typeof note.published_at === 'string' ? new Date(note.published_at) : null;
  const published = date && Number.isFinite(date.getTime())
    ? `Published ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
    : 'Publication date unavailable';
  return `${sourceSeasonLabel(note.season)} · ${published}`;
}
