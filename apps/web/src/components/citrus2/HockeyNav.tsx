import { Link } from 'react-router-dom';

export interface NavLink {
  label: string;
  to: string;
}

const DEFAULT_LINKS: NavLink[] = [
  { label: 'Features', to: '/features' },
  { label: 'Pickem', to: '/pool/pickem' },
  { label: 'Brackets', to: '/nhl/playoffs' },
  { label: 'Stormy', to: '/gm-office/stormy' },
  { label: 'Pricing', to: '/pricing' },
];

/**
 * Sticky dark nav with optional promo banner above. Used at the top of every
 * citrus2 page. Coexists with the legacy `Navbar.tsx` so unmigrated pages keep
 * their current shell.
 *
 * All links use React Router so route transitions stay client-side. Default
 * `links` point to real public routes — pages can override with their own
 * link sets.
 */
export function HockeyNav({
  links = DEFAULT_LINKS,
  promo,
  ctaLabel = 'Get the App',
  ctaHref = '/create-league',
  showLogin = true,
}: {
  links?: NavLink[];
  /** Optional promo banner content above the nav */
  promo?: React.ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
  showLogin?: boolean;
}) {
  return (
    <>
      {promo && (
        <div className="relative z-50 bg-gradient-to-r from-pastel-orange/15 via-pastel-orange/25 to-pastel-orange/15 border-b border-pastel-orange/30">
          <div className="max-w-[1280px] mx-auto px-6 py-2 text-center">
            <span className="font-jbmono text-[11px] tracking-[0.18em] uppercase text-pastel-orange-soft font-bold">
              {promo}
            </span>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[#0F1F15]/85 border-b border-white/5">
        <div className="max-w-[1280px] mx-auto px-6 h-[68px] flex items-center justify-between gap-6">
          <div className="flex items-center gap-10">
            <Link to="/" className="flex items-center gap-1.5">
              <span className="font-calistoga text-[26px] leading-none text-pastel-cream">Citrus</span>
              <span aria-hidden="true" className="block w-1.5 h-1.5 bg-pastel-orange rounded-full animate-pulse" />
            </Link>
            <nav className="hidden md:flex items-center gap-7">
              {links.map((link) => (
                <Link
                  key={link.label}
                  to={link.to}
                  className="text-[14px] font-medium text-white/65 hover:text-pastel-cream transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {showLogin && (
              <Link
                to="/auth"
                className="hidden sm:inline-flex text-[13px] font-medium text-white/65 hover:text-pastel-cream transition-colors"
              >
                Log in
              </Link>
            )}
            <Link
              to={ctaHref}
              className="text-[13px] font-bold px-5 h-10 inline-flex items-center bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft rounded-md transition-colors"
            >
              {ctaLabel}
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
