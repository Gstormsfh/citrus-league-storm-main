
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const StatsOverviewCards = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
      <Card className="relative overflow-hidden bg-gradient-to-br from-background/80 to-muted/50 border-primary/10 backdrop-blur-sm">
        <div className="absolute inset-0 bg-primary/5 background-mesh"></div>
        <CardContent className="p-6 relative z-10">
          <div className="flex flex-col">
            <div className="text-sm text-muted-foreground mb-1">League Rank</div>
            <div className="text-3xl font-bold text-primary">3rd</div>
            <div className="text-sm text-[hsl(var(--vibrant-orange))] mt-1">Top 33%</div>
          </div>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden bg-gradient-to-br from-background/80 to-muted/50 border-primary/10 backdrop-blur-sm">
        <div className="absolute inset-0 bg-primary/5 background-mesh"></div>
        <CardContent className="p-6 relative z-10">
          <div className="flex flex-col">
            <div className="text-sm text-muted-foreground mb-1">Points For</div>
            <div className="text-3xl font-bold text-primary">1,247</div>
            <div className="text-sm text-[hsl(var(--vibrant-orange))] mt-1">124.7 avg/week</div>
          </div>
        </CardContent>
      </Card>

      <Card className="relative overflow-hidden bg-gradient-to-br from-background/80 to-muted/50 border-primary/10 backdrop-blur-sm">
        <div className="absolute inset-0 bg-primary/5 background-mesh"></div>
        <CardContent className="p-6 relative z-10">
          <div className="flex flex-col">
            <div className="text-sm text-muted-foreground mb-1">Points Against</div>
            <div className="text-3xl font-bold text-primary">1,118</div>
            <div className="text-sm text-[hsl(var(--vibrant-orange))] mt-1">111.8 avg/week</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
