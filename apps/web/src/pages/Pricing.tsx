import { Link } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import { DarkLayout, HockeyFooter } from '@/components/citrus2';

/** Retain the existing URL so bookmarks and shared links still work. */
export default function Pricing() {
  return (
    <DarkLayout>
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 pt-28 pb-24 text-center">
        <h1 className="font-sans font-black text-5xl text-pastel-cream mb-6">Free to play.</h1>
        <p className="text-lg text-white/70 mb-4">
          Citrus is free to use. No credit card is required.
        </p>
        <p className="text-white/60 mb-8">Stormy includes a weekly question limit, shown in the assistant.</p>
        <Link to="/auth" className="inline-flex rounded-md bg-pastel-orange px-6 py-3 font-bold text-[#581E00]">
          Create your account
        </Link>
      </main>
      <HockeyFooter />
    </DarkLayout>
  );
}
