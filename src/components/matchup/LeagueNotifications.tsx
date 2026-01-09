import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotificationStore } from '@/stores/notificationStore';
import { Clock, UserPlus, UserMinus, MessageSquare, AlertCircle, Loader2, CheckCheck, Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Notification } from '@/services/NotificationService';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CitrusSparkle, CitrusLeaf } from '@/components/icons/CitrusIcons';

interface LeagueNotificationsProps {
  leagueId: string;
}

interface TeamInfo {
  id: string;
  team_name: string;
  owner_id: string | null;
}

const LeagueNotifications: React.FC<LeagueNotificationsProps> = ({ leagueId }) => {
  const { user, profile } = useAuth();
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

  const leagueNotifications = notifications.get(leagueId) || [];
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
        const { data: teams, error } = await supabase
          .from('teams')
          .select('id, team_name, owner_id')
          .eq('league_id', leagueId)
          .in('owner_id', Array.from(senderIds));

        if (error) {
          console.error('Error fetching team info:', error);
          return;
        }

        const newMap = new Map<string, TeamInfo>();
        teams?.forEach(team => {
          if (team.owner_id) {
            newMap.set(team.owner_id, {
              id: team.id,
              team_name: team.team_name,
              owner_id: team.owner_id,
            });
          }
        });

        setTeamInfoMap(newMap);
      } catch (error) {
        console.error('Error fetching team info:', error);
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

      // Use the secure database function to send chat messages
      const { data, error } = await supabase.rpc('send_league_chat_message', {
        p_league_id: leagueId,
        p_message: chatMessage.trim(),
        p_sender_name: senderName,
      });

      if (error) {
        console.error('Error sending chat message:', error);
        throw new Error(error.message || 'Failed to send message');
      }

      if (data && !data.success) {
        throw new Error(data.error || 'Failed to send message');
      }

      // Clear the input
      setChatMessage('');
      
      // Reload notifications to show the new message
      // Small delay to ensure database commits
      setTimeout(() => {
        if (user) {
          loadNotifications(leagueId, user.id);
        }
      }, 300);
    } catch (error: any) {
      console.error('Error sending chat message:', error);
      // You could add a toast notification here to show the error to the user
      alert(error.message || 'Failed to send message. Please try again.');
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
      SYSTEM: 'bg-citrus-cream border-citrus-sage/30',
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
          <p className="text-sm font-medium text-foreground mb-1">Authentication Required</p>
          <p className="text-xs text-muted-foreground">Please sign in to view notifications</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4">
        <AlertCircle className="w-8 h-8 text-destructive mb-2" />
        <p className="text-sm font-medium text-destructive text-center mb-1">{error}</p>
        <button
          onClick={() => {
            clearError(leagueId);
            if (user) {
              loadNotifications(leagueId, user.id);
            }
          }}
          className="text-xs text-primary hover:underline mt-2"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-citrus-cream corduroy-texture relative">
      {/* Decorative citrus leaves */}
      <CitrusLeaf className="absolute top-4 right-2 w-16 h-16 text-citrus-sage opacity-5 rotate-12 pointer-events-none" />
      <CitrusLeaf className="absolute bottom-20 left-2 w-12 h-12 text-citrus-peach opacity-5 -rotate-45 pointer-events-none" />
      
      {/* Header */}
      <div className="px-4 py-3 border-b-4 border-citrus-forest bg-gradient-to-r from-citrus-sage/20 via-citrus-sage/10 to-citrus-peach/10 backdrop-blur-sm sticky top-0 z-10 relative">
        <div className="flex items-center justify-between mb-1 relative z-10">
          <h3 className="text-sm font-varsity font-black text-citrus-forest uppercase tracking-tight flex items-center gap-1.5">
            <CitrusSparkle className="w-4 h-4 text-citrus-orange" />
            League Activity
          </h3>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="text-xs font-display font-semibold text-citrus-forest hover:text-citrus-orange flex items-center gap-1 transition-colors bg-citrus-cream/60 px-2 py-1 rounded-lg border border-citrus-sage/30"
              title="Mark all as read"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark all</span>
            </button>
          )}
        </div>
        <div className="flex items-center justify-between relative z-10">
          <p className="text-xs font-display text-citrus-charcoal">
            Real-time updates
          </p>
          {unreadCount > 0 && (
            <span className="text-xs font-varsity font-bold text-citrus-orange bg-citrus-peach/30 px-2 py-0.5 rounded-full border border-citrus-peach/50">
              {unreadCount} unread
            </span>
          )}
        </div>
      </div>

      {/* Notifications List - Scrollable */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {leagueNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 relative">
            <CitrusLeaf className="w-20 h-20 text-citrus-sage opacity-20 mb-4" />
            <Clock className="w-8 h-8 text-citrus-charcoal/50 mb-2" />
            <p className="text-sm font-varsity font-bold text-citrus-forest uppercase tracking-wide">No activity yet</p>
            <p className="text-xs font-display text-citrus-charcoal/70 mt-1">
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
                      {/* Team Logo/Name - Outside message bubble */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <Avatar className="h-8 w-8 border-3 border-citrus-sage shadow-patch bg-gradient-to-br from-citrus-sage/20 to-citrus-orange/20">
                          <AvatarFallback className="bg-transparent text-citrus-forest font-varsity font-black text-[10px]">
                            {teamLogo}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-[9px] font-display font-medium text-citrus-charcoal max-w-[60px] truncate text-center leading-tight">
                          {teamName}
                        </span>
                      </div>
                      
                      {/* Message Bubble */}
                      <div className="flex flex-col gap-0.5 max-w-[75%]">
                        <div
                          className={`p-2.5 rounded-xl text-xs leading-snug shadow-sm font-display ${
                            isOwnMessage
                              ? 'bg-gradient-to-br from-citrus-orange to-citrus-peach text-citrus-cream border-2 border-citrus-orange rounded-tr-none'
                              : 'bg-citrus-cream border-2 border-citrus-sage/40 rounded-tl-none text-citrus-forest'
                          } ${notification.read_status ? 'opacity-90' : ''}`}
                        >
                          {notification.message}
                        </div>
                        <div className={`flex items-center gap-1 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                          <Clock className="w-2.5 h-2.5 text-citrus-charcoal/50" />
                          <span className="text-[9px] font-display text-citrus-charcoal/70">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </span>
                          {!notification.read_status && !isOwnMessage && (
                            <div className="w-1 h-1 bg-citrus-orange rounded-full shadow-[0_0_4px_rgba(223,117,54,0.6)]" />
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

      {/* Chat Input - Fixed at bottom */}
      <div className="px-3 py-2.5 border-t-4 border-citrus-forest bg-citrus-cream backdrop-blur-sm sticky bottom-0 shadow-[0_-4px_10px_rgba(27,48,34,0.1)]">
        <form onSubmit={handleSendChatMessage} className="flex items-center gap-2">
          <input
            type="text"
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2.5 text-xs font-display bg-citrus-cream/50 border-2 border-citrus-sage/40 rounded-full focus:outline-none focus:ring-2 focus:ring-citrus-orange/30 focus:border-citrus-orange placeholder:text-citrus-charcoal/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-citrus-forest"
            disabled={sendingMessage || !user}
          />
          <button
            type="submit"
            disabled={!chatMessage.trim() || sendingMessage || !user}
            className="h-9 w-9 bg-gradient-to-br from-citrus-sage to-citrus-orange border-3 border-citrus-forest text-citrus-cream rounded-varsity hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center flex-shrink-0 shadow-patch hover:shadow-varsity active:scale-95"
            title="Send message"
          >
            {sendingMessage ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LeagueNotifications;
