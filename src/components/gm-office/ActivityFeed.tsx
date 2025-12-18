
import { Card, CardContent } from '@/components/ui/card';

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
        <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center">
          <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </div>
      );
    case 'add':
      return (
        <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
      );
    case 'injury':
      return (
        <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
          <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
      );
    default:
      return null;
  }
};

export const ActivityFeed = () => {
  return (
    <Card className="bg-gradient-to-br from-background/90 to-muted/70 border-primary/10 backdrop-blur-sm">
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} className="flex items-start space-x-4 p-3 rounded-lg bg-background/50 hover:bg-background/80 transition-colors">
              {getActivityIcon(activity.type)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{activity.title}</p>
                <p className="text-sm text-muted-foreground">{activity.description}</p>
              </div>
              <div className="text-xs text-muted-foreground">{activity.time}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
