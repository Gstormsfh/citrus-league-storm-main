import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

type ConnectionState = 'connected' | 'connecting' | 'disconnected';

interface ConnectionStatusProps {
  leagueId: string;
}

/**
 * Tiny connection indicator that monitors Supabase realtime health.
 * Green = connected, Yellow = connecting/reconnecting, Red = disconnected.
 */
export const ConnectionStatus = ({ leagueId }: ConnectionStatusProps) => {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    // Create a lightweight presence channel just for monitoring connectivity
    const channel = supabase.channel(`connection_status:${leagueId}`);

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setState('connected');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setState('disconnected');
      } else {
        // CLOSED, etc.
        setState('connecting');
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId]);

  const config: Record<ConnectionState, { color: string; label: string }> = {
    connected: { color: 'bg-green-500', label: 'Live' },
    connecting: { color: 'bg-yellow-500 animate-pulse', label: 'Connecting' },
    disconnected: { color: 'bg-red-500 animate-pulse', label: 'Offline' },
  };

  const { color, label } = config[state];

  return (
    <div className="flex items-center gap-1.5" title={`Realtime: ${label}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="text-[10px] text-muted-foreground font-medium hidden md:inline">{label}</span>
    </div>
  );
};
