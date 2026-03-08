import { vi } from 'vitest';

/**
 * Creates a mock Supabase query chain where every method returns the chain itself.
 * The `resolve` method sets what the terminal operation returns.
 *
 * Usage:
 *   const chain = createChain({ data: [...], error: null });
 *   mockSupabase.from = vi.fn(() => chain);
 */
export function createChain(terminalValue: any = { data: null, error: null }) {
  const chain: Record<string, any> = {};

  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'in', 'is', 'or', 'and', 'not',
    'gte', 'gt', 'lte', 'lt', 'like', 'ilike',
    'order', 'limit', 'range', 'filter',
    'contains', 'containedBy', 'textSearch',
  ];

  // All fluent methods return the chain
  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }

  // Terminal methods resolve with the value
  chain.single = vi.fn().mockResolvedValue(terminalValue);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminalValue);

  // Make the chain itself thenable so `await chain` also resolves
  chain.then = (resolve: any, reject: any) => {
    return Promise.resolve(terminalValue).then(resolve, reject);
  };

  return chain;
}

/**
 * Creates a mock Supabase client with per-table chain configuration.
 *
 * Usage:
 *   const mock = createMockSupabase({
 *     leagues: createChain({ data: { id: 'l1' }, error: null }),
 *     teams: createChain({ data: [{ id: 't1' }], error: null }),
 *   });
 */
export function createMockSupabase(
  tables: Record<string, any> = {},
  rpcResult: any = { data: null, error: null },
) {
  const defaultChain = createChain();

  return {
    from: vi.fn((table: string) => tables[table] || defaultChain),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as any;
}
