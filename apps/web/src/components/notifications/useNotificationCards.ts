/**
 * The realtime bridge: a row landing in the notification store becomes a
 * card at the top of the screen.
 *
 * Mounted from inside CitrusToaster, which sits at the App root above the
 * router (App.tsx), so it needs nothing from a page: the store is a module
 * singleton, and Navbar.tsx already keeps it subscribed for the active
 * league whenever someone is signed in (loadNotifications + subscribe on
 * `[user.id, activeLeagueId]`). This hook is a READER of that store, not a
 * second subscription: one channel, one source of rows, two consumers (the
 * matchup rail and this card).
 *
 * WHAT COUNTS AS NEWS. The store hands over whole lists, so "new" has to be
 * derived:
 *
 *   * the first NON-EMPTY sight of a league's list is history. Every id in
 *     it is remembered and nothing is shown -- the page load must not replay
 *     thirty cards from last week;
 *   * after that, an id not seen before is a candidate, and it shows only if
 *     it is unread and its `created_at` is inside FRESH_WINDOW_MS. The
 *     window is the second gate: a reconnect, a league switch or a reload
 *     that re-orders the list can surface an old row as "new", and an old
 *     row must not become a card that says "now";
 *   * `read_status` doubles as the actor filter for chat, because the chat
 *     RPC inserts the sender's own copy already read
 *     (20251213000000_add_chat_insert_policy.sql). Transactions are not
 *     filtered this way -- the ledger trigger notifies the actor too, and a
 *     manager who just claimed a player sees his own claim clear, which is
 *     the Sleeper behaviour.
 *
 * THE FACE. The row carries a player id and a name, not a headshot, so the
 * card appears at once with the initials disc (Mug's last fallback) and is
 * then enriched by id through PlayerService, whose per-id cache means a
 * player seen twice costs one request. The enriched face reaches the card
 * through `update`, the same handle the call sites already own; Mug tries a
 * fresh image URL on its own (Mug.tsx: a failed URL is remembered per URL),
 * so the swap needs no ceremony. If the directory has no row, the initials
 * stand. Nothing here waits on the network before showing the card.
 */
import { useEffect, useRef } from 'react';

import { useNotificationStore } from '@/stores/notificationStore';
import { toast } from '@/hooks/use-toast';
import { PlayerService } from '@/services/PlayerService';
import { mugFromDirectory } from '@/components/roster/headshot';
import type { Notification } from '@/services/NotificationService';
import { playerIdOf, toastFromNotification } from './notificationCard';

/**
 * How old a never-seen row may be and still become a card. Realtime delivers
 * in seconds; two minutes covers a slow reconnect without letting a reload
 * replay the afternoon.
 */
export const FRESH_WINDOW_MS = 2 * 60_000;

/**
 * Unread, and created inside the window. A FUTURE `created_at` passes: a
 * server clock a few seconds ahead of the phone is routine (the same call
 * relativeTime makes), and a row from the future is still a row from now.
 */
export function isFreshArrival(n: Pick<Notification, 'read_status' | 'created_at'>, now = Date.now()): boolean {
  if (n.read_status) return false;
  const t = Date.parse(n.created_at);
  return Number.isFinite(t) && now - t <= FRESH_WINDOW_MS;
}

/**
 * Show one row, then chase its face. Exported so a caller that already holds
 * a row (a foreground push payload, say) can fire a card without the store.
 */
export function showNotificationCard(n: Notification): void {
  const card = toastFromNotification(n);
  const handle = toast(card);
  if (card.kind !== 'player') return;
  const playerId = playerIdOf(n);
  if (!playerId) return;
  void PlayerService.getPlayersByIds([playerId])
    .then((players) => {
      const p = players.find((x) => String(x.id) === playerId);
      if (p) handle.update({ id: handle.id, player: mugFromDirectory(p) });
    })
    .catch(() => {
      // PlayerService logs its own failures and resolves to [] on error, so
      // this is belt and braces: a face that cannot be fetched is initials,
      // not a broken card.
    });
}

export function useNotificationCards(): void {
  const notifications = useNotificationStore((s) => s.notifications);
  // leagueId -> every id already accounted for. A ref, not state: remembering
  // an id must never itself cause a render.
  const seen = useRef(new Map<string, Set<string>>());

  useEffect(() => {
    for (const [leagueId, list] of notifications) {
      if (list.length === 0) continue;
      const ids = seen.current.get(leagueId);
      if (!ids) {
        seen.current.set(leagueId, new Set(list.map((n) => n.id)));
        continue;
      }
      const arrived = list.filter((n) => !ids.has(n.id));
      for (const n of arrived) ids.add(n.id);
      // The store prepends, so `arrived` is newest-first. Walk it oldest-first:
      // TOAST_LIMIT is 1, and the card left standing after a burst should be
      // the latest event, not the earliest.
      for (let i = arrived.length - 1; i >= 0; i -= 1) {
        if (isFreshArrival(arrived[i])) showNotificationCard(arrived[i]);
      }
    }
  }, [notifications]);
}
