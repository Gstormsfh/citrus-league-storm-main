import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const NAV_LINKS = ['Tonight', 'Standings', 'Field Notes', 'Almanac'];

const STANDINGS = [
  { rank: 1, name: 'Connor McDavid', team: 'EDM', pos: 'C', proj: 9.4, dev: 2.1, change: '+0.3' },
  { rank: 2, name: 'Auston Matthews', team: 'TOR', pos: 'C', proj: 8.7, dev: 1.9, change: '+0.1' },
  { rank: 3, name: 'Nathan MacKinnon', team: 'COL', pos: 'C', proj: 8.6, dev: 2.0, change: '−0.2' },
  { rank: 4, name: 'Leon Draisaitl', team: 'EDM', pos: 'C', proj: 8.1, dev: 1.7, change: '+0.4' },
  { rank: 5, name: 'David Pastrnak', team: 'BOS', pos: 'RW', proj: 7.9, dev: 1.8, change: '+0.0' },
  { rank: 6, name: 'Mikko Rantanen', team: 'COL', pos: 'RW', proj: 7.6, dev: 1.7, change: '+0.2' },
  { rank: 7, name: 'Cale Makar', team: 'COL', pos: 'D', proj: 7.2, dev: 1.6, change: '+0.1' },
  { rank: 8, name: 'Quinn Hughes', team: 'VAN', pos: 'D', proj: 6.8, dev: 1.5, change: '−0.1' },
  { rank: 9, name: 'Igor Shesterkin', team: 'NYR', pos: 'G', proj: 12.4, dev: 3.1, change: '+0.6' },
  { rank: 10, name: 'Jake Oettinger', team: 'DAL', pos: 'G', proj: 10.8, dev: 2.8, change: '+0.2' },
];

const DISPATCHES = [
  {
    section: 'On the Wire',
    headline: 'McDavid centers a fresh top line.',
    body: "Coach Knoblauch reunites McDavid with Hyman and Foegele after the morning skate. Our model bumps EDM line one by 4.1% in shot-share.",
  },
  {
    section: 'Field Notes',
    headline: 'Goalie carousel in Tampa.',
    body: "Vasilevskiy gets the night off; Johansson draws in. Our updated GSAx says expect a +0.4 GA edge for the Sabres tonight.",
  },
  {
    section: 'The Numbers',
    headline: 'Why Saturday matters most.',
    body: "Twelve teams in action means a single starter can shape your week. We project 73% of league outcomes are decided after 8pm ET.",
  },
];

export default function PreviewAlmanac() {
  return (
    <div
      className="min-h-screen"
      style={{
        background:
          "#E8EED9 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0.106  0 0 0 0 0.188  0 0 0 0 0.133  0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")",
        color: '#1B3022',
      }}
    >
      {/* MASTHEAD */}
      <div className="border-b-[3px] border-double border-pastel-forest/80">
        <div className="max-w-[1200px] mx-auto px-6 py-2.5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest/70">
            <span>Vol. I · No. 12</span>
            <span className="text-pastel-forest/30">·</span>
            <span>Saturday, April 26</span>
            <span className="text-pastel-forest/30 hidden md:inline">·</span>
            <span className="hidden md:inline">7-Game Slate</span>
          </div>
          <Link
            to="/auth"
            className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest/80 hover:text-pastel-forest underline underline-offset-4 decoration-1"
          >
            Subscribe · Sign in
          </Link>
        </div>
      </div>

      {/* COVER */}
      <header className="max-w-[1200px] mx-auto px-6 pt-12 pb-12">
        <div className="text-center">
          <div className="font-jbmono text-[11px] tracking-[0.36em] uppercase text-pastel-forest-soft mb-4">
            ✦ The Citrus Orchard Almanac ✦
          </div>
          <h1 className="font-calistoga text-[3.5rem] sm:text-[5rem] md:text-[6rem] leading-[0.95] text-pastel-forest mb-5 tracking-[-0.01em]">
            Fantasy hockey,<br />
            <em className="font-editorial italic font-normal text-pastel-forest-soft">written by the numbers.</em>
          </h1>
          <p className="font-editorial italic text-[18px] md:text-[20px] text-pastel-forest-soft leading-relaxed max-w-2xl mx-auto">
            A weekly almanac for the considered manager. Thirty-one features, nineteen-thousand
            simulations, one hand-stitched edge — published every Saturday morning.
          </p>
        </div>

        {/* Wire nav */}
        <nav className="mt-10 pt-5 border-t border-pastel-forest/40 flex items-center justify-center gap-6 md:gap-10 flex-wrap">
          {NAV_LINKS.map((label) => (
            <a
              key={label}
              href="#"
              className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-forest hover:text-pastel-orange transition-colors"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      {/* LEAD STORY */}
      <section className="max-w-[1200px] mx-auto px-6 pt-8 pb-16 border-t-[3px] border-double border-pastel-forest/80">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* LEFT — hero asset */}
          <div className="lg:col-span-7">
            <img
              src="/mockups/almanac-still-life.jpg"
              alt=""
              aria-hidden="true"
              className="w-full aspect-square object-cover ring-1 ring-pastel-forest/15 shadow-[0_4px_0_0_rgba(27,48,34,0.08)]"
              loading="eager"
            />
            <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest/55 mt-3 italic font-editorial normal-case tracking-normal">
              Photograph by the editors. Week 12 notes from a manager who keeps a paper book.
            </div>
          </div>

          {/* RIGHT — story */}
          <div className="lg:col-span-5 flex flex-col">
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-deep mb-3">
              Lead Story · Tonight
            </div>
            <h2 className="font-calistoga text-[1.85rem] md:text-[2.15rem] leading-[1.1] text-pastel-forest mb-5">
              Saturday's seven-game slate, simulated nineteen-thousand ways.
            </h2>
            <p className="font-editorial text-[17px] leading-[1.75] text-pastel-forest-soft">
              <span className="font-calistoga text-[3.5rem] float-left mr-3 mt-2 leading-[0.78] text-pastel-orange-deep">
                A
              </span>
              fter a quiet Friday, tonight's slate runs heavy in the West. Edmonton hosts Colorado
              in a game both teams need; we have McDavid projected for 9.4 fantasy points with a
              ceiling of 12.1 — the highest of the night. Toronto in Montreal is the value play
              for the Canadiens stack, and Igor Shesterkin draws Boston for what our Bayesian
              shrinkage model calls a near-pristine GSAx matchup.
            </p>
            <p className="font-editorial text-[17px] leading-[1.75] text-pastel-forest-soft mt-5">
              The full standings, our top ten projections, and dispatches from the wire — below.
            </p>
            <Link
              to="/create-league"
              className="group inline-flex items-center gap-2 mt-9 self-start bg-pastel-forest text-pastel-cream text-[14px] font-medium tracking-[0.08em] uppercase pl-6 pr-5 h-12 rounded-none ring-1 ring-pastel-forest hover:bg-pastel-orange-deep hover:ring-pastel-orange-deep transition-colors"
            >
              <span>Start a Test League</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </section>

      {/* THE STANDINGS — print table */}
      <section className="max-w-[1200px] mx-auto px-6 py-16 border-t border-pastel-forest/30">
        <div className="flex items-baseline justify-between mb-8 gap-6 flex-wrap">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-deep mb-1">
              ✦ Section II
            </div>
            <h3 className="font-calistoga text-[2.25rem] md:text-[2.5rem] text-pastel-forest leading-tight">
              Tonight's Top Projections
            </h3>
          </div>
          <span className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest/55">
            31 features · 1,247 sims · Updated 14s ago
          </span>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-y-2 border-pastel-forest/80">
              {['#', 'Skater', 'Club', 'Pos', 'Proj', '±σ', 'Δ since AM'].map((h, i) => (
                <th
                  key={h}
                  className={`font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest/65 py-3 ${
                    i >= 4 ? 'text-right' : 'text-left'
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STANDINGS.map((row, i) => (
              <tr
                key={row.name}
                className={`border-b border-pastel-forest/15 hover:bg-pastel-sage-soft/30 transition-colors ${
                  i % 2 === 1 ? 'bg-pastel-sage-soft/10' : ''
                }`}
              >
                <td className="py-3 font-jbmono text-[12px] text-pastel-forest-dim">
                  {String(row.rank).padStart(2, '0')}
                </td>
                <td className="py-3">
                  <span className="font-calistoga text-[17px] text-pastel-forest">{row.name}</span>
                </td>
                <td className="py-3 font-jbmono text-[11px] uppercase tracking-wider text-pastel-forest-soft">
                  {row.team}
                </td>
                <td className="py-3 font-jbmono text-[11px] uppercase tracking-wider text-pastel-forest-soft">
                  {row.pos}
                </td>
                <td className="py-3 text-right font-jbmono text-[15px] text-pastel-forest tabular-nums font-semibold">
                  {row.proj.toFixed(1)}
                </td>
                <td className="py-3 text-right font-jbmono text-[12px] text-pastel-forest-dim tabular-nums">
                  ±{row.dev.toFixed(1)}
                </td>
                <td
                  className={`py-3 text-right font-jbmono text-[12px] tabular-nums ${
                    row.change.startsWith('+')
                      ? 'text-pastel-forest-soft'
                      : row.change.startsWith('−')
                      ? 'text-pastel-orange-deep'
                      : 'text-pastel-forest-dim'
                  }`}
                >
                  {row.change}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* DISPATCHES — three columns */}
      <section className="max-w-[1200px] mx-auto px-6 py-16 border-t border-pastel-forest/30">
        <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-deep mb-1">
          ✦ Section III
        </div>
        <h3 className="font-calistoga text-[2.25rem] md:text-[2.5rem] text-pastel-forest mb-10 leading-tight">
          Dispatches from the Wire
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:divide-x md:divide-pastel-forest/20">
          {DISPATCHES.map((d, i) => (
            <article key={d.headline} className={i > 0 ? 'md:pl-10' : ''}>
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-forest/55 mb-2">
                {d.section}
              </div>
              <h4 className="font-calistoga text-[1.5rem] leading-tight text-pastel-forest mb-4">
                {d.headline}
              </h4>
              <p className="font-editorial text-[15px] leading-[1.75] text-pastel-forest-soft">
                {d.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* COLOPHON / FOOTER */}
      <footer className="border-t-[3px] border-double border-pastel-forest/80 py-10">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <div className="font-calistoga text-[1.75rem] text-pastel-forest mb-2">Citrus</div>
          <p className="font-editorial italic text-[14px] text-pastel-forest-soft mb-4">
            Published Saturday mornings · Made in California with sage and sunshine
          </p>
          <p className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-pastel-forest-dim">
            ✦ Vol. I · No. 12 · 2026 ✦
          </p>
        </div>
      </footer>
    </div>
  );
}
