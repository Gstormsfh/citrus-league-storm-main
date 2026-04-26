import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export interface FooterLink {
  label: string;
  to: string;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

const DEFAULT_COLUMNS: FooterColumn[] = [
  {
    title: 'Play',
    links: [
      { label: 'Create a League', to: '/create-league' },
      { label: 'Daily Pickem', to: '/pool/pickem' },
      { label: 'Survivor', to: '/pool/survivor' },
      { label: 'Confidence Pool', to: '/pool/confidence' },
      { label: 'Stanley Cup Brackets', to: '/nhl/playoffs' },
      { label: 'Mock Draft', to: '/draft' },
    ],
  },
  {
    title: 'Tools',
    links: [
      { label: 'Standings', to: '/standings' },
      { label: 'Free Agents', to: '/free-agents' },
      { label: 'Trade Analyzer', to: '/trade-analyzer' },
      { label: 'Stormy AI', to: '/gm-office/stormy' },
      { label: 'Armchair GM', to: '/armchair-gm' },
    ],
  },
  {
    title: 'Citrus',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Features', to: '/features' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'Blog', to: '/blog' },
      { label: 'Careers', to: '/careers' },
      { label: 'Contact', to: '/contact' },
    ],
  },
];

/**
 * Multi-column dark footer with brand block, link columns, and a bottom row.
 * Every link uses React Router. No fake App Store badges — we ship web only.
 */
export function HockeyFooter({
  columns = DEFAULT_COLUMNS,
  socials = ['X', 'IG', 'YT', 'RD'],
}: {
  columns?: FooterColumn[];
  socials?: string[];
}) {
  return (
    <footer className="relative border-t border-white/5 bg-black/30">
      <div className="max-w-[1280px] mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
          <div className="col-span-2">
            <Link to="/" className="flex items-center gap-1.5 mb-3 w-fit">
              <span className="font-calistoga text-[24px] text-pastel-cream">Citrus</span>
              <span className="block w-1.5 h-1.5 bg-pastel-orange rounded-full" />
            </Link>
            <p className="text-white/45 text-[13px] leading-relaxed mb-5 max-w-xs">
              A 31-feature xG model, live shift-level scoring, and an AI assistant GM who knows
              your roster. Built by hockey heads, for hockey heads.
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
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-[13px] text-white/70 hover:text-pastel-orange-soft transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/5 pt-6 flex items-center justify-between flex-wrap gap-4">
          <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/30 flex items-center gap-2 flex-wrap">
            <span>© 2026 Citrus Fantasy Sports</span>
            <span className="text-white/15">·</span>
            <Link to="/privacy" className="hover:text-white/70 transition-colors">Privacy</Link>
            <span className="text-white/15">·</span>
            <Link to="/terms" className="hover:text-white/70 transition-colors">Terms</Link>
          </div>
          <div className="flex items-center gap-3 text-white/45">
            {socials.map((s) => (
              <a
                key={s}
                href="#"
                aria-label={`Citrus on ${s}`}
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
