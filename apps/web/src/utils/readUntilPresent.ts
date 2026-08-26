/**
 * Poll a read until it returns something, instead of sleeping and hoping.
 *
 * WHY THIS EXISTS. Two `await new Promise(r => setTimeout(r, 2000))` calls sat
 * on the Matchup page's generation path, both commented "wait for database
 * commits". Nothing was uncommitted — the write API had already returned, and
 * Postgres does not acknowledge a write it has not committed. What they were
 * really covering for is a stale client-side cache, which the `invalidate()`
 * call sitting beside one of them already handles.
 *
 * So the common case paid a flat two seconds, twice, to fix a problem it did
 * not have — against a page that has a 15-second timeout and was taking ten.
 *
 * Polling costs one extra tick of nothing when the first read succeeds, and
 * still tolerates a genuinely slow write by retrying inside roughly the same
 * budget the sleep used to burn unconditionally.
 */
export async function readUntilPresent<T>(
  read: () => Promise<T>,
  isPresent: (value: T) => boolean,
  { attempts = 6, delayMs = 350 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  let last = await read();
  for (let i = 1; i < attempts && !isPresent(last); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    last = await read();
  }
  return last;
}
