import { userMessage } from '@/lib/userMessage';
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CitrusSparkle, CitrusLeaf } from '@/components/icons/CitrusIcons';
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
  return <LeagueNotificationsSession key={`${user?.id ?? "guest"}:${leagueId}`} leagueId={leagueId} />;
};

const LeagueNotificationsSession: React.FC<LeagueNotificationsProps> = ({ leagueId }) => {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const [chatMessage, setChatMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [blockedHere, setBlockedHere] = useState<Set<string>>(new Set());
  const [blockedUsers, setBlockedUsers] = useState<Array<{ blocked_id: string; created_at: string }> | null>(null);
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
    return leagueNotifications.filter(n => n.type === 'CHAT' && !blockedHere.has(n.metadata?.sender_id)).sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }, [leagueNotifications, blockedHere]);

  const handleReport = async (notificationId: string) => {
    const reason = window.prompt('Report this message to Citrus. What is the concern?');
    if (!reason?.trim() || safetyBusy) return;
    setSafetyBusy(true);
    try {
      await notificationApi.reportMessage(notificationId, reason.trim().slice(0, 1000));
      toast({ title: 'Report submitted', description: 'Your report is available to Citrus support for review.' });
    } catch (err) {
      toast({ title: 'Report not submitted', description: userMessage(err, 'Please retry or contact Citrus support.'), variant: 'destructive' });
    } finally { setSafetyBusy(false); }
  };

  const handleBlock = async (notificationId: string) => {
    if (safetyBusy || !window.confirm('Block this user? Their league chat messages will be hidden and future chat messages between you will stop. You can unblock them from Blocked users.')) return;
    setSafetyBusy(true);
    try {
      const response = await notificationApi.blockMessageSender(notificationId);
      const blockedId = (response.data as { blockedId: string }).blockedId;
      setBlockedHere((previous) => new Set([...previous, blockedId]));
      if (user) await loadNotifications(leagueId, user.id);
      toast({ title: 'User blocked' });
    } catch (err) {
      toast({ title: 'Could not block user', description: userMessage(err, 'Please retry.'), variant: 'destructive' });
    } finally { setSafetyBusy(false); }
  };

  const loadBlockedUsers = async () => {
    try {
      const response = await notificationApi.getBlockedUsers();
      setBlockedUsers(response.data as Array<{ blocked_id: string; created_at: string }>);
    } catch (err) {
      toast({ title: 'Blocked users unavailable', description: userMessage(err, 'Please retry.'), variant: 'destructive' });
    }
  };

  const handleUnblock = async (blockedId: string) => {
    if (safetyBusy) return;
    setSafetyBusy(true);
    try {
      await notificationApi.unblockUser(blockedId);
      setBlockedHere((previous) => new Set([...previous].filter((id) => id !== blockedId)));
      await loadBlockedUsers();
      if (user) await loadNotifications(leagueId, user.id);
    } catch (err) {
      toast({ title: 'Could not unblock user', description: userMessage(err, 'Please retry.'), variant: 'destructive' });
    } finally { setSafetyBusy(false); }
  };

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
      const errorMessage = userMessage(error, 'Failed to send message. Please try again.');
      toast({ title: "Message Didn't Send", description: errorMessage, variant: 'destructive' });
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
        // 2026-08-18 launch audit: this was `&tab=trades`. Roster.tsx
        // never read a `tab` param at all, and even if it had, its tab
        // values are roster | stats | trends | transactions — there is
        // no 'trades'. Tapping a TRADE notification silently dumped the
        // user on the default roster view. /trade-analyzer is the real
        // destination for trade activity.
        navigate(`/trade-analyzer?league=${leagueId}`);
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
        return <UserPlus className="w-4 h-4 text-pastel-sage" aria-hidden="true" />;
      case 'DROP':
        return <UserMinus className="w-4 h-4 text-pastel-orange" aria-hidden="true" />;
      case 'WAIVER':
        return <AlertCircle className="w-4 h-4 text-pastel-cream" aria-hidden="true" />;
      case 'CHAT':
        return <MessageSquare className="w-4 h-4 text-pastel-sage" aria-hidden="true" />;
      case 'TRADE':
        return <AlertCircle className="w-4 h-4 text-pastel-orange" aria-hidden="true" />;
      case 'SYSTEM':
        return <AlertCircle className="w-4 h-4 text-pastel-sage" aria-hidden="true" />;
      default:
        return <Clock className="w-4 h-4 text-white/55" aria-hidden="true" />;
    }
  };

  const getNotificationColor = (type: Notification['type'], isRead: boolean) => {
    const baseColors = {
      ADD: 'bg-pastel-sage/15 border-pastel-sage/40',
      DROP: 'bg-pastel-orange/15 border-pastel-orange/40',
      WAIVER: 'bg-pastel-sage/20 border-pastel-sage/40',
      CHAT: 'bg-pastel-sage/10 border-pastel-sage/30',
      TRADE: 'bg-pastel-orange/10 border-pastel-orange/30',
      SYSTEM: 'bg-[#1A2A20] backdrop-blur-sm border-pastel-sage/30',
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
        <Loader2 className="w-6 h-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4">
        <AlertCircle className="w-8 h-8 text-destructive mb-2" aria-hidden="true" />
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
    <div className="h-full flex flex-col bg-[#1A2A20] backdrop-blur-sm corduroy-texture relative">
      {/* Decorative citrus leaves */}
      <CitrusLeaf className="absolute top-4 right-2 w-16 h-16 text-pastel-sage opacity-5 rotate-12 pointer-events-none" />
      <CitrusLeaf className="absolute bottom-20 left-2 w-12 h-12 text-pastel-cream opacity-5 -rotate-45 pointer-events-none" />

      {/* Header */}
      <div className="px-4 py-3 border-b-4 border-white/10 bg-gradient-to-r from-pastel-sage/20 via-pastel-sage/10 to-pastel-sage/10 backdrop-blur-sm sticky top-0 z-sticky-base relative">
        <div className="flex items-center justify-between mb-1 relative z-10">
          <h3 className="text-sm font-varsity font-black text-pastel-cream uppercase tracking-tight flex items-center gap-1.5">
            <CitrusSparkle className="w-4 h-4 text-pastel-orange" />
            League Activity
          </h3>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="text-xs font-display font-semibold text-pastel-cream hover:text-pastel-orange flex items-center gap-1 transition-colors bg-[#1A2A20] backdrop-blur-sm/60 px-2 py-1 rounded-lg border border-pastel-sage/30"
              title="Mark all as read"
            >
              <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Mark all</span>
            </button>
          )}
        </div>
        <div className="flex items-center justify-between relative z-10">
          <p className="text-xs font-display text-white/55">
            Real-time updates
          </p>
          {unreadCount > 0 && (
            <span className="text-xs font-varsity font-bold text-pastel-orange bg-pastel-sage/30 px-2 py-0.5 rounded-full border border-pastel-sage/50">
              {unreadCount} unread
            </span>
          )}
        </div>
      </div>

      {/* Notifications List - Scrollable */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {leagueNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 relative">
            <CitrusLeaf className="w-20 h-20 text-pastel-sage opacity-20 mb-4" />
            <Clock className="w-8 h-8 text-white/50 mb-2" aria-hidden="true" />
            <p className="text-sm font-varsity font-bold text-pastel-cream uppercase tracking-wide">No activity yet</p>
            <p className="text-xs font-display text-white/70 mt-1">
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
                        <Avatar className="h-8 w-8 border-3 border-pastel-sage shadow-patch bg-gradient-to-br from-pastel-sage/20 to-pastel-orange/20">
                          <AvatarFallback className="bg-transparent text-pastel-cream font-varsity font-black text-[10px]">
                            {teamLogo}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-[9px] font-display font-medium text-white/55 max-w-[60px] truncate text-center leading-tight">
                          {teamName}
                        </span>
                      </div>

                      {/* Message Bubble */}
                      <div className="flex flex-col gap-0.5 max-w-[75%]">
                        {!isOwnMessage && senderId && (
                          <div className="flex gap-3 text-xs">
                            <button className="min-h-11 underline" disabled={safetyBusy} onClick={() => void handleReport(notification.id)}>Report</button>
                            <button className="min-h-11 underline" disabled={safetyBusy} onClick={() => void handleBlock(notification.id)}>Block user</button>
                          </div>
                        )}
                        <div
                          className={`p-2.5 rounded-xl text-xs leading-snug shadow-sm font-display ${
                            isOwnMessage
                              ? 'bg-gradient-to-br from-pastel-orange to-pastel-sage text-pastel-cream border-2 border-pastel-orange rounded-tr-none'
                              : 'bg-[#1A2A20] backdrop-blur-sm border-2 border-pastel-sage/40 rounded-tl-none text-pastel-cream'
                          } ${notification.read_status ? 'opacity-90' : ''}`}
                        >
                          {notification.message}
                        </div>
                        <div className={`flex items-center gap-1 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                          <Clock className="w-2.5 h-2.5 text-white/50" aria-hidden="true" />
                          <span className="text-[9px] font-display text-white/70">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </span>
                          {!notification.read_status && !isOwnMessage && (
                            <div className="w-1 h-1 bg-pastel-orange rounded-full shadow-[0_0_4px_rgba(223,117,54,0.6)]" />
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
                          <p className={`text-xs font-varsity font-bold line-clamp-1 ${notification.read_status ? 'text-white/70' : 'text-pastel-cream'}`}>
                            {notification.title}
                          </p>
                          {!notification.read_status && (
                            <div className="w-2 h-2 bg-pastel-orange rounded-full flex-shrink-0 mt-1 shadow-[0_0_4px_rgba(223,117,54,0.6)]" />
                          )}
                        </div>
                        <p className={`text-xs font-display mt-0.5 line-clamp-2 ${notification.read_status ? 'text-white/60' : 'text-white/55'}`}>
                          {notification.message}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Clock className="w-3 h-3 text-white/50" aria-hidden="true" />
                          <span className="text-xs font-display text-white/70">
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
      <div className="px-3 py-2 text-xs space-y-2">
        <p>Keep league chat respectful. Report harmful content to Citrus support.</p>
        <button className="min-h-11 underline" onClick={() => void loadBlockedUsers()}>Blocked users</button>
        <a className="ml-4 underline" href="mailto:CitrusFantasySports@Gmail.com">Contact support</a>
        {blockedUsers !== null && (
          <div role="region" aria-label="Blocked users" className="space-y-2">
            {blockedUsers.length === 0 && <p>No blocked users.</p>}
            {blockedUsers.map((blocked, index) => (
              <div key={blocked.blocked_id} className="flex items-center justify-between gap-2">
                <span>{teamInfoMap.get(blocked.blocked_id)?.team_name || `Blocked user ${index + 1}`} · {new Date(blocked.created_at).toLocaleDateString()}</span>
                <button className="min-h-11 underline" disabled={safetyBusy} onClick={() => void handleUnblock(blocked.blocked_id)}>Unblock</button>
              </div>
            ))}
            <button className="min-h-11 underline" onClick={() => setBlockedUsers(null)}>Close blocked users</button>
          </div>
        )}
      </div>
      <div className="px-3 py-2.5 border-t-4 border-white/10 bg-[#1A2A20] backdrop-blur-sm backdrop-blur-sm sticky bottom-0 shadow-[0_-4px_10px_rgba(27,48,34,0.1)]">
        <form onSubmit={handleSendChatMessage} className="flex items-center gap-2">
          <input
            type="text"
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2.5 text-xs font-display bg-[#1A2A20] backdrop-blur-sm/50 border-2 border-pastel-sage/40 rounded-full focus:outline-none focus:ring-2 focus:ring-pastel-orange/30 focus:border-pastel-orange placeholder:text-white/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-pastel-cream"
            disabled={sendingMessage || !user}
          />
          <button
            type="submit"
            disabled={!chatMessage.trim() || sendingMessage || !user}
            className="h-9 w-9 bg-gradient-to-br from-pastel-sage to-pastel-orange border-3 border-white/10 text-pastel-cream rounded-varsity hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center flex-shrink-0 shadow-patch hover:shadow-varsity active:scale-95"
            title="Send message"
          >
            {sendingMessage ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LeagueNotifications;
