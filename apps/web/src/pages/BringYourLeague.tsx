/**
 * BRING YOUR LEAGUE (2026-09-09): the honest version of "we import your
 * settings". There is no Yahoo/ESPN import; what there is, is a founder who
 * will set the league up by hand from whatever the commissioner sends. So
 * the page asks for the league as it exists today and an email, and the
 * details land on the waitlist row (metadata['bring-your-league']). If this
 * form gets traffic, that is the case for building the import.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { DarkLayout, HockeyFooter, MascotAvatar, GlowCard } from '@/components/citrus2';
import { WaitlistService } from '@/services/WaitlistService';
import { usePageMeta } from '@/lib/pageMeta';

export const BRING_YOUR_LEAGUE_SOURCE = 'bring-your-league';

const PLATFORMS = ['Yahoo', 'ESPN', 'Fantrax', 'Sleeper', 'Spreadsheet / group chat', 'Other'];

const field =
  'w-full h-12 rounded-xl bg-white/5 border border-white/10 px-4 text-pastel-cream placeholder:text-white/55 focus:outline-none focus:ring-2 focus:ring-pastel-orange/40';
const label = 'block text-[13px] text-white/65 mb-2';

export default function BringYourLeague() {
  usePageMeta({
    title: 'Bring Your League',
    description: 'Moving a fantasy hockey league to Citrus? Send us your settings and we set it up for you. First season free.',
    path: '/bring-your-league',
  });

  const [form, setForm] = useState({ leagueName: '', platform: PLATFORMS[0], teams: '', scoring: '', email: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const canSubmit = status !== 'sending' && form.email.trim().length > 3 && form.leagueName.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('sending');
    setMessage(null);
    const result = await WaitlistService.addToWaitlist(form.email, BRING_YOUR_LEAGUE_SOURCE, {
      leagueName: form.leagueName.trim().slice(0, 120),
      platform: form.platform,
      teams: form.teams.trim().slice(0, 8),
      scoring: form.scoring.trim().slice(0, 2000),
    });
    setMessage(result.message);
    setStatus(result.success ? 'done' : 'error');
  };

  return (
    <DarkLayout>
      <Navbar />
      <main className="relative pt-24 pb-20">
        <section className="max-w-[1100px] mx-auto px-6 py-12 md:py-16">
          <div className="max-w-3xl mx-auto text-center">
            <div className="flex justify-center mb-6">
              <MascotAvatar id="lemon" size="xl" />
            </div>
            <h1 className="font-sans font-black text-[2.6rem] md:text-[4rem] leading-[0.95] tracking-[-0.035em] text-pastel-cream mb-5">
              Bring your <span className="text-pastel-orange">league</span>
            </h1>
            <p className="text-[17px] md:text-[19px] leading-relaxed text-white/65 max-w-xl mx-auto mb-3">
              Running a league somewhere else? Send us the settings you use today and we build it in Citrus for you:
              roster slots, scoring, keepers, draft format, the lot. Your first season is free.
            </p>
            <p className="text-[14px] text-white/55">A person does this, not a script, so it takes a day. You get the invite link back by email.</p>
          </div>

          <form onSubmit={submit} className="max-w-2xl mx-auto mt-10" data-testid="bring-your-league-form">
            <GlowCard accent="orange">
              <div className="p-6 md:p-8">
                {status === 'done' ? (
                  <div className="text-center" role="status">
                    <p className="font-sans font-black text-[1.4rem] text-pastel-cream mb-2">Got it.</p>
                    <p className="text-[14px] text-white/65 mb-6">{message}</p>
                    <Link to="/features" className="inline-flex items-center gap-2 text-pastel-orange font-bold">
                      See what your league gets <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <label htmlFor="byl-name" className={label}>League name</label>
                      <input id="byl-name" required maxLength={120} value={form.leagueName} onChange={set('leagueName')} className={field} placeholder="The Frozen Pond" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="byl-platform" className={label}>Where it lives today</label>
                        <select id="byl-platform" value={form.platform} onChange={set('platform')} className={field}>
                          {PLATFORMS.map((p) => (
                            <option key={p} value={p} className="text-black">{p}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="byl-teams" className={label}>Teams</label>
                        <input id="byl-teams" inputMode="numeric" maxLength={3} value={form.teams} onChange={set('teams')} className={field} placeholder="12" />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="byl-scoring" className={label}>Scoring and roster, in your own words</label>
                      <textarea
                        id="byl-scoring"
                        rows={5}
                        maxLength={2000}
                        value={form.scoring}
                        onChange={set('scoring')}
                        className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-pastel-cream placeholder:text-white/55 focus:outline-none focus:ring-2 focus:ring-pastel-orange/40"
                        placeholder="H2H points. G 3, A 2, SOG 0.5, hits 0.5, blocks 0.5, W 4, SV 0.2, SO 3. 2C 2LW 2RW 4D 2G 4 bench 1 IR. Snake draft, 2 keepers."
                      />
                      <p className="mt-2 text-[12px] text-white/55">Paste it from your current settings page, or just describe it. We will confirm anything unclear by email.</p>
                    </div>
                    <div>
                      <label htmlFor="byl-email" className={label}>Commissioner email</label>
                      <input id="byl-email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} className={field} placeholder="you@example.com" />
                    </div>
                    {status === 'error' && message && <p role="alert" className="text-sm text-red-300">{message}</p>}
                    <button type="submit" disabled={!canSubmit} className="w-full h-12 rounded-xl bg-pastel-orange text-[#581E00] font-bold disabled:opacity-40">
                      {status === 'sending' ? 'Sending' : 'Set up my league'}
                    </button>
                  </div>
                )}
              </div>
            </GlowCard>
          </form>
        </section>
      </main>
      <HockeyFooter />
    </DarkLayout>
  );
}
