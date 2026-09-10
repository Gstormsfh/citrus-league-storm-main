/**
 * CHAT HAS A DOOR (2026-09-09).
 *
 * Found from a phone screenshot next to Yahoo's: on every Press Box league
 * page the only way into league chat was the bell in the desktop Navbar,
 * and every one of those pages wraps that Navbar in `hidden lg:block`. On a
 * phone, league chat was not hard to find — it was unreachable. The chrome
 * that replaced the old navbar kept the sliders and dropped the bell.
 *
 * This pins the door: the LeagueHeader draws a chat button with the unread
 * badge, the chrome wires it to a sheet holding LeagueNotifications, and the
 * unread count comes from the same store the desktop bell reads.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const HEADER = read('../components/pressbox/LeagueHeader.tsx');
const CHROME = read('../components/pressbox/LeagueChrome.tsx');

describe('league chat is reachable from the phone chrome', () => {
  it('the header draws a chat button with an unread badge', () => {
    expect(HEADER).toContain('data-testid="league-chat-button"');
    expect(HEADER).toContain("chatUnread > 9 ? '9+' : chatUnread");
    // Only where there is a chat to open: no opener, no button.
    expect(HEADER).toMatch(/\{onChatPress && \(/);
  });

  it('the chrome opens a sheet holding the league activity panel', () => {
    expect(CHROME).toContain('onChatPress={resolvedId && userId ? () => setChatOpen(true) : undefined}');
    expect(CHROME).toContain('<LeagueNotifications leagueId={resolvedId} />');
    // Mounted only while open, like the menu.
    expect(CHROME).toMatch(/\{chatOpen && resolvedId && \(/);
  });

  it('the badge reads the same store as the desktop bell, and subscribes', () => {
    expect(CHROME).toContain('useNotificationStore((s) => (resolvedId ? s.unreadCounts.get(resolvedId) || 0 : 0))');
    expect(CHROME).toContain('store.subscribe(resolvedId, userId);');
    expect(CHROME).toContain('store.unsubscribe(resolvedId);');
  });
});
