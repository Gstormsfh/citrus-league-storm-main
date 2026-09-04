import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import { PressBoxAppHeader } from '@/components/pressbox/AppHeader';
import { NewsPhone } from '@/components/news/NewsPhone';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, Newspaper, ExternalLink, Clock, TrendingUp, Trophy, AlertTriangle, Repeat, Star } from 'lucide-react';
import { getNewsArticles, NEWS_CATEGORIES, NewsArticle } from '@/services/NewsService';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { DarkLayout, HockeyFooter } from '@/components/citrus2';

const categoryIcons: Record<string, React.ReactNode> = {
  top: <TrendingUp className="h-3.5 w-3.5" />,
  fantasy: <Star className="h-3.5 w-3.5" />,
  trade: <Repeat className="h-3.5 w-3.5" />,
  injury: <AlertTriangle className="h-3.5 w-3.5" />,
  recap: <Trophy className="h-3.5 w-3.5" />,
  olympics: <Trophy className="h-3.5 w-3.5" />,
};

// Dark-theme category colors — soft tinted backgrounds with cream/sage text
const categoryColors: Record<string, string> = {
  top: 'bg-pastel-sage/20 text-pastel-sage-soft border-pastel-sage/30',
  fantasy: 'bg-pastel-orange/15 text-pastel-orange-soft border-pastel-orange/30',
  trade: 'bg-pastel-butter/15 text-pastel-butter border-pastel-butter/30',
  injury: 'bg-red-500/15 text-red-200 border-red-400/30',
  recap: 'bg-purple-500/15 text-purple-200 border-purple-400/30',
  olympics: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
};

const News = () => {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  /** PRESS BOX (2026-09-04): the phone's search row, behind the header's glass. */
  const [phoneSearchOpen, setPhoneSearchOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    getNewsArticles().then((data) => {
      if (mounted) {
        setArticles(data);
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  const filtered = articles.filter((a) => {
    const matchesCat = activeCategory === 'all' || a.category === activeCategory;
    const matchesSearch =
      !searchTerm ||
      a.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const featured = filtered[0];
  const rest = filtered.slice(1);

  return (
    <DarkLayout>
      {/* PRESS BOX (2026-09-04): the NEWS tab of the app nav. Below lg the
          app header and NewsPhone; the desktop page from lg, untouched. */}
      <div className="hidden lg:block"><Navbar /></div>
      <div className="lg:hidden relative min-h-screen bg-pressbox-surface pt-[env(safe-area-inset-top)] pb-app-chrome">
        <PressBoxAppHeader
          title="News"
          logoSrc="/favicon.svg"
          onSearch={() => setPhoneSearchOpen((o) => !o)}
          onNotifications={() => navigate('/profile')}
        />
        <NewsPhone
          className="mt-1"
          articles={filtered}
          loading={loading}
          categories={NEWS_CATEGORIES}
          category={activeCategory}
          onCategory={setActiveCategory}
          searchOpen={phoneSearchOpen}
          searchQuery={searchTerm}
          onSearchQuery={setSearchTerm}
        />
      </div>
      <main className="hidden lg:block relative max-w-[1280px] mx-auto px-6 pt-24 pb-16">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-2 font-bold">
              On the Wire
            </div>
            <h1 className="font-sans font-black text-[2.25rem] md:text-[2.75rem] tracking-[-0.025em] text-pastel-cream leading-tight flex items-center gap-3">
              <Newspaper className="h-8 w-8 text-pastel-orange-soft" strokeWidth={2} />
              Player News
            </h1>
            <p className="text-[14px] text-white/55 mt-1">
              Latest NHL headlines and fantasy-relevant updates
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55" />
            <Input
              placeholder="Search news..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 rounded-md bg-pastel-surface-tile border-white/10 text-pastel-cream placeholder:text-white/55 focus-visible:ring-pastel-orange/40"
            />
          </div>
        </div>

        {/* Category Filters */}
        {/* 2026-08-19 — same hidden-scrollbar trap as the ArmchairGM tab
            row: filters that overflow with no visible scrollbar and no
            affordance simply vanish. Wrap instead. */}
        <div className="flex flex-wrap gap-2 pb-4 mb-6">
          {NEWS_CATEGORIES.map((cat) => (
            <Button
              key={cat.key}
              size="sm"
              onClick={() => setActiveCategory(cat.key)}
              className={cn(
                'rounded-full whitespace-nowrap flex-shrink-0 font-jbmono text-[11px] tracking-wider uppercase font-bold',
                activeCategory === cat.key
                  ? 'bg-pastel-orange text-[#581E00] hover:bg-pastel-orange-soft'
                  : 'bg-white/5 text-white/65 hover:bg-white/10 hover:text-pastel-cream ring-1 ring-white/10',
              )}
            >
              {cat.label}
            </Button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-pastel-orange-soft" />
          </div>
        )}

        {/* No results */}
        {!loading && filtered.length === 0 && (
          <Card className="p-12 text-center bg-pastel-surface-tile border-white/10">
            <CardContent className="flex flex-col items-center gap-4">
              <Newspaper className="h-12 w-12 text-pastel-orange-soft/60" aria-hidden="true" />
              <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft font-bold">
                ✦ Nothing on the wire
              </div>
              <p className="text-lg text-pastel-cream font-bold">
                {searchTerm ? `No stories matched "${searchTerm}".` : 'The news feed is quiet.'}
              </p>
              <p className="text-sm text-white/55 max-w-sm">
                {searchTerm
                  ? 'Try a different keyword, or clear the search to see everything we\'ve pulled today.'
                  : 'Check back after the next puck drop. The beat picks up during game hours.'}
              </p>
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-pastel-orange text-[#581E00] text-sm font-bold hover:bg-pastel-orange-soft transition-colors"
                >
                  Clear search →
                </button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Featured Article */}
        {!loading && featured && (
          <a
            href={featured.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block mb-8 group"
          >
            <Card className="overflow-hidden bg-pastel-surface-tile border-2 border-white/10 hover:border-pastel-orange/40 transition-all">
              <div className="md:flex">
                {featured.imageUrl ? (
                  <div className="md:w-2/5 h-48 md:h-auto bg-black/40">
                    <img
                      src={featured.imageUrl}
                      alt={featured.title}
                      className="w-full h-full object-cover"
                      loading="eager"
                    />
                  </div>
                ) : (
                  <div className="md:w-2/5 h-48 md:h-auto bg-gradient-to-br from-pastel-sage/15 to-pastel-orange/10 flex items-center justify-center">
                    <Newspaper className="h-16 w-16 text-pastel-sage/40" />
                  </div>
                )}
                <CardContent className="md:w-3/5 p-6 md:p-8 flex flex-col justify-center">
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline" className={cn('text-[10px] gap-1', categoryColors[featured.category])}>
                      {categoryIcons[featured.category]}
                      {featured.category.charAt(0).toUpperCase() + featured.category.slice(1)}
                    </Badge>
                    <span className="text-xs text-white/55 flex items-center gap-1 font-jbmono">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(featured.publishedAt), { addSuffix: true })}
                    </span>
                  </div>
                  <h2 className="font-sans font-bold text-[1.25rem] md:text-[1.5rem] text-pastel-cream group-hover:text-pastel-orange-soft transition-colors mb-2">
                    {featured.title}
                  </h2>
                  <p className="text-white/65 line-clamp-3 mb-4">
                    {featured.description}
                  </p>
                  <div className="flex items-center gap-2 text-sm text-pastel-orange-soft font-bold">
                    Read Full Article <ExternalLink className="h-3.5 w-3.5" />
                  </div>
                </CardContent>
              </div>
            </Card>
          </a>
        )}

        {/* Article Grid */}
        {!loading && rest.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {rest.map((article) => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group"
              >
                <Card className="h-full overflow-hidden bg-pastel-surface-tile border border-white/10 hover:border-pastel-orange/40 hover:-translate-y-0.5 transition-all">
                  {article.imageUrl ? (
                    <div className="h-40 bg-black/40">
                      <img
                        src={article.imageUrl}
                        alt={article.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div className="h-40 bg-gradient-to-br from-pastel-sage/10 to-pastel-orange/5 flex items-center justify-center">
                      <Newspaper className="h-10 w-10 text-pastel-sage/30" />
                    </div>
                  )}
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className={cn('text-[10px] gap-1', categoryColors[article.category])}>
                        {categoryIcons[article.category]}
                        {article.category.charAt(0).toUpperCase() + article.category.slice(1)}
                      </Badge>
                      <span className="text-[10px] text-white/55 flex items-center gap-1 font-jbmono">
                        <Clock className="h-2.5 w-2.5" />
                        {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
                      </span>
                    </div>
                    <h3 className="font-sans font-bold text-sm text-pastel-cream group-hover:text-pastel-orange-soft transition-colors line-clamp-2 mb-1.5">
                      {article.title}
                    </h3>
                    <p className="text-xs text-white/55 line-clamp-2">
                      {article.description}
                    </p>
                    <div className="mt-3 text-xs text-pastel-sage-soft font-jbmono">
                      {article.source}
                    </div>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        )}
      </main>

      <div className="hidden lg:block"><HockeyFooter /></div>
    </DarkLayout>
  );
};

export default News;
