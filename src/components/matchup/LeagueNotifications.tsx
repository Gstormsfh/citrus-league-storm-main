import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotificationStore } from '@/stores/notificationStore';
import { Clock, UserPlus, UserMinus, MessageSquare, AlertCircle, Loader2, CheckCheck, Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Notification } from '@/services/NotificationService';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

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
        return <UserPlus className="w-4 h-4 text-[hsl(var(--vibrant-green))]" />;
      case 'DROP':
        return <UserMinus className="w-4 h-4 text-[hsl(var(--vibrant-orange))]" />;
      case 'WAIVER':
        return <AlertCircle className="w-4 h-4 text-[hsl(var(--vibrant-yellow))]" />;
      case 'CHAT':
        return <MessageSquare className="w-4 h-4 text-[hsl(var(--vibrant-purple))]" />;
      case 'TRADE':
        return <AlertCircle className="w-4 h-4 text-primary" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getNotificationColor = (type: Notification['type'], isRead: boolean) => {
    const baseColors = {
      ADD: 'bg-[hsl(var(--vibrant-green))]/10 border-[hsl(var(--vibrant-green))]/30',
      DROP: 'bg-[hsl(var(--vibrant-orange))]/10 border-[hsl(var(--vibrant-orange))]/30',
      WAIVER: 'bg-[hsl(var(--vibrant-yellow))]/10 border-[hsl(var(--vibrant-yellow))]/30',
      CHAT: 'bg-[hsl(var(--vibrant-purple))]/10 border-[hsl(var(--vibrant-purple))]/30',
      TRADE: 'bg-primary/10 border-primary/30',
      SYSTEM: 'bg-muted/30 border-border/30',
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
    <div className="h-full flex flex-col bg-[#D4E8B8]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/30 bg-[#D4E8B8]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-foreground">League Activity</h3>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
              title="Mark all as read"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark all read</span>
            </button>
          )}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Real-time updates
          </p>
          {unreadCount > 0 && (
            <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              {unreadCount} unread
            </span>
          )}
        </div>
      </div>

      {/* Notifications List - Scrollable */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {leagueNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Clock className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No activity yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
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
                        <Avatar className="h-8 w-8 border-2 border-background shadow-sm">
                          <AvatarFallback className="bg-gradient-to-br from-primary/20 to-purple-600/20 text-primary font-bold text-[10px]">
                            {teamLogo}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-[9px] font-medium text-muted-foreground max-w-[60px] truncate text-center leading-tight">
                          {teamName}
                        </span>
                      </div>
                      
                      {/* Message Bubble */}
                      <div className="flex flex-col gap-0.5 max-w-[75%]">
                        <div
                          className={`p-2.5 rounded-xl text-xs leading-snug shadow-sm ${
                            isOwnMessage
                              ? 'bg-primary text-primary-foreground rounded-tr-none'
                              : 'bg-muted border rounded-tl-none'
                          } ${notification.read_status ? 'opacity-90' : ''}`}
                        >
                          {notification.message}
                        </div>
                        <div className={`flex items-center gap-1 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                          <Clock className="w-2.5 h-2.5 text-muted-foreground/50" />
                          <span className="text-[9px] text-muted-foreground/70">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </span>
                          {!notification.read_status && !isOwnMessage && (
                            <div className="w-1 h-1 bg-primary rounded-full" />
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
                    className={`p-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm ${getNotificationColor(notification.type, notification.read_status)}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex-shrink-0">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-xs font-medium line-clamp-1 ${notification.read_status ? 'text-muted-foreground' : 'text-foreground'}`}>
                            {notification.title}
                          </p>
                          {!notification.read_status && (
                            <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1" />
                          )}
                        </div>
                        <p className={`text-xs mt-0.5 line-clamp-2 ${notification.read_status ? 'text-muted-foreground/70' : 'text-muted-foreground'}`}>
                          {notification.message}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Clock className="w-3 h-3 text-muted-foreground/60" />
                          <span className="text-xs text-muted-foreground/70">
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
      <div className="px-3 py-2.5 border-t border-border/20 bg-background/95 backdrop-blur-sm sticky bottom-0 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <form onSubmit={handleSendChatMessage} className="flex items-center gap-2">
          <input
            type="text"
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2.5 text-xs bg-muted/50 border border-border/30 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 placeholder:text-muted-foreground/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={sendingMessage || !user}
          />
          <button
            type="submit"
            disabled={!chatMessage.trim() || sendingMessage || !user}
            className="h-9 w-9 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center flex-shrink-0 shadow-sm hover:shadow-md active:scale-95"
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
