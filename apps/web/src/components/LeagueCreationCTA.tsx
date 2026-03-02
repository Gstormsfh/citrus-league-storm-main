/**
 * LeagueCreationCTA Component
 * 
 * Reusable call-to-action component for converting logged-in users without leagues
 * to create their first league. Used throughout the app in demo data views.
 */

import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trophy, Sparkles, ArrowRight } from 'lucide-react';

interface LeagueCreationCTAProps {
  title?: string;
  description?: string;
  variant?: 'default' | 'compact' | 'inline';
  className?: string;
}

export const LeagueCreationCTA = ({
  title = "Start Your League",
  description = "Create your league to begin managing your team, making trades, and competing with friends.",
  variant = 'default',
  className = '',
}: LeagueCreationCTAProps) => {
  const navigate = useNavigate();

  const handleCreateLeague = () => {
    navigate('/create-league');
  };

  if (variant === 'compact') {
    return (
      <Button
        onClick={handleCreateLeague}
        size="lg"
        className={`w-full ${className}`}
      >
        <Trophy className="mr-2 h-4 w-4" />
        {title}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Button
          onClick={handleCreateLeague}
          variant="outline"
          size="sm"
        >
          <Trophy className="mr-2 h-4 w-4" />
          Create League
        </Button>
      </div>
    );
  }

  return (
    <Card className={`border-2 border-dashed border-primary/50 bg-gradient-to-br from-primary/5 to-primary/10 ${className}`}>
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Trophy className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-2xl">{title}</CardTitle>
        <CardDescription className="mt-2 text-base">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <Button
          onClick={handleCreateLeague}
          size="lg"
          className="w-full max-w-sm"
        >
          <Sparkles className="mr-2 h-5 w-5" />
          Create Your League
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
        <p className="text-sm text-muted-foreground">
          Free to create • Customize settings • Invite friends
        </p>
      </CardContent>
    </Card>
  );
};

/**
 * InlineCTA - A subtle inline version for replacing demo content
 */
export const InlineCTA = ({
  message = "Your content here",
  actionText = "Create League",
  className = '',
}: {
  message?: string;
  actionText?: string;
  className?: string;
}) => {
  const navigate = useNavigate();

  return (
    <div className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted bg-muted/30 p-8 text-center ${className}`}>
      <p className="mb-4 text-lg font-medium text-muted-foreground">{message}</p>
      <Button onClick={() => navigate('/create-league')} variant="default">
        <Trophy className="mr-2 h-4 w-4" />
        {actionText}
      </Button>
    </div>
  );
};

