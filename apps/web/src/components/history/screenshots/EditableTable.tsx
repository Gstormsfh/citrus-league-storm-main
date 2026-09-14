/**
 * A small editable grid for the review screen: one input per cell, typed
 * (text, whole number, decimal, yes/no, a pick from a list), add and remove
 * a row. Wide tables scroll sideways inside the card so a phone never
 * scrolls the page sideways.
 */
import { cn } from '@/lib/utils';

export type ColumnKind = 'text' | 'int' | 'num' | 'bool' | 'select';
export interface Column<T> {
  key: keyof T & string;
  label: string;
  kind: ColumnKind;
  options?: ReadonlyArray<string>;
  /** Tailwind width class for the cell, e.g. 'w-40'. */
  width?: string;
}

export interface EditableTableProps<T extends Record<string, unknown>> {
  columns: Array<Column<T>>;
  rows: T[];
  onChange: (rows: T[]) => void;
  /** A fresh row for the add button; omit to disallow adding. */
  blank?: () => T;
  label: string;
}

const cell = 'h-8 w-full rounded-[6px] border border-white/10 bg-white/[0.04] px-1.5 font-barlow text-[13px] text-pressbox-text outline-none focus:border-pressbox-orange/60';

function parse(kind: ColumnKind, raw: string): unknown {
  if (kind === 'text' || kind === 'select') return raw === '' ? null : raw;
  if (raw.trim() === '') return null;
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return kind === 'int' ? Math.trunc(n) : n;
}

export function EditableTable<T extends Record<string, unknown>>({ columns, rows, onChange, blank, label }: EditableTableProps<T>) {
  const update = (i: number, key: keyof T & string, value: unknown) => {
    const next = rows.slice();
    next[i] = { ...next[i], [key]: value };
    onChange(next);
  };
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn('pb-1 pr-1.5 text-left font-plex font-semibold text-[9px] uppercase tracking-[0.12em] text-white/55', c.width)}>{c.label}</th>
            ))}
            <th scope="col" className="w-8" aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const v = row[c.key];
                return (
                  <td key={c.key} className="pr-1.5 pb-1 align-middle">
                    {c.kind === 'bool' ? (
                      <input type="checkbox" aria-label={`${c.label} row ${i + 1}`} checked={v === true} onChange={(e) => update(i, c.key, e.target.checked ? true : null)} className="h-4 w-4 accent-[var(--pressbox-orange,#ff8a3d)]" />
                    ) : c.kind === 'select' ? (
                      <select aria-label={`${c.label} row ${i + 1}`} value={(v as string | null) ?? ''} onChange={(e) => update(i, c.key, parse(c.kind, e.target.value))} className={cell}>
                        <option value="" className="text-black">-</option>
                        {(c.options ?? []).map((o) => <option key={o} value={o} className="text-black">{o}</option>)}
                      </select>
                    ) : (
                      <input
                        aria-label={`${c.label} row ${i + 1}`}
                        value={v == null ? '' : String(v)}
                        inputMode={c.kind === 'text' ? 'text' : 'decimal'}
                        onChange={(e) => update(i, c.key, parse(c.kind, e.target.value))}
                        className={cell}
                      />
                    )}
                  </td>
                );
              })}
              <td className="pb-1 align-middle">
                <button type="button" aria-label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))} className="h-8 w-8 rounded-[6px] font-plex text-[14px] text-white/55 hover:bg-white/[0.06]">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {blank && (
        <button type="button" onClick={() => onChange([...rows, blank()])} className="mt-1 font-barlow text-[12px] text-pressbox-orange-soft">Add a row</button>
      )}
    </div>
  );
}
