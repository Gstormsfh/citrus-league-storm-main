import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';

type Offer = { available: boolean; currency: string | null; amountMinor: number | null; accessUntil: string | null; termsUrl: string | null };
const PRICE = '$7.99 CAD';

/** Public website page. Server readiness, not this UI, is the authority to sell. */
export default function DraftKitPurchase() {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  // Stable for transport retries of this click; recreated for a later, explicit attempt.
  const checkoutAttempt = useRef(crypto.randomUUID());
  const [message, setMessage] = useState('Checking purchase availability…');
  const [error, setError] = useState('');
  useEffect(() => { void apiClient.get<Offer>('/api/draft-kit/checkout/offer', { retries: 0 })
    .then((r) => { const next = r.data ?? { available: false, currency: null, amountMinor: null, accessUntil: null, termsUrl: null }; setOffer(next); setMessage(next.available ? 'Review the terms, then continue to secure checkout.' : 'Purchases are not open yet. Nothing has been charged.'); })
    .catch(() => { setOffer({ available: false, currency: null, amountMinor: null, accessUntil: null, termsUrl: null }); setMessage('Purchases are not open yet. Nothing has been charged.'); }); }, []);
  async function beginCheckout() {
    setBusy(true); setError('');
    try { const result = await apiClient.post<{ url: string }>('/api/draft-kit/checkout/session', {}, { retries: 0, headers: { 'x-checkout-attempt': checkoutAttempt.current } });
      if (!result.data?.url || new URL(result.data.url).origin !== 'https://checkout.stripe.com') throw Error('The payment page is unavailable.');
      window.location.assign(result.data.url);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not open checkout.'); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-[#10291f] px-5 py-12 text-[#f8f5ec]">
    <div className="mx-auto max-w-2xl rounded-2xl border border-white/15 bg-white/5 p-6 sm:p-10">
      <p className="text-xs font-bold uppercase tracking-[.2em] text-[#ff9b61]">Season-long fantasy hockey</p>
      <h1 className="mt-4 text-4xl font-black">Citrus Draft Kit</h1>
      <p className="mt-4 text-lg text-white/80">A browser-based Draft Kit for supported points leagues: rankings and premium Draft Kit access for your Citrus account.</p>
      <div className="mt-7 flex items-end justify-between border-y border-white/15 py-5"><span>One-time seasonal access</span><strong className="text-3xl">{PRICE}</strong></div>
      <p className="mt-5 text-sm text-white/70">Free season-long fantasy remains free. This purchase does not start a subscription and does not include unimplemented downloads or third-party league connections.</p>
      {offer?.available && offer.termsUrl ? <a className="mt-5 inline-block underline" href={offer.termsUrl}>Read purchase terms</a> : null}
      <p role="status" className="mt-5 text-sm text-white/75">{message}</p>
      {offer?.available ? <button type="button" onClick={() => void beginCheckout()} disabled={busy} className="mt-5 rounded-lg bg-[#ff6b1a] px-5 py-3 font-bold text-[#10291f] disabled:opacity-50">{busy ? 'Opening secure checkout…' : `Buy for ${PRICE}`}</button> : null}
      {error ? <p role="alert" className="mt-4 text-sm text-orange-200">{error}</p> : null}
      <p className="mt-8 text-sm"><Link className="underline" to="/draft-kit">Back to Draft Kit preview</Link></p>
    </div>
  </main>;
}
