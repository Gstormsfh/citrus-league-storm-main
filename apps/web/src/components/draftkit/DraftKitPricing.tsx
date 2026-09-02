import { useState } from 'react';
import { Check } from 'lucide-react';
// Direct module import, not the citrus2 barrel. See the note in
// DraftKitPlayerCard.tsx: the barrel drags the Supabase client in with it.
import { CitrusButton } from '@/components/citrus2/CitrusButton';
import { logger } from '@/utils/logger';
import { DRAFT_KIT_TIERS, priceLabel } from './tiers';
import type { DraftKitTier } from './types';

/**
 * The pricing surface for the Draft Kit suite.
 *
 * ── WHAT THIS SELLS ──────────────────────────────────────────────────
 * Three tiers, described by what kind of thing each one is rather than by
 * feature count. The amounts live in tiers.ts and are the founder's to set;
 * nothing here carries a number of its own.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────
 * It does not take a payment. There is no processor wired to Citrus, so the
 * CTA calls POST /api/draft-kit/checkout, which is a stub that charges
 * nothing, stores nothing and grants nothing. The button says so in its
 * response rather than opening a form that cannot work. No card fields, no
 * redirect to a checkout that does not exist, no collected credentials.
 *
 * ── NO SOCIAL PROOF ──────────────────────────────────────────────────
 * No testimonials, no review counts, no "trusted by N managers", no accuracy
 * claims about the projection model. Every one of those would have to be made
 * up today, and a made-up number on a pricing page is the kind of thing that
 * is never walked back. The strongest honest claim available is a description
 * of what the section actually contains, so that is the claim made.
 */

export interface DraftKitPricingProps {
  /** The tier the caller currently holds, from the server. */
  currentTier: DraftKitTier;
  /** Rendered above the tiers. */
  heading?: string;
}

export function DraftKitPricing({
  currentTier,
  heading = 'Get the whole suite',
}: DraftKitPricingProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestUpgrade(tierId: DraftKitTier) {
    setBusy(true);
    setStatus(null);
    try {
      // Lazy import for the same reason useCitrusPlayerNotes uses one:
      // @/api/client pulls in the Supabase client, which throws at module
      // scope without VITE_SUPABASE_* set and would take down any test that
      // renders this component.
      const { apiClient } = await import('@/api/client');
      const res = await apiClient.post<{ status: string; message: string }>(
        '/api/draft-kit/checkout',
        // No user id in the body. The server reads identity from the verified
        // token; anything sent here would be ignored, so nothing is sent.
        { tier: tierId },
      );
      setStatus(res.data?.message ?? 'Checkout is not open yet.');
    } catch (err) {
      logger.debug('[draft-kit] checkout stub unavailable:', err);
      setStatus('Checkout is not open yet. Nothing has been charged.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="draft-kit-pricing" aria-label="Draft Kit pricing">
      <h2 className="font-sans text-[1.5rem] font-black leading-tight tracking-[-0.02em] text-pastel-cream sm:text-[2rem]">
        {heading}
      </h2>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/60">
        One season pass. Every number on every card traces to a column in the Citrus database, and
        the card tells you which one.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {DRAFT_KIT_TIERS.map((t) => {
          const held = t.id === currentTier;
          const isFree = t.id === 'free';
          return (
            <article
              key={t.id}
              data-testid={`tier-${t.id}`}
              className={`flex flex-col rounded-2xl bg-pastel-surface-tile p-5 ring-1 ${
                t.featured ? 'ring-pastel-orange/40' : 'ring-white/10'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-jbmono text-[11px] font-bold uppercase tracking-[0.2em] text-pastel-orange-soft">
                  {t.name}
                </h3>
                {held && (
                  <span className="rounded-md bg-pastel-sage/15 px-1.5 py-0.5 font-jbmono text-[9px] font-bold uppercase tracking-[0.14em] text-pastel-sage-soft ring-1 ring-pastel-sage/30">
                    Your plan
                  </span>
                )}
              </div>

              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-sans text-[2rem] font-black leading-none text-pastel-cream">
                  {priceLabel(t)}
                </span>
                <span className="font-jbmono text-[10px] uppercase tracking-[0.14em] text-white/55">
                  {t.cadence}
                </span>
              </div>

              <p className="mt-2 text-[13px] leading-relaxed text-white/60">{t.tagline}</p>

              <ul className="mt-4 flex-1 space-y-2">
                {t.includes.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-[13px] leading-relaxed text-white/70">
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pastel-sage-soft"
                      aria-hidden="true"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {isFree ? (
                  <CitrusButton variant="secondary" size="md" fullWidth disabled>
                    Included
                  </CitrusButton>
                ) : held ? (
                  <CitrusButton variant="secondary" size="md" fullWidth disabled>
                    Active
                  </CitrusButton>
                ) : (
                  <CitrusButton
                    variant={t.featured ? 'primary' : 'secondary'}
                    size="md"
                    fullWidth
                    loading={busy}
                    onClick={() => requestUpgrade(t.id)}
                  >
                    Get {t.name}
                  </CitrusButton>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {status && (
        <p
          role="status"
          data-testid="checkout-status"
          className="mt-4 rounded-xl bg-white/[0.03] px-4 py-3 text-[13px] leading-relaxed text-white/70 ring-1 ring-white/10"
        >
          {status}
        </p>
      )}
    </section>
  );
}
