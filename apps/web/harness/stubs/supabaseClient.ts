/**
 * Stand-in for `@/integrations/supabase/client`.
 *
 * WHY THIS EXISTS. The real module calls `createClient(...)` at MODULE
 * SCOPE and throws — "Missing Supabase environment variables" — when
 * `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are unset. The harness has
 * no `.env`, deliberately: it stands in for the network, so a key would be
 * a key it must never have.
 *
 * That throw is not theoretical. `pages/PlayerDashboard` renders `Navbar`,
 * `Navbar` reads `stores/notificationStore`, that imports
 * `services/NotificationService`, and THAT imports this module — four hops
 * from a page that makes no Supabase call of its own. The whole harness
 * entry rendered a blank `<div id="root">` with the error only visible in
 * the devtools console, which is the worst kind of harness failure: it
 * looks like the page is broken.
 *
 * The stub is deliberately INERT rather than fake-successful. Every method
 * resolves to the shape the client returns on a failed call — `{ data:
 * null, error }` — so any code path that reaches Supabase through the
 * harness degrades exactly as it would against a dead backend, instead of
 * quietly appearing to work. Auth and the league context are already
 * aliased to their own stubs, so nothing the harness renders should be
 * reaching this at all; if something does, its no-op is a finding.
 */

const NOT_AVAILABLE = {
  message: 'supabase is not available in the render harness',
  code: 'HARNESS_STUB',
};

const result = { data: null, error: NOT_AVAILABLE };

/** Every PostgREST builder method returns the builder; awaiting it resolves. */
function queryBuilder(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'or', 'not', 'gt', 'gte', 'lt', 'lte',
    'like', 'ilike', 'contains', 'containedBy', 'textSearch', 'filter',
    'order', 'limit', 'range', 'abortSignal',
  ];
  for (const m of methods) chain[m] = () => chain;
  chain.single = async () => result;
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

const channel = {
  on: () => channel,
  subscribe: () => channel,
  unsubscribe: async () => 'ok',
  send: async () => 'ok',
};

export const supabase = {
  from: () => queryBuilder(),
  rpc: async () => result,
  channel: () => channel,
  removeChannel: async () => 'ok',
  removeAllChannels: async () => [],
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => result,
    signInWithOAuth: async () => result,
    signUp: async () => result,
    refreshSession: async () => result,
  },
  storage: {
    from: () => ({
      upload: async () => result,
      download: async () => result,
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
      remove: async () => result,
    }),
  },
  functions: {
    invoke: async () => result,
  },
};

export default supabase;
