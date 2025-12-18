
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Briefcase, Settings } from 'lucide-react';

export const ActionsSidebar = () => {
  return (
    <Card className="animated-element bg-gradient-to-br from-background/90 to-muted/70 border-primary/10 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Link to="/roster" className="w-full">
          <Button className="w-full bg-[hsl(var(--vibrant-orange))] hover:bg-[hsl(var(--vibrant-orange))]/90 text-white group transition-all">
            <Users className="w-4 h-4 mr-2 transition-transform group-hover:scale-110" />
            Manage Team
          </Button>
        </Link>
        <Link to="/trade-analyzer" className="w-full">
          <Button className="w-full bg-gradient-to-r from-primary/90 to-primary hover:from-primary hover:to-primary/90 text-white group transition-all">
            <Briefcase className="w-4 h-4 mr-2 transition-transform group-hover:scale-110" />
            Trade Center
          </Button>
        </Link>
        <Link to="/profile" className="w-full">
          <Button variant="outline" className="w-full group">
            <Settings className="w-4 h-4 mr-2 transition-transform group-hover:scale-110" />
            Team Settings
          </Button>
        </Link>
        
        <div className="border-t border-border/40 pt-4 mt-6">
          <h3 className="text-lg font-medium mb-3">Quick Links</h3>
          <nav className="space-y-1">
            <Link to="/team-analytics" className="flex items-center text-muted-foreground hover:text-primary p-2 rounded-md hover:bg-primary/5 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 8v8m-4-5v5M8 8v8m-4 0h18" />
              </svg>
              Player Stats
            </Link>
            <Link to="/profile" className="flex items-center text-muted-foreground hover:text-primary p-2 rounded-md hover:bg-primary/5 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Team Settings
            </Link>
          </nav>
        </div>
      </CardContent>
    </Card>
  );
};
