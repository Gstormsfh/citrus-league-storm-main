import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, Newspaper, ExternalLink, Clock, TrendingUp, Trophy, AlertTriangle, Repeat, Star } from 'lucide-react';
import { getNewsArticles, NEWS_CATEGORIES, NewsArticle } from '@/services/NewsService';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

const categoryIcons: Record<string, React.ReactNode> = {
  top: <TrendingUp className="h-3.5 w-3.5" />,
  fantasy: <Star className="h-3.5 w-3.5" />,
  trade: <Repeat className="h-3.5 w-3.5" />,
  injury: <AlertTriangle className="h-3.5 w-3.5" />,
  recap: <Trophy className="h-3.5 w-3.5" />,
  olympics: <Trophy className="h-3.5 w-3.5" />,
};

const categoryColors: Record<string, string> = {
  top: 'bg-citrus-sage/20 text-citrus-forest border-citrus-sage/30',
  fantasy: 'bg-citrus-orange/15 text-citrus-orange border-citrus-orange/30',
  trade: 'bg-blue-100 text-blue-700 border-blue-200',
  injury: 'bg-red-100 text-red-700 border-red-200',
  recap: 'bg-purple-100 text-purple-700 border-purple-200',
  olympics: 'bg-amber-100 text-amber-700 border-amber-200',
};

const News = () => {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

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
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="pt-24 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-16 flex-grow">
        <div className="container mx-auto px-4 max-w-6xl">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl md:text-4xl font-varsity uppercase text-citrus-forest flex items-center gap-3">
                <Newspaper className="h-8 w-8 text-citrus-sage" />
                Player News
              </h1>
              <p className="text-citrus-charcoal/70 mt-1 font-sans">
                Latest NHL headlines and fantasy-relevant updates
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search news..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 rounded-xl border-citrus-sage/30"
              />
            </div>
          </div>

          {/* Category Filters */}
          <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide mb-6">
            {NEWS_CATEGORIES.map((cat) => (
              <Button
                key={cat.key}
                variant={activeCategory === cat.key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveCategory(cat.key)}
                className={cn(
                  'rounded-full whitespace-nowrap flex-shrink-0 font-display text-xs',
                  activeCategory === cat.key
                    ? 'bg-citrus-sage text-[#E8EED9] hover:bg-citrus-sage/90'
                    : 'border-citrus-sage/30 text-citrus-forest hover:bg-citrus-sage/10'
                )}
              >
                {cat.label}
              </Button>
            ))}
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-citrus-sage" />
            </div>
          )}

          {/* No results */}
          {!loading && filtered.length === 0 && (
            <Card className="p-12 text-center">
              <CardContent className="flex flex-col items-center gap-4">
                <Newspaper className="h-12 w-12 text-muted-foreground" />
                <p className="text-lg text-muted-foreground">
                  No articles found{searchTerm ? ` for "${searchTerm}"` : ''}.
                </p>
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
              <Card className="overflow-hidden border-2 border-citrus-sage/20 hover:border-citrus-sage/40 transition-all hover:shadow-lg">
                <div className="md:flex">
                  {featured.imageUrl ? (
                    <div className="md:w-2/5 h-48 md:h-auto bg-muted">
                      <img
                        src={featured.imageUrl}
                        alt={featured.title}
                        className="w-full h-full object-cover"
                        loading="eager"
                      />
                    </div>
                  ) : (
                    <div className="md:w-2/5 h-48 md:h-auto bg-gradient-to-br from-citrus-sage/20 to-citrus-orange/10 flex items-center justify-center">
                      <Newspaper className="h-16 w-16 text-citrus-sage/40" />
                    </div>
                  )}
                  <CardContent className="md:w-3/5 p-6 md:p-8 flex flex-col justify-center">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="outline" className={cn('text-[10px] gap-1', categoryColors[featured.category])}>
                        {categoryIcons[featured.category]}
                        {featured.category.charAt(0).toUpperCase() + featured.category.slice(1)}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(featured.publishedAt), { addSuffix: true })}
                      </span>
                    </div>
                    <h2 className="text-xl md:text-2xl font-display font-bold text-citrus-forest group-hover:text-citrus-sage transition-colors mb-2">
                      {featured.title}
                    </h2>
                    <p className="text-citrus-charcoal/70 font-sans line-clamp-3 mb-4">
                      {featured.description}
                    </p>
                    <div className="flex items-center gap-2 text-sm text-citrus-sage font-display font-semibold">
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
                  <Card className="h-full overflow-hidden border border-citrus-sage/15 hover:border-citrus-sage/30 transition-all hover:shadow-md">
                    {article.imageUrl ? (
                      <div className="h-40 bg-muted">
                        <img
                          src={article.imageUrl}
                          alt={article.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="h-40 bg-gradient-to-br from-citrus-sage/10 to-citrus-orange/5 flex items-center justify-center">
                        <Newspaper className="h-10 w-10 text-citrus-sage/30" />
                      </div>
                    )}
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className={cn('text-[10px] gap-1', categoryColors[article.category])}>
                          {categoryIcons[article.category]}
                          {article.category.charAt(0).toUpperCase() + article.category.slice(1)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
                        </span>
                      </div>
                      <h3 className="font-display font-bold text-sm text-citrus-forest group-hover:text-citrus-sage transition-colors line-clamp-2 mb-1.5">
                        {article.title}
                      </h3>
                      <p className="text-xs text-citrus-charcoal/60 font-sans line-clamp-2">
                        {article.description}
                      </p>
                      <div className="mt-3 text-xs text-citrus-sage/80 font-sans">
                        {article.source}
                      </div>
                    </CardContent>
                  </Card>
                </a>
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default News;
