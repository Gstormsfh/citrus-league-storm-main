
import { Card, CardContent } from '@/components/ui/card';
import { CitrusLeaf, CitrusSparkle } from '@/components/icons/CitrusIcons';

interface ActivityItem {
  id: number;
  type: 'add' | 'trade' | 'injury' | 'achievement';
  title: string;
  description: string;
  time: string;
}

const activities: ActivityItem[] = [
  {
    id: 1,
    type: 'trade',
    title: 'Trade Completed',
    description: 'Traded RB D. Henry for WR CeeDee Lamb',
    time: '2h ago'
  },
  {
    id: 2,
    type: 'add',
    title: 'Player Added',
    description: 'Added WR Noah Brown to roster',
    time: '4h ago'
  },
  {
    id: 3,
    type: 'injury',
    title: 'Injury Update',
    description: 'Justin Jefferson (knee) upgraded to probable',
    time: '6h ago'
  }
];

const getActivityIcon = (type: ActivityItem['type']) => {
  switch (type) {
    case 'trade':
      return (
        <div className="w-10 h-10 rounded-varsity bg-citrus-peach/20 border-2 border-citrus-peach flex items-center justify-center shadow-patch">
          <svg className="w-5 h-5 text-citrus-peach" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </div>
      );
    case 'add':
      return (
        <div className="w-10 h-10 rounded-varsity bg-citrus-sage/20 border-2 border-citrus-sage flex items-center justify-center shadow-patch">
          <svg className="w-5 h-5 text-citrus-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
      );
    case 'injury':
      return (
        <div className="w-10 h-10 rounded-varsity bg-citrus-orange/20 border-2 border-citrus-orange flex items-center justify-center shadow-patch">
          <svg className="w-5 h-5 text-citrus-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
      );
    default:
      return null;
  }
};

export const ActivityFeed = () => {
  return (
    <Card className="bg-citrus-cream corduroy-texture border-4 border-citrus-sage rounded-[2rem] shadow-[0_6px_0_rgba(27,48,34,0.2)] relative overflow-hidden">
      {/* Decorative citrus leaves */}
      <CitrusLeaf className="absolute top-2 right-2 w-16 h-16 text-citrus-sage opacity-10 rotate-12" />
      <CitrusLeaf className="absolute bottom-4 left-2 w-12 h-12 text-citrus-peach opacity-10 -rotate-45" />
      
      <CardContent className="p-6 relative z-10">
        <div className="flex items-center gap-2 mb-6">
          <CitrusSparkle className="w-6 h-6 text-citrus-orange" />
          <h3 className="text-xl font-varsity font-black text-citrus-forest uppercase tracking-tight">Recent Activity</h3>
        </div>
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} className="flex items-start space-x-4 p-4 rounded-xl bg-citrus-cream/60 border-2 border-citrus-sage/30 hover:border-citrus-orange/50 hover:shadow-patch hover:-translate-y-0.5 transition-all">
              {getActivityIcon(activity.type)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-varsity font-bold text-citrus-forest uppercase tracking-tight">{activity.title}</p>
                <p className="text-sm font-display text-citrus-charcoal mt-1">{activity.description}</p>
              </div>
              <div className="text-xs font-mono text-citrus-charcoal/70">{activity.time}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
