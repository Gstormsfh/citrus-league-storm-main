import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const DEFAULT_COLUMNS = [
  { title: 'Play', links: ['Fantasy Hockey', 'Pickem', 'Survivor', 'Confidence', 'Brackets', 'Mock Draft'] },
  { title: 'Tools', links: ['Projections', 'Live Scores', 'Stormy AI', 'Trade Analyzer', 'Free Agents'] },
  { title: 'Citrus', links: ['About', 'Careers', 'Blog', 'Contact', 'Privacy', 'Terms'] },
];

/**
 * Multi-column dark footer with brand block, link columns, and a bottom row.
 * No fake App Store badges — we ship web only and don't promise mobile apps.
 */
export function HockeyFooter({
  columns = DEFAULT_COLUMNS,
  socials = ['X', 'IG', 'YT', 'RD'],
}: {
  columns?: { title: string; links: string[] }[];
  socials?: string[];
}) {
  return (
    <footer className="relative border-t border-white/5 bg-black/30">
      <div className="max-w-[1280px] mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
          <div className="col-span-2">
            <div className="flex items-center gap-1.5 mb-3">
              <span className="font-calistoga text-[24px] text-pastel-cream">Citrus</span>
              <span className="block w-1.5 h-1.5 bg-pastel-orange rounded-full" />
            </div>
            <p className="text-white/45 text-[13px] leading-relaxed mb-5 max-w-xs">
              A 31-feature xG model, live shift-level scoring, and an AI assistant GM who knows your roster. Built by hockey heads, for hockey heads.
            </p>
            <Link
              to="/create-league"
              className="inline-flex items-center gap-2 bg-pastel-orange text-white text-[13px] font-bold px-5 h-10 rounded-md hover:bg-pastel-orange-deep transition-colors"
            >
              Create a league <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
            </Link>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/45 mb-3 font-bold">
                {col.title}
              </div>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="text-[13px] text-white/70 hover:text-pastel-orange-soft transition-colors">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/5 pt-6 flex items-center justify-between flex-wrap gap-4">
          <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/30">
            © 2026 Citrus Fantasy Sports · Privacy · Terms · Responsible Play
          </div>
          <div className="flex items-center gap-3 text-white/45">
            {socials.map((s) => (
              <a
                key={s}
                href="#"
                className="w-8 h-8 rounded-md bg-white/5 ring-1 ring-white/10 flex items-center justify-center font-jbmono text-[10px] font-bold hover:text-pastel-orange-soft hover:ring-pastel-orange/40 transition-colors"
              >
                {s}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
