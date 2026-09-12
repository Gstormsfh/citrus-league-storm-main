/** Display the season carried by a data source, never the browser's calendar. */
export function dataSeasonLabel(season: number | null | undefined): string | null {
  return typeof season === 'number' && Number.isInteger(season) && season >= 1917 && season < 2200
    ? `${season}-${String((season + 1) % 100).padStart(2, '0')}` : null;
}

export function actualsSeasonLabel(season: number | null | undefined): string {
  const label = dataSeasonLabel(season);
  return label ? `${label} actuals` : 'Actuals (season unavailable)';
}

export function actualsCohortLabel(seasons: readonly (number | null | undefined)[]): string {
  const labels = [...new Set(seasons.map(dataSeasonLabel).filter((x): x is string => x !== null))].sort();
  return labels.length ? `${labels.join(', ')} actuals` : actualsSeasonLabel(null);
}
