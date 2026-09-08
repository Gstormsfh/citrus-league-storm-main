import { Link } from 'react-router-dom';
import { usePageMeta } from '@/lib/pageMeta';
import Navbar from '@/components/Navbar';
import { DarkLayout, HockeyFooter } from '@/components/citrus2';

/** Retain the existing URL so bookmarks and shared links still work. */
export default function Pricing() {
  usePageMeta({ title: 'Pricing', description: 'Citrus is free to play. Leagues, drafts, Stormy and player analytics at no cost.', path: '/pricing' });
  return (
    <DarkLayout>
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 pt-28 pb-24 text-center">
        <div className="font-plex font-semibold text-[11px] tracking-[0.18em] uppercase text-pressbox-orange-soft mb-4">Pricing</div>
        <h1 className="font-condensed font-extrabold uppercase text-[3.5rem] md:text-[5rem] leading-[0.92] tracking-[-0.01em] text-pressbox-text mb-6">There is no pricing page.</h1>
        <p className="font-barlow font-normal text-[18px] text-pressbox-text/75 leading-relaxed mb-4">
          Citrus is free to play. There is no card to enter, no entry fee and no payout.
        </p>
        <p className="font-barlow font-normal text-[17px] text-pressbox-text/70 leading-relaxed mb-8">
          Stormy has a weekly question limit while we are in launch, and the app shows you where you are against it.
        </p>
        <Link to="/create-league" className="inline-flex items-center rounded-md bg-pressbox-orange px-6 h-12 font-condensed font-bold uppercase tracking-[0.06em] text-[17px] text-pressbox-orange-ink hover:bg-pastel-orange-soft transition-colors">
          Create a league
        </Link>
      </main>
      <HockeyFooter />
    </DarkLayout>
  );
}
