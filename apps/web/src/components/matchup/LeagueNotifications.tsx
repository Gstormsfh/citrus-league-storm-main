import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProfile } from '@/hooks/useProfile';
import { useNotificationStore } from '@/stores/notificationStore';
import { Clock, UserPlus, UserMinus, MessageSquare, AlertCircle, Loader2, CheckCheck, Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Notification } from '@/services/NotificationService';
import { leagueApi } from '@/api/leagues';
import { notificationApi } from '@/api/notifications';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';

interface LeagueNotificationsProps {
  leagueId: string;
}

interface TeamInfo {
  id: string;
  team_name: string;
  owner_id: string | null;
}

const LeagueNotifications: React.FC<LeagueNotificationsProps> = ({ leagueId }) => {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const [chatMessage, setChatMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [teamInfoMap, setTeamInfoMap] = useState<Map<string, TeamInfo>>(new Map());
  
  const {
    notifications,
    unreadCounts,
    loading,
    errors,
    loadNotifications,
    markAsRead,
    markAllAsRead,
    subscribe,
    unsubscribe,
    clearError,
  } = useNotificationStore();

  const leagueNotifications = useMemo(() => notifications.get(leagueId) || [], [notifications, leagueId]);
  const isLoading = loading.get(leagueId) || false;
  const error = errors.get(leagueId);
  const unreadCount = unreadCounts.get(leagueId) || 0;

  // Separate CHAT notifications from other notifications
  const chatNotifications = useMemo(() => {
    return leagueNotifications.filter(n => n.type === 'CHAT').sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [leagueNotifications]);

  const otherNotifications = useMemo(() => {
    return leagueNotifications.filter(n => n.type !== 'CHAT').sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [leagueNotifications]);

  // Fetch team information for chat message senders
  useEffect(() => {
    const fetchTeamInfo = async () => {
      if (!leagueId || chatNotifications.length === 0) return;

      const senderIds = new Set<string>();
      chatNotifications.forEach(notification => {
        const senderId = notification.metadata?.sender_id;
        if (senderId) {
          senderIds.add(senderId);
        }
      });

      if (senderIds.size === 0) return;

      try {
        const response = await leagueApi.getTeams(leagueId, true);
        const teams = (response.data as Array<{ id: string; team_name: string; owner_id: string | null }>) || [];

        const newMap = new Map<string, TeamInfo>();
        teams.forEach(team => {
          if (team.owner_id && senderIds.has(team.owner_id)) {
            newMap.set(team.owner_id, {
              id: team.id,
              team_name: team.team_name,
              owner_id: team.owner_id,
            });
          }
        });

        setTeamInfoMap(newMap);
      } catch (error) {
        logger.error('Error fetching team info:', error);
      }
    };

    fetchTeamInfo();
  }, [leagueId, chatNotifications]);

  useEffect(() => {
    // Authentication check
    if (!user || !leagueId) {
      return;
    }

    // Load notifications
    loadNotifications(leagueId, user.id);

    // Subscribe to real-time updates
    subscribe(leagueId, user.id);

    // Cleanup: unsubscribe when component unmounts or leagueId changes
    return () => {
      unsubscribe(leagueId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadNotifications, subscribe, unsubscribe are stable store functions that never change identity
  }, [leagueId, user?.id]);

  const handleMarkAllAsRead = async () => {
    if (!user || !leagueId) return;
    await markAllAsRead(leagueId, user.id);
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !chatMessage.trim() || sendingMessage) return;

    setSendingMessage(true);
    try {
      const senderName = profile?.username || profile?.default_team_name || null;

      // Send chat message via API server
      await notificationApi.sendChatMessage(leagueId, chatMessage.trim(), senderName);

      // Clear the input
      setChatMessage('');
    } catch (error: unknown) {
      logger.error('Error sending chat message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message. Please try again.';
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' });
    } finally {
      setSendingMessage(false);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read if unread
    if (!notification.read_status && user) {
      markAsRead(notification.id, user.id);
    }

    // Route to relevant page based on notification type
    const metadata = notification.metadata || {};
    
    switch (notification.type) {
      case 'ADD':
      case 'DROP':
        // Navigate to free agents or roster page
        navigate(`/roster?league=${leagueId}`);
        break;
      case 'TRADE':
        // Navigate to trades page (if exists)
        navigate(`/roster?league=${leagueId}&tab=trades`);
        break;
      case 'WAIVER':
        // Navigate to waiver wire
        navigate(`/waiver-wire?league=${leagueId}`);
        break;
      case 'CHAT':
        // Don't navigate, just mark as read (chat is in this panel)
        break;
      case 'SYSTEM':
        // System/settings notifications - navigate to league dashboard
        navigate(`/league/${leagueId}`);
        break;
      default:
        // Default to matchup page
        navigate(`/matchup/${leagueId}`);
    }
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'ADD':
        return <UserPlus className="w-4 h-4 text-citrus-sage" />;
      case 'DROP':
        return <UserMinus className="w-4 h-4 text-citrus-orange" />;
      case 'WAIVER':
        return <AlertCircle className="w-4 h-4 text-citrus-peach" />;
      case 'CHAT':
        return <MessageSquare className="w-4 h-4 text-citrus-sage" />;
      case 'TRADE':
        return <AlertCircle className="w-4 h-4 text-citrus-orange" />;
      case 'SYSTEM':
        return <AlertCircle className="w-4 h-4 text-citrus-sage" />;
      default:
        return <Clock className="w-4 h-4 text-citrus-charcoal" />;
    }
  };

  const getNotificationColor = (type: Notification['type'], isRead: boolean) => {
    const baseColors = {
      ADD: 'bg-citrus-sage/15 border-citrus-sage/40',
      DROP: 'bg-citrus-orange/15 border-citrus-orange/40',
      WAIVER: 'bg-citrus-peach/20 border-citrus-peach/40',
      CHAT: 'bg-citrus-sage/10 border-citrus-sage/30',
      TRADE: 'bg-citrus-orange/10 border-citrus-orange/30',
      SYSTEM: 'bg-[#E8EED9]/50 backdrop-blur-sm border-citrus-sage/30',
    };

    const color = baseColors[type] || baseColors.SYSTEM;
    const opacity = isRead ? 'opacity-60' : '';
    
    return `${color} ${opacity}`;
  };

  // Authentication check
  if (!user) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm font-medium text-pastel-cream mb-1">Authentication Required</p>
          <p className="text-xs text-white/55">Please sign in to view notifications</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-pastel-orange-soft" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4">
        <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
        <p className="text-sm font-medium text-red-400 text-center mb-1">{error}</p>
        <button
          onClick={() => {
            clearError(leagueId);
            if (user) {
              loadNotifications(leagueId, user.id);
            }
          }}
          className="text-xs text-pastel-orange-soft hover:underline mt-2"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-pastel-surface-tile">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 bg-pastel-surface-tile sticky top-0 z-10">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-calistoga text-pastel-cream">
            League Activity
          </h3>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="font-jbmono text-[10px] tracking-[0.22em] uppercase font-bold text-pastel-orange-soft hover:text-pastel-cream flex items-center gap-1 transition-colors"
              title="Mark all as read"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark all</span>
            </button>
          )}
        </div>
        <div className="flex items-center justify-between">
          <p className="font-jbmono text-[10px] tracking-[0.22em] uppercase text-white/55 font-bold">
            Real-time updates
          </p>
          {unreadCount > 0 && (
            <span className="font-jbmono text-[10px] uppercase font-bold text-pastel-orange-soft bg-pastel-orange/15 ring-1 ring-pastel-orange/30 px-2 py-0.5 rounded-full">
              {unreadCount} unread
            </span>
          )}
        </div>
      </div>

      {/* Notifications List - Scrollable */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {leagueNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Clock className="w-8 h-8 text-white/40 mb-2" />
            <p className="text-sm font-calistoga text-pastel-cream">No activity yet</p>
            <p className="text-xs text-white/55 mt-1">
              Transactions will appear here
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Chat Messages - Displayed in chat format */}
            {chatNotifications.length > 0 && (
              <div className="space-y-2 pb-2">
                {chatNotifications.map((notification) => {
                  const senderId = notification.metadata?.sender_id;
                  const senderName = notification.metadata?.sender_name || 'Unknown';
                  const teamInfo = senderId ? teamInfoMap.get(senderId) : null;
                  const teamName = teamInfo?.team_name || senderName;
                  const teamLogo = teamName?.substring(0, 2).toUpperCase() || '??';
                  const isOwnMessage = senderId === user?.id;

                  return (
                    <div
                      key={notification.id}
                      className={`flex gap-2 ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'}`}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <div className="h-9 w-9 rounded-full bg-pastel-surface ring-2 ring-pastel-orange/40 flex items-center justify-center text-pastel-cream font-calistoga text-[11px]">
                          {teamLogo}
                        </div>
                        <span className="text-[9px] font-jbmono uppercase tracking-wider text-white/55 max-w-[60px] truncate text-center leading-tight">
                          {teamName}
                        </span>
                      </div>

                      <div className="flex flex-col gap-0.5 max-w-[75%]">
                        <div
                          className={`p-2.5 rounded-xl text-xs leading-snug ${
                            isOwnMessage
                              ? 'bg-pastel-orange text-pastel-surface rounded-tr-none'
                              : 'bg-white/5 ring-1 ring-white/10 rounded-tl-none text-pastel-cream'
                          } ${notification.read_status ? 'opacity-90' : ''}`}
                        >
                          {notification.message}
                        </div>
                        <div className={`flex items-center gap-1 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                          <Clock className="w-2.5 h-2.5 text-white/40" />
                          <span className="text-[9px] font-jbmono uppercase tracking-wider text-white/55">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </span>
                          {!notification.read_status && !isOwnMessage && (
                            <div className="w-1.5 h-1.5 bg-pastel-orange rounded-full" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Other Notifications - Displayed in card format */}
            {otherNotifications.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border/30">
                {otherNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`p-3 rounded-xl border-2 cursor-pointer transition-all hover:shadow-patch hover:-translate-y-0.5 ${getNotificationColor(notification.type, notification.read_status)}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex-shrink-0">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-xs font-varsity font-bold line-clamp-1 ${notification.read_status ? 'text-citrus-charcoal/70' : 'text-citrus-forest'}`}>
                            {notification.title}
                          </p>
                          {!notification.read_status && (
                            <div className="w-2 h-2 bg-citrus-orange rounded-full flex-shrink-0 mt-1 shadow-[0_0_4px_rgba(223,117,54,0.6)]" />
                          )}
                        </div>
                        <p className={`text-xs font-display mt-0.5 line-clamp-2 ${notification.read_status ? 'text-citrus-charcoal/60' : 'text-citrus-charcoal'}`}>
                          {notification.message}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Clock className="w-3 h-3 text-citrus-charcoal/50" />
                          <span className="text-xs font-display text-citrus-charcoal/70">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-2.5 border-t border-white/10 bg-pastel-surface-tile sticky bottom-0">
        <form onSubmit={handleSendChatMessage} className="flex items-center gap-2">
          <Input
            type="text"
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1"
            disabled={sendingMessage || !user}
          />
          <button
            type="submit"
            disabled={!chatMessage.trim() || sendingMessage || !user}
            className="h-9 w-9 bg-pastel-orange hover:bg-pastel-orange-soft text-[#0F1F15] rounded-md hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0"
            title="Send message"
          >
            {sendingMessage ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#0F1F15]" />
            ) : (
              <Send className="w-4 h-4 text-[#0F1F15]" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LeagueNotifications;
