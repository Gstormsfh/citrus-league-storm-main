/** Start an independent read now, but surface its value/error only when consumed.
 * The captured outcome cannot reject while the caller completes earlier work.
 * This does not detach state updates or change the caller's cancellation boundary.
 */
export function startDeferredRead<T>(read: () => Promise<T>): () => Promise<T> {
  const outcome = Promise.resolve().then(read).then(
    value => ({ ok: true as const, value }),
    error => ({ ok: false as const, error }),
  );
  return async () => {
    const result = await outcome;
    if (result.ok === false) throw result.error;
    return result.value;
  };
}
