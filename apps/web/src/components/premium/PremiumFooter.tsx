import { Link } from 'react-router-dom';

const PRODUCT_LINKS = [
  { label: 'Features', to: '/features' },
  { label: 'Draft Room', to: '/draft-room' },
  { label: 'Matchups', to: '/matchup' },
  { label: 'Roster', to: '/roster' },
  { label: 'Free Agents', to: '/free-agents' },
  { label: 'NHL Playoffs', to: '/nhl/playoffs' },
];

const RESOURCES_LINKS = [
  { label: 'Player News', to: '/news' },
  { label: 'Standings', to: '/standings' },
  { label: 'Stormy AI', to: '/gm-office/stormy' },
  { label: 'Contact', to: '/contact' },
];

const LEGAL_LINKS = [
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'Terms of Service', to: '/terms' },
  { label: 'Settings', to: '/settings' },
];

export default function PremiumFooter() {
  return (
    <footer className="bg-premium-bg-deep border-t border-premium-border">
      <div className="max-w-[1400px] mx-auto px-6 py-16 lg:py-20">
        <div className="grid grid-cols-2 md:grid-cols-12 gap-10 mb-12 pb-12 border-b border-premium-border">
          <div className="col-span-2 md:col-span-5">
            <Link to="/preview-redesign" className="flex items-center gap-1.5 mb-6">
              <span className="font-caps text-2xl tracking-wide text-premium-text">CITRUS</span>
              <span className="block w-2 h-2 bg-premium-orange" />
            </Link>
            <p className="font-premium-body text-sm leading-relaxed text-premium-text-muted max-w-xs mb-8">
              Fantasy hockey for people who actually watch hockey. Saturday finishes, live everything, and the most accurate NHL projections on earth.
            </p>
            <p className="font-caps text-[10px] tracking-[0.2em] text-premium-text-dim uppercase">
              Made in Mountain Time
            </p>
          </div>

          <FooterColumn title="Product" links={PRODUCT_LINKS} />
          <FooterColumn title="Resources" links={RESOURCES_LINKS} />
          <FooterColumn title="Legal" links={LEGAL_LINKS} />
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <p className="font-premium-body text-[12px] text-premium-text-dim">
            © {new Date().getFullYear()} Citrus Sports. All rights reserved.
          </p>
          <p className="font-caps text-[10px] tracking-[0.2em] text-premium-text-dim uppercase">
            Built by hockey fanatics
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; to: string }[];
}) {
  return (
    <div className="md:col-span-2">
      <h4 className="font-caps text-[11px] tracking-[0.2em] text-premium-text uppercase mb-4">
        {title}
      </h4>
      <ul className="space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <Link
              to={link.to}
              className="font-premium-body text-sm text-premium-text-muted hover:text-premium-orange transition-colors"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
