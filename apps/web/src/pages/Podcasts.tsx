import { Play, Headphones, Rss } from 'lucide-react';
import Navbar from '@/components/Navbar';
import {
  DarkLayout,
  HockeyFooter,
  GlowCard,
  MascotPeek,
  CtaBanner,
  LivePulse,
} from '@/components/citrus2';

const podcastEpisodes = [
  {
    id: 1,
    title: 'Inside the Draft Room: Expert Strategies',
    description: 'Our experts break down their strategies for fantasy drafts this season.',
    coverImage: 'https://images.unsplash.com/photo-1610945265064-0e34e5d9545d?q=80&w=600&auto=format&fit=crop',
    duration: '42:15',
    date: 'April 3, 2025',
  },
  {
    id: 2,
    title: 'Waiver Wire Warriors: Week 10 Pickups',
    description: 'Which players should you target on the waiver wire this week?',
    coverImage: 'https://images.unsplash.com/photo-1589903308904-1010c2294adc?q=80&w=600&auto=format&fit=crop',
    duration: '39:48',
    date: 'March 30, 2025',
  },
  {
    id: 3,
    title: "Start 'Em, Sit 'Em: Week 9 Breakdown",
    description: 'Our weekly analysis of which players to start and which to bench.',
    coverImage: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?q=80&w=600&auto=format&fit=crop',
    duration: '45:22',
    date: 'March 27, 2025',
  },
  {
    id: 4,
    title: 'Deep Dives: Uncovering Hidden Value',
    description: 'We analyze overlooked players who could provide significant fantasy value.',
    coverImage: 'https://images.unsplash.com/photo-1549451371-64aa98a6f660?q=80&w=600&auto=format&fit=crop',
    duration: '51:07',
    date: 'March 23, 2025',
  },
];

const PLATFORMS = [
  { name: 'Apple', svg: <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/> },
  { name: 'Spotify', svg: <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12C24 5.4 18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/> },
  { name: 'Google', svg: <path d="M12 0c-6.626 0-12 5.374-12 12s5.374 12 12 12 12-5.374 12-12S18.626 0 12 0zm-1.4 16.95c-.81-.81-2.04-.81-2.85 0l-1.5-1.5c1.62-1.62 4.23-1.62 5.85 0L10.6 16.95zM6.85 13.2L5.4 11.7c2.94-2.94 7.71-2.94 10.65 0l-1.5 1.5c-2.13-2.13-5.55-2.13-7.7 0z"/> },
  { name: 'RSS', svg: <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/> },
];

const Podcasts = () => {
  return (
    <DarkLayout>
      <Navbar />
      <main className="relative max-w-[1280px] mx-auto px-6 pt-28 pb-16">
        {/* Hero — Lemon mascot peek (the loud one — voice on the mic) */}
        <section className="relative max-w-[860px] mx-auto px-2 pb-12 text-center">
          <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-4 font-bold flex items-center justify-center gap-2">
            <LivePulse size="xs" /> On Air
          </div>
          <h1 className="font-sans font-black text-[2.5rem] md:text-[4rem] leading-[0.98] tracking-[-0.035em] text-pastel-cream mb-5">
            Citrus <span className="text-pastel-orange">Podcasts</span>.
          </h1>
          <p className="text-[16px] md:text-[18px] leading-relaxed text-white/65 max-w-xl mx-auto">
            Expert analysis, interviews, and advice for your fantasy hockey journey.
          </p>
        </section>

        {/* Featured + Subscribe split */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-12">
          <div className="lg:col-span-2">
            <GlowCard accent="orange">
              <div className="relative h-64 md:h-80 overflow-hidden">
                <img
                  src="https://images.unsplash.com/photo-1598327105666-5b89351aff97?q=80&w=2000&auto=format&fit=crop"
                  alt="Featured Podcast"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0F1F15] via-[#0F1F15]/70 to-transparent flex flex-col justify-end p-6">
                  <span className="bg-pastel-orange text-[#581E00] text-[10px] font-jbmono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md mb-3 inline-block w-fit ring-1 ring-pastel-orange/40">
                    Featured Episode
                  </span>
                  <h2 className="font-sans font-black text-[1.5rem] md:text-[2rem] tracking-[-0.025em] text-pastel-cream mb-2 leading-tight">
                    Championship Mindset: <span className="text-pastel-orange">Winning Strategies</span>
                  </h2>
                  <p className="text-[14px] text-white/75 mb-4 line-clamp-2 max-w-2xl">
                    Join our hosts as they discuss championship-winning strategies with three-time fantasy champion Marcus Johnson.
                  </p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button className="inline-flex items-center gap-2 bg-pastel-orange hover:bg-pastel-orange-deep text-white text-[13px] font-bold px-5 h-10 rounded-md hover:-translate-y-0.5 active:scale-95 transition-all duration-200 shadow-[0_4px_16px_-4px_rgba(255,107,26,0.5)]">
                      <Play className="w-4 h-4 fill-white" strokeWidth={0} />
                      Play Episode
                    </button>
                    <span className="font-jbmono text-[11px] uppercase tracking-wider text-white/55 tabular-nums">56:24 mins · April 5, 2025</span>
                  </div>
                </div>
              </div>
            </GlowCard>
          </div>

          <div className="lg:col-span-1">
            <GlowCard accent="sage">
              <div className="p-6 h-full flex flex-col relative overflow-hidden">
                <MascotPeek id="lemon" position="top-right" size="sm" />
                <div className="flex items-center gap-2 mb-4 relative z-10">
                  <Headphones className="w-5 h-5 text-pastel-orange" strokeWidth={2.5} />
                  <h3 className="font-sans font-bold text-[18px] text-pastel-cream tracking-[-0.015em]">Subscribe</h3>
                </div>
                <p className="text-[13px] text-white/65 mb-5 leading-relaxed relative z-10">
                  Get the latest episodes delivered to your favorite platform.
                </p>
                <div className="grid grid-cols-2 gap-2 relative z-10">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.name}
                      className="flex items-center justify-center gap-2 px-3 h-10 rounded-md bg-white/5 ring-1 ring-white/10 hover:ring-pastel-orange/40 hover:bg-pastel-orange/10 transition-all duration-200 text-pastel-cream text-[12px] font-bold"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        {p.svg}
                      </svg>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            </GlowCard>
          </div>
        </section>

        {/* Latest episodes */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold mb-1">
                ✦ Recently Recorded
              </div>
              <h2 className="font-sans font-black text-[1.75rem] tracking-[-0.025em] text-pastel-cream">Latest Episodes</h2>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {podcastEpisodes.map((episode) => (
              <GlowCard key={episode.id} accent="orange">
                <article className="flex overflow-hidden h-full">
                  <div className="w-1/3 relative">
                    <img
                      src={episode.coverImage}
                      alt={episode.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#1A2A20]" />
                  </div>
                  <div className="w-2/3 p-4 flex flex-col">
                    <h3 className="font-sans font-bold text-[16px] text-pastel-cream mb-2 leading-tight line-clamp-1 tracking-[-0.015em]">
                      {episode.title}
                    </h3>
                    <p className="text-[13px] text-white/60 mb-3 line-clamp-2 leading-relaxed flex-1">
                      {episode.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="font-jbmono text-[10px] uppercase tracking-wider text-white/45 tabular-nums">
                        {episode.duration} · {episode.date}
                      </span>
                      <button className="inline-flex items-center gap-1.5 text-[12px] font-bold text-pastel-orange-soft hover:text-pastel-orange transition-colors">
                        <Play className="w-3 h-3 fill-current" strokeWidth={0} />
                        Play
                      </button>
                    </div>
                  </div>
                </article>
              </GlowCard>
            ))}
          </div>
        </section>

        <div className="text-center mb-12">
          <button className="inline-flex items-center gap-2 bg-white/5 hover:bg-pastel-orange/10 ring-1 ring-white/15 hover:ring-pastel-orange/40 text-pastel-cream text-[14px] font-bold px-6 h-11 rounded-md transition-all duration-200">
            <Rss className="w-4 h-4" strokeWidth={2.5} />
            View All Episodes
          </button>
        </div>
      </main>

      <CtaBanner
        title={
          <>
            Listen up. <span className="text-pastel-orange">Then dominate.</span>
          </>
        }
        sub="Free during launch · Founders pricing locked in for early users"
        ctaLabel="Create your league"
        ctaHref="/create-league"
      />

      <HockeyFooter />
    </DarkLayout>
  );
};

export default Podcasts;
