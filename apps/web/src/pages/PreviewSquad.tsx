import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle, Trophy, Flame } from 'lucide-react';

const NAV = ['My Squad', 'Leagues', 'Drafts', 'Stormy AI'];

const CHAT_PREVIEW = [
  { from: 'JK', name: 'Jordan', side: 'left', tone: 'sage', msg: "team! Ready for the draft tomorrow night?" },
  { from: 'AM', name: 'Alex', side: 'right', tone: 'cream', msg: "So excited! Got my strategy locked in." },
  { from: 'SD', name: 'Sam', side: 'left', tone: 'sage', msg: "Stormy says I should take a goalie in round 3 lol" },
  { from: 'TR', name: 'Taylor', side: 'right', tone: 'cream', msg: "league standings update!", embed: 'standings' },
];

const SQUAD = [
  { initials: 'JK', name: 'Jordan', team: 'Puckmasters', record: '14-4', tone: 'sage' },
  { initials: 'AM', name: 'Alex', team: 'Ice Wizards', record: '13-5', tone: 'orange' },
  { initials: 'SD', name: 'Sam', team: 'Hat Trick Heroes', record: '12-6', tone: 'butter' },
  { initials: 'TR', name: 'Taylor', team: 'Sage Slappers', record: '11-7', tone: 'sage' },
  { initials: 'MV', name: 'Morgan', team: 'Citrus Crushers', record: '10-8', tone: 'orange' },
  { initials: 'KP', name: 'Kai', team: 'Power Play Pals', record: '9-9', tone: 'butter' },
];

const TONE_BG: Record<string, string> = {
  sage: 'bg-pastel-sage-soft',
  orange: 'bg-pastel-peach',
  butter: 'bg-pastel-butter',
};

export default function PreviewSquad() {
  return (
    <div
      className="min-h-screen text-pastel-forest"
      style={{
        background:
          'linear-gradient(180deg, #E8EED9 0%, #F0EBD8 30%, #FFF8F0 60%, #FFEDDB 100%)',
      }}
    >
      {/* Nav */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-white/55 border-b border-white/60">
        <div className="max-w-[1240px] mx-auto px-6 h-16 flex items-center justify-between gap-6">
          <Link to="/preview-squad" className="flex items-center gap-1.5">
            <span className="font-calistoga text-[24px] leading-none text-pastel-forest">Citrus</span>
            <span aria-hidden="true" className="block w-1.5 h-1.5 bg-pastel-orange rounded-full" />
          </Link>
          <nav className="hidden md:flex items-center gap-7">
            {NAV.map((label) => (
              <a
                key={label}
                href="#"
                className="text-[14px] font-medium text-pastel-forest-soft hover:text-pastel-forest transition-colors"
              >
                {label}
              </a>
            ))}
          </nav>
          <Link
            to="/create-league"
            className="text-[13px] font-semibold px-4 h-10 inline-flex items-center bg-pastel-orange text-white hover:bg-pastel-orange-deep rounded-full transition-colors shadow-[0_4px_0_0_rgba(192,74,14,0.25)]"
          >
            Start a Squad
          </Link>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-[1240px] mx-auto px-6 pt-16 lg:pt-24 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* LEFT — copy */}
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 mb-7 px-3.5 py-1.5 rounded-full bg-white/60 ring-1 ring-pastel-sage/40">
              <MessageCircle className="w-3 h-3 text-pastel-sage" strokeWidth={2.5} />
              <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft leading-none">
                Built for the group chat
              </span>
            </div>
            <h1 className="font-sans font-bold text-[3rem] sm:text-[3.75rem] lg:text-[4.75rem] leading-[1.02] tracking-[-0.025em] text-pastel-forest mb-6">
              It's not fantasy<br />
              without your{' '}
              <em className="font-calistoga not-italic font-normal text-pastel-orange-deep">friends</em>.
            </h1>
            <p className="text-[17px] md:text-[18px] leading-relaxed text-pastel-forest-soft max-w-md mb-8">
              League chat, trash talk, draft-night reactions, and a standings table that lives
              right in your group thread. Your league is a place, not a spreadsheet.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4 mb-10">
              <Link
                to="/create-league"
                className="group inline-flex items-center gap-2 bg-pastel-forest text-pastel-cream text-[15px] font-semibold pl-7 pr-6 rounded-full hover:bg-pastel-orange-deep hover:-translate-y-0.5 transition-all duration-200 shadow-[0_8px_24px_-8px_rgba(27,48,34,0.4)]"
                style={{ height: '52px' }}
              >
                <span>Start your squad</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
              </Link>
              <a
                href="#squad"
                className="text-[14px] font-semibold text-pastel-forest hover:text-pastel-orange-deep transition-colors group"
              >
                See a sample league{' '}
                <span className="inline-block group-hover:translate-x-0.5 transition-transform">→</span>
              </a>
            </div>

            {/* Inline chat preview card */}
            <div className="bg-white/75 backdrop-blur-md ring-1 ring-pastel-sage/30 rounded-3xl p-5 max-w-md">
              <div className="flex items-center gap-3 pb-3 mb-3 border-b border-pastel-sage/30">
                <div className="flex -space-x-2">
                  {['JK', 'AM', 'SD'].map((init, i) => (
                    <div
                      key={init}
                      className="w-7 h-7 rounded-full bg-pastel-sage-soft ring-2 ring-white flex items-center justify-center font-jbmono text-[9px] font-semibold text-pastel-forest"
                      style={{ zIndex: 3 - i }}
                    >
                      {init}
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-sans font-semibold text-[13px] text-pastel-forest leading-tight">
                    Sunday Beer League
                  </div>
                  <div className="font-jbmono text-[10px] text-pastel-forest-dim mt-0.5">
                    12 members · active now
                  </div>
                </div>
              </div>
              <div className="space-y-2.5">
                {CHAT_PREVIEW.slice(0, 3).map((m, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 items-end ${m.side === 'right' ? 'justify-end' : ''}`}
                  >
                    {m.side === 'left' && (
                      <div className="w-6 h-6 rounded-full bg-pastel-sage-soft flex items-center justify-center font-jbmono text-[8px] font-semibold text-pastel-forest flex-shrink-0">
                        {m.from}
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] px-3.5 py-2 rounded-2xl text-[13px] text-pastel-forest leading-snug ${
                        m.tone === 'sage' ? 'bg-pastel-sage-soft' : 'bg-pastel-cream-warm'
                      }`}
                    >
                      {m.msg}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 bg-pastel-sage-soft/50 rounded-full px-4 py-2 text-[12px] text-pastel-forest-dim">
                  Type a message...
                </div>
                <button className="w-9 h-9 rounded-full bg-pastel-orange flex items-center justify-center text-white">
                  <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT — phone hero */}
          <div className="lg:col-span-6 relative">
            <div
              aria-hidden="true"
              className="absolute inset-0 -m-8 rounded-full opacity-50 blur-3xl"
              style={{ background: 'radial-gradient(circle, #C8DCC4 0%, transparent 60%)' }}
            />
            <img
              src="/mockups/squad-phone-hero.jpg"
              alt=""
              aria-hidden="true"
              className="relative w-full max-w-[520px] mx-auto rounded-[32px] animate-float-slow drop-shadow-[0_30px_50px_rgba(27,48,34,0.18)]"
              loading="eager"
            />
          </div>
        </div>
      </section>

      {/* SQUAD GRID */}
      <section id="squad" className="max-w-[1240px] mx-auto px-6 pb-20">
        <div className="flex items-baseline justify-between mb-8 gap-4 flex-wrap">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-deep mb-1">
              Sample Squad · Sunday Beer League
            </div>
            <h2 className="font-sans font-bold text-[2.25rem] md:text-[2.5rem] tracking-[-0.02em] text-pastel-forest leading-tight">
              Your league. Your people.
            </h2>
          </div>
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-soft">
            12 members · Week 12 · 2025–26
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SQUAD.map((s, i) => (
            <article
              key={s.name}
              className={`${TONE_BG[s.tone]} rounded-[20px] p-5 ring-1 ring-pastel-forest/8 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-12px_rgba(27,48,34,0.18)] transition-all`}
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-white ring-2 ring-pastel-forest/10 flex items-center justify-center font-jbmono text-[12px] font-bold text-pastel-forest flex-shrink-0">
                  {s.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-sans font-semibold text-[15px] text-pastel-forest truncate">
                    {s.team}
                  </div>
                  <div className="font-jbmono text-[10px] tracking-wider uppercase text-pastel-forest-soft mt-0.5">
                    {s.name}
                  </div>
                </div>
                {i < 3 && (
                  <span className="px-2 py-0.5 rounded-full bg-white/60 font-jbmono text-[9px] tracking-wider uppercase text-pastel-orange-deep font-semibold">
                    {i === 0 ? '1st' : i === 1 ? '2nd' : '3rd'}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
                <span className="font-jbmono text-[10px] tracking-wider uppercase text-pastel-forest-dim">
                  W-L-T
                </span>
                <span className="font-jbmono text-[14px] font-semibold text-pastel-forest tabular-nums">
                  {s.record}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* THREE FEATURE BLOCKS */}
      <section className="max-w-[1240px] mx-auto px-6 pb-20 grid grid-cols-1 md:grid-cols-3 gap-5">
        {[
          {
            icon: MessageCircle,
            label: 'League chat',
            body: 'Real-time messages, draft-night reactions, gif support. Your league chat lives where the league lives — no Discord needed.',
          },
          {
            icon: Trophy,
            label: 'Trophy room',
            body: 'Champions, runner-ups, last-place legends. Your league history is preserved season after season — with bragging rights intact.',
          },
          {
            icon: Flame,
            label: 'Trash talk',
            body: 'Built-in reactions, weekly recaps, and custom matchup names. Sometimes losing badly is the best part.',
          },
        ].map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.label}
              className="bg-white/70 backdrop-blur-md ring-1 ring-pastel-sage/30 rounded-[24px] p-7"
            >
              <div className="w-11 h-11 rounded-2xl bg-pastel-sage-soft flex items-center justify-center text-pastel-forest mb-5">
                <Icon className="w-5 h-5" strokeWidth={2} />
              </div>
              <h3 className="font-sans font-bold text-[1.25rem] leading-snug text-pastel-forest mb-3">
                {f.label}
              </h3>
              <p className="text-[14px] text-pastel-forest-soft leading-relaxed">{f.body}</p>
            </div>
          );
        })}
      </section>

      {/* Final CTA */}
      <section className="max-w-[1240px] mx-auto px-6 pb-20">
        <div className="bg-pastel-sage-soft rounded-[28px] p-10 md:p-14 text-center ring-1 ring-pastel-sage/40 relative overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute -bottom-20 -right-20 w-[280px] h-[280px] rounded-full opacity-50 blur-3xl"
            style={{ background: 'radial-gradient(circle, #FFB591 0%, transparent 70%)' }}
          />
          <div className="relative">
            <div className="flex justify-center -space-x-2 mb-5">
              {['JK', 'AM', 'SD', 'TR', 'MV'].map((init, i) => (
                <div
                  key={init}
                  className="w-10 h-10 rounded-full bg-white ring-2 ring-pastel-sage-soft flex items-center justify-center font-jbmono text-[11px] font-semibold text-pastel-forest"
                  style={{ zIndex: 5 - i }}
                >
                  {init}
                </div>
              ))}
            </div>
            <h2 className="font-sans font-bold text-[2.25rem] md:text-[3rem] leading-[1.05] tracking-[-0.025em] text-pastel-forest mb-5">
              Get the band{' '}
              <em className="font-calistoga not-italic font-normal text-pastel-orange-deep">together</em>.
            </h2>
            <p className="text-[16px] text-pastel-forest-soft max-w-md mx-auto mb-8">
              Spin up a free league, drop the invite link in the group chat, draft together
              tonight.
            </p>
            <Link
              to="/create-league"
              className="inline-flex items-center gap-2 bg-pastel-orange text-white text-[15px] font-semibold pl-7 pr-6 rounded-full hover:bg-pastel-forest transition-colors shadow-[0_8px_24px_-8px_rgba(255,107,26,0.5)]"
              style={{ height: '52px' }}
            >
              <span>Start your squad</span>
              <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-pastel-sage/30 py-8 text-center">
        <div className="font-calistoga text-[18px] text-pastel-forest mb-1">Citrus</div>
        <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-dim">
          © 2026 · Made in California with sage and sunshine
        </div>
      </footer>
    </div>
  );
}
