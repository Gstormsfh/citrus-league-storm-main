/**
 * Test helper: the fantasy week (Sunday–Saturday, YYYY-MM-DD) containing a
 * date, so "today" lands inside the strip under test. One copy (2026-09-01)
 * — three WeeklySchedule test files had each grown their own.
 */
export function weekOf(dateStr: string): { weekStart: string; weekEnd: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const sun = new Date(dt);
  sun.setDate(dt.getDate() - dt.getDay());
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { weekStart: fmt(sun), weekEnd: fmt(sat) };
}
