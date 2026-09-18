import type { DraftKitBlurb } from './types';

/**
 * The written layer of the kit: the founder's own analysis, and pieces from
 * hockey writers we source.
 *
 * ── THIS FILE IS A SHELL, ON PURPOSE ─────────────────────────────────
 * There is no sample copy here, no placeholder byline, and no seeded rows in
 * the migration. Everything rendered below comes from public.draft_kit_blurbs,
 * and that table is written by a human through the service role. An invented
 * quote or a made-up author would be indistinguishable from a real one once it
 * is on screen, which is exactly why none is written.
 *
 * ── ATTRIBUTION IS PART OF THE CONTENT ───────────────────────────────
 * author_name is NOT NULL in the schema, and source_name / source_url are
 * constrained to travel as a pair, so a blurb can never render with a link and
 * no credit or a credit and no link. This component surfaces all three every
 * time. External links carry rel="noopener noreferrer" and open in a new tab,
 * because a sourced piece lives on the writer's own site and should stay
 * there.
 */

export interface BlurbSlotProps {
  blurbs: DraftKitBlurb[];
  /** Section heading. */
  title?: string;
  /**
   * What to say when there is nothing published yet. The empty state is the
   * normal state before an editor has written anything, not an error.
   */
  emptyLabel?: string;
  locked?: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function BlurbSlot({
  blurbs,
  title = 'From the desk',
  emptyLabel = 'No written analysis published yet.',
  locked = false,
}: BlurbSlotProps) {
  if (locked) {
    return (
      <div
        data-testid="blurbs-locked"
        className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-6 text-center"
      >
        <p className="text-[14px] font-bold text-pastel-cream">{title}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/55">
          Written analysis is part of the Full Suite.
        </p>
      </div>
    );
  }

  return (
    <section data-testid="blurb-slot" aria-label={title}>
      <h3 className="font-jbmono text-[11px] font-bold uppercase tracking-[0.2em] text-pastel-orange-soft">
        {title}
      </h3>

      {blurbs.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-pastel-surface-tile px-4 py-6 text-center text-[13px] text-white/50 ring-1 ring-white/10">
          {emptyLabel}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {blurbs.map((b) => (
            <article
              key={b.id}
              data-testid="blurb"
              className="rounded-2xl bg-pastel-surface-tile p-4 ring-1 ring-white/10"
            >
              <h4 className="text-[15px] font-black leading-snug text-pastel-cream">{b.title}</h4>
              <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-white/70">
                {b.body}
              </p>
              <footer className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/10 pt-2.5">
                <span className="font-jbmono text-[10px] uppercase tracking-[0.14em] text-white/55">
                  {b.authorName}
                </span>
                {b.authorRole && (
                  <span className="font-jbmono text-[10px] uppercase tracking-[0.14em] text-white/55">
                    {b.authorRole}
                  </span>
                )}
                <span className="font-jbmono text-[10px] uppercase tracking-[0.14em] text-white/55">
                  {formatDate(b.publishedAt)}
                </span>
                {b.sourceName && b.sourceUrl && (
                  <a
                    href={b.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-jbmono text-[10px] uppercase tracking-[0.14em] text-pastel-orange-soft underline decoration-dotted underline-offset-2 hover:text-pastel-orange"
                  >
                    {b.sourceName}
                  </a>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
