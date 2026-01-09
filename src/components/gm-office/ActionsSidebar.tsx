
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Briefcase, Settings } from 'lucide-react';
import { CitrusSparkle, CitrusLeaf } from '@/components/icons/CitrusIcons';

export const ActionsSidebar = () => {
  return (
    <Card className="animated-element bg-citrus-cream corduroy-texture border-4 border-citrus-sage rounded-[2rem] shadow-[0_6px_0_rgba(27,48,34,0.2)] relative overflow-hidden">
      {/* Decorative citrus leaves */}
      <CitrusLeaf className="absolute top-2 right-2 w-12 h-12 text-citrus-sage opacity-10 rotate-12" />
      <CitrusLeaf className="absolute bottom-4 left-2 w-10 h-10 text-citrus-peach opacity-10 -rotate-45" />
      
      <CardHeader className="relative z-10">
        <CardTitle className="text-xl font-varsity font-black text-citrus-forest uppercase tracking-tight flex items-center gap-2">
          <CitrusSparkle className="w-5 h-5 text-citrus-orange" />
          Quick Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 relative z-10">
        <Link to="/roster" className="w-full">
          <Button className="w-full bg-gradient-to-br from-citrus-sage to-citrus-orange border-4 border-citrus-forest rounded-varsity shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)] hover:-translate-y-0.5 transition-all text-citrus-cream font-varsity font-bold uppercase tracking-wide group">
            <Users className="w-4 h-4 mr-2 transition-transform group-hover:scale-110" />
            Manage Team
          </Button>
        </Link>
        <Link to="/trade-analyzer" className="w-full">
          <Button className="w-full bg-gradient-to-br from-citrus-peach to-citrus-orange border-4 border-citrus-forest rounded-varsity shadow-[inset_0_2px_4px_rgba(0,0,0,0.1),0_4px_0_rgba(27,48,34,0.2)] hover:-translate-y-0.5 transition-all text-citrus-cream font-varsity font-bold uppercase tracking-wide group">
            <Briefcase className="w-4 h-4 mr-2 transition-transform group-hover:scale-110" />
            Trade Center
          </Button>
        </Link>
        <Link to="/profile" className="w-full">
          <Button variant="outline" className="w-full border-2 border-citrus-sage/60 bg-citrus-cream/50 hover:bg-citrus-sage/20 text-citrus-forest font-display font-semibold rounded-xl group">
            <Settings className="w-4 h-4 mr-2 transition-transform group-hover:scale-110" />
            Team Settings
          </Button>
        </Link>
        
        <div className="border-t-2 border-citrus-sage/30 pt-4 mt-6">
          <h3 className="text-lg font-varsity font-bold text-citrus-forest uppercase tracking-tight mb-3">Quick Links</h3>
          <nav className="space-y-1">
            <Link to="/team-analytics" className="flex items-center text-citrus-charcoal hover:text-citrus-forest p-2 rounded-xl hover:bg-citrus-sage/10 transition-colors border-2 border-transparent hover:border-citrus-sage/30 font-display">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 8v8m-4-5v5M8 8v8m-4 0h18" />
              </svg>
              Player Stats
            </Link>
            <Link to="/profile" className="flex items-center text-citrus-charcoal hover:text-citrus-forest p-2 rounded-xl hover:bg-citrus-sage/10 transition-colors border-2 border-transparent hover:border-citrus-sage/30 font-display">
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
