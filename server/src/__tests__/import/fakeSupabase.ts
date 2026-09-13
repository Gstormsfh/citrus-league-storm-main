/**
 * A small in-memory stand-in for the Supabase client, for the import services.
 *
 * The import services are multi-step state machines over half a dozen tables
 * (find identity, follow merge pointer, insert or attach, widen seasons, upsert
 * season rows, retire and reinsert trophies). A chain mock that returns one
 * canned value per table cannot tell a correct merge from a wrong one, so
 * these tests run the real query sequence against tables held in memory and
 * assert on the resulting rows. Only the PostgREST surface the services use
 * is implemented; anything else throws, so a new query shape fails loudly
 * instead of silently passing.
 */
import { vi } from 'vitest';

export type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

export interface FakeOp { table: string; op: string; payload?: unknown; filters: string[] }

export class FakeSupabase {
  tables: Record<string, Row[]>;
  ops: FakeOp[] = [];
  rpcHandlers: Record<string, (args: Row) => unknown | Promise<unknown>> = {};
  /** Make the next matching operation fail with this error. */
  failNext: { table: string; op: string; error: { message: string; code?: string } } | null = null;
  private seq = 0;

  constructor(tables: Record<string, Row[]> = {}) {
    this.tables = tables;
  }

  from = vi.fn((table: string) => new FakeQuery(this, table));

  rpc = vi.fn(async (name: string, args: Row = {}) => {
    const handler = this.rpcHandlers[name];
    if (!handler) return { data: null, error: { message: `no rpc handler for ${name}` } };
    try {
      return { data: await handler(args), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  });

  rows(table: string): Row[] {
    return this.tables[table] ?? (this.tables[table] = []);
  }

  nextId(table: string): string {
    return `${table}-${++this.seq}`;
  }

  opsFor(table: string, op?: string): FakeOp[] {
    return this.ops.filter((o) => o.table === table && (op === undefined || o.op === op));
  }
}

class FakeQuery implements PromiseLike<{ data: any; error: any; count?: number | null }> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: unknown;
  private filters: Filter[] = [];
  private filterDesc: string[] = [];
  private returning = false;
  private limitN: number | null = null;
  private orders: Array<{ col: string; asc: boolean }> = [];
  private conflictCols: string[] | null = null;
  private wantCount = false;
  private headOnly = false;

  constructor(private readonly db: FakeSupabase, private readonly table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(payload: unknown) { this.op = 'insert'; this.payload = payload; return this; }
  upsert(payload: unknown, opts?: { onConflict?: string }) {
    this.op = 'upsert'; this.payload = payload;
    this.conflictCols = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null;
    return this;
  }
  update(payload: unknown) { this.op = 'update'; this.payload = payload; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(col: string, v: unknown) { return this.where(`${col}=${String(v)}`, (r) => r[col] === v); }
  neq(col: string, v: unknown) { return this.where(`${col}!=${String(v)}`, (r) => r[col] !== v); }
  in(col: string, vs: unknown[]) { const set = new Set(vs); return this.where(`${col} in (${vs.length})`, (r) => set.has(r[col])); }
  is(col: string, v: unknown) { return this.where(`${col} is ${String(v)}`, (r) => (v === null ? r[col] == null : r[col] === v)); }
  gte(col: string, v: number) { return this.where(`${col}>=${v}`, (r) => r[col] >= v); }
  gt(col: string, v: number) { return this.where(`${col}>${v}`, (r) => r[col] > v); }
  lte(col: string, v: number) { return this.where(`${col}<=${v}`, (r) => r[col] <= v); }
  lt(col: string, v: number) { return this.where(`${col}<${v}`, (r) => r[col] < v); }
  not(col: string, operator: string, v: unknown) {
    if (operator !== 'is') throw new Error(`FakeSupabase: not(${operator}) is not implemented`);
    return this.where(`${col} is not ${String(v)}`, (r) => (v === null ? r[col] != null : r[col] !== v));
  }
  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this; }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.limitN = to - from + 1; return this; }

  async single() {
    const res = await this.exec();
    if (res.error) return res;
    const rows = res.data as Row[] | null;
    if (!rows || rows.length !== 1) return { data: null, error: { code: 'PGRST116', message: `expected exactly one row, got ${rows?.length ?? 0}` } };
    return { data: rows[0], error: null };
  }

  async maybeSingle() {
    const res = await this.exec();
    if (res.error) return res;
    const rows = res.data as Row[] | null;
    if (rows && rows.length > 1) return { data: null, error: { code: 'PGRST116', message: `expected at most one row, got ${rows.length}` } };
    return { data: rows?.[0] ?? null, error: null };
  }

  then<R1 = any, R2 = never>(onFulfilled?: ((v: any) => R1 | PromiseLike<R1>) | null, onRejected?: ((e: any) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return this.exec().then(onFulfilled, onRejected);
  }

  private where(desc: string, f: Filter) { this.filters.push(f); this.filterDesc.push(desc); return this; }
  private matches(row: Row): boolean { return this.filters.every((f) => f(row)); }

  private async exec(): Promise<{ data: any; error: any; count?: number | null }> {
    const { db, table } = this;
    db.ops.push({ table, op: this.op, payload: this.payload, filters: [...this.filterDesc] });
    const fail = db.failNext;
    if (fail && fail.table === table && fail.op === this.op) {
      db.failNext = null;
      return { data: null, error: fail.error };
    }
    const rows = db.rows(table);
    switch (this.op) {
      case 'select': {
        let out = rows.filter((r) => this.matches(r));
        for (const o of [...this.orders].reverse()) {
          out = [...out].sort((a, b) => (a[o.col] < b[o.col] ? -1 : a[o.col] > b[o.col] ? 1 : 0) * (o.asc ? 1 : -1));
        }
        const count = out.length;
        if (this.limitN != null) out = out.slice(0, this.limitN);
        return { data: this.headOnly ? null : clone(out), error: null, count: this.wantCount ? count : null };
      }
      case 'insert': {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const inserted = list.map((p) => ({ id: db.nextId(table), ...p }));
        rows.push(...inserted);
        return { data: this.returning ? clone(inserted) : null, error: null };
      }
      case 'upsert': {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const written: Row[] = [];
        for (const p of list) {
          const keyCols = this.conflictCols ?? ['id'];
          const existing = rows.find((r) => keyCols.every((c) => c in p && r[c] === p[c]));
          if (existing) { Object.assign(existing, p); written.push(existing); }
          else { const row = { id: db.nextId(table), ...p }; rows.push(row); written.push(row); }
        }
        return { data: this.returning ? clone(written) : null, error: null };
      }
      case 'update': {
        const hit = rows.filter((r) => this.matches(r));
        for (const r of hit) Object.assign(r, this.payload as Row);
        return { data: this.returning ? clone(hit) : null, error: null };
      }
      case 'delete': {
        const hit = rows.filter((r) => this.matches(r));
        db.tables[table] = rows.filter((r) => !this.matches(r));
        return { data: this.returning ? clone(hit) : null, error: null };
      }
    }
  }
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
