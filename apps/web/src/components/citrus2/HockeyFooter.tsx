import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { CitrusLogo } from './CitrusLogo';
import { MASCOT_LIST } from '@/constants/mascots';

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
      { label: 'Contact', to: '/contact' },
    ],
  },
];

/**
 * Multi-column dark footer.
 *
 * Brand layering:
 * - CitrusLogo SVG glyph + wordmark in the brand block (instead of just text)
 * - Squad lineup row above the bottom border — all 4 mascot avatars in a
 *   horizontal row that links to /about. Small reminder of who lives in
 *   the app.
 * - Hover states on every link tint to pastel-orange-soft.
 */
/**
 * Real social URLs, keyed by the short label rendered in the button.
 *
 * 2026-08-18 launch audit: the social row previously rendered
 * `<a href="#">` for all four handles — real-looking, aria-labelled
 * buttons on the public homepage that did nothing but scroll to top.
 * Add an entry here when an account actually exists and its button
 * appears automatically; while this map is empty the row is not
 * rendered at all, which is strictly better than dead links.
 */
const SOCIAL_LINKS: Record<string, string> = {
  // X: 'https://x.com/…',
  // IG: 'https://instagram.com/…',
  // YT: 'https://youtube.com/@…',
  // RD: 'https://reddit.com/r/…',
};

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
            <Link to="/" className="flex items-center gap-2 mb-3 w-fit group">
              <CitrusLogo className="w-9 h-9 group-hover:scale-110 transition-transform duration-300" variant="on-dark" />
              <span className="font-calistoga text-[24px] text-pastel-cream group-hover:text-pastel-orange-soft transition-colors">
                Citrus
              </span>
              <span className="block w-1.5 h-1.5 bg-pastel-orange rounded-full animate-pulse" />
            </Link>
            <p className="text-white/55 text-[13px] leading-relaxed mb-5 max-w-xs">
              A 31-feature xG model, live shift-level scoring, and an AI assistant GM who knows
              your roster. Built by hockey heads, for hockey heads.
            </p>
            <Link
              to="/create-league"
              className="inline-flex items-center gap-2 bg-pastel-orange text-[#581E00] text-[13px] font-bold px-5 h-10 rounded-md hover:bg-pastel-orange-soft hover:-translate-y-0.5 transition-all duration-200 shadow-[0_4px_16px_-4px_rgba(255,107,26,0.5)] active:scale-95"
            >
              Create a league <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
            </Link>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55 mb-3 font-bold">
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

        {/* Squad lineup — Sleeper-style brand layering */}
        <div className="border-t border-white/5 pt-6 mb-6 flex items-center justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-white/55 font-bold">
              The Squad
            </span>
            <Link to="/about" className="flex items-center -space-x-2 group">
              {MASCOT_LIST.map((m) => (
                <img
                  key={m.id}
                  src={m.image}
                  alt={m.name}
                  className="w-9 h-9 rounded-full ring-2 ring-pastel-surface object-cover transition-transform group-hover:scale-105 hover:!scale-110 hover:z-10 relative"
                  loading="lazy"
                />
              ))}
            </Link>
          </div>
          {/* 2026-08-18 launch audit: these were four <a href="#"> stubs
              rendered as real, aria-labelled social buttons on the public
              homepage and eight other pages. Clicking one jumped the user
              to the top of the page and did nothing — worse than not
              being there, because it reads as a broken site. Rendered
              only for socials that have a REAL url; the row disappears
              entirely while SOCIAL_LINKS is empty. Fill in the handles
              here when the accounts exist. */}
          {Object.keys(SOCIAL_LINKS).length > 0 && (
            <div className="flex items-center gap-3 text-white/55">
              {socials
                .filter((s) => SOCIAL_LINKS[s])
                .map((s) => (
                  <a
                    key={s}
                    href={SOCIAL_LINKS[s]}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Citrus on ${s}`}
                    className="w-8 h-8 rounded-md bg-white/5 ring-1 ring-white/10 flex items-center justify-center font-jbmono text-[10px] font-bold hover:text-pastel-orange-soft hover:ring-pastel-orange/40 hover:bg-pastel-orange/10 transition-all duration-200"
                  >
                    {s}
                  </a>
                ))}
            </div>
          )}
        </div>

        <div className="border-t border-white/5 pt-6">
          <div className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55 flex items-center gap-2 flex-wrap">
            <span>© 2026 Citrus Fantasy Sports</span>
            <span className="text-white/15">·</span>
            <Link to="/privacy" className="hover:text-white/70 transition-colors">Privacy</Link>
            <span className="text-white/15">·</span>
            <Link to="/terms" className="hover:text-white/70 transition-colors">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
