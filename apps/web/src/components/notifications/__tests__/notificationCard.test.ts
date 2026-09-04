// notificationCard: a `notifications` row becomes a card (2026-09-03).
//
// Pure, so every row shape the writers produce can be pinned without a Radix
// provider. The fixtures are the shapes the SERVER writes, read from the
// migrations and the services rather than from the client's type union:
// the ledger trigger's ADD / DROP / TRADE metadata, the chat RPC's
// sender_name, and the two lowercase types the server has written since
// 2026-08-16 that the repo's check constraint does not admit.
import { describe, it, expect } from 'vitest';

import type { Notification } from '@/services/NotificationService';
import {
  STATUS_PILLS,
  WAIVER_SOURCE,
  arrivedAt,
  playerIdOf,
  toastFromNotification,
} from '../notificationCard';

/** The shape Supabase realtime hands over: microseconds and a zone offset. */
const AT = '2026-09-03T02:11:05.123456+00:00';

const row = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  league_id: 'L1',
  user_id: 'U1',
  type: 'ADD',
  title: 'Free Agent Added',
  message: 'Gstorms added Connor McDavid.',
  metadata: {
    team_id: 'T1',
    team_name: 'Gstorms',
    player_id: '8478402',
    player_name: 'Connor McDavid',
    source: 'Free Agent',
  },
  read_status: false,
  created_at: AT,
  read_at: null,
  ...over,
});

describe('toastFromNotification: the rows that carry a player get the face', () => {
  it('a free-agent ADD is a player card: name, actor · what happened, the Added pill, the time', () => {
    const card = toastFromNotification(row());
    expect(card.kind).toBe('player');
    expect(card.title).toBe('Connor McDavid');
    expect(card.meta).toBe('Gstorms · free agent pickup');
    expect(card.status).toEqual(STATUS_PILLS.added);
    expect(card.status?.tone).toBe('good');
    expect(card.at).toBe(Date.parse(AT));
    // The face starts as the name alone (initials on the disc); the image
    // and the crest arrive by enrichment, not from the row.
    expect(card.player).toEqual({ name: 'Connor McDavid' });
    expect(card.description).toBeUndefined();
  });

  it('an ADD whose source is the waiver processor is a claim that cleared', () => {
    const card = toastFromNotification(
      row({ title: 'Waiver Claim Awarded', metadata: { ...row().metadata, source: WAIVER_SOURCE } }),
    );
    expect(card.kind).toBe('player');
    expect(card.status).toEqual(STATUS_PILLS.waiverCleared);
    expect(card.meta).toBe('Gstorms · claim awarded');
  });

  it('a DROP is a neutral fact, not a verdict', () => {
    const card = toastFromNotification(row({ type: 'DROP', title: 'Player Dropped' }));
    expect(card.kind).toBe('player');
    expect(card.status).toEqual(STATUS_PILLS.dropped);
    expect(card.status?.tone).toBe('neutral');
    expect(card.meta).toBe('Gstorms · released');
  });

  it('a TRADE (the acquiring side, the only one the trigger notifies) is a trade accepted', () => {
    const card = toastFromNotification(
      row({ type: 'TRADE', title: 'Trade Completed', metadata: { ...row().metadata, source: 'Trade in' } }),
    );
    expect(card.status).toEqual(STATUS_PILLS.tradeAccepted);
    expect(card.meta).toBe('Gstorms · acquired by trade');
  });

  it('a missing team name leaves the verb alone rather than printing a second placeholder', () => {
    const card = toastFromNotification(row({ metadata: { ...row().metadata, team_name: '' } }));
    expect(card.meta).toBe('free agent pickup');
  });

  it('a numeric player_id (waiver_claims writes a number) is still a player', () => {
    const card = toastFromNotification(row({ metadata: { ...row().metadata, player_id: 8478402 } }));
    expect(card.kind).toBe('player');
  });
});

describe('toastFromNotification: everything else is the plain shape', () => {
  it('a null player id renders the plain card carrying the server copy', () => {
    const card = toastFromNotification(row({ metadata: { ...row().metadata, player_id: null } }));
    expect(card.kind).toBe('info');
    expect(card.title).toBe('Free Agent Added');
    expect(card.description).toBe('Gstorms added Connor McDavid.');
    expect(card.player).toBeUndefined();
    expect(card.status).toBeUndefined();
    expect(card.meta).toBeUndefined();
    expect(card.at).toBe(Date.parse(AT));
  });

  it('a player id that is not digits cannot be enriched and gets no face', () => {
    expect(toastFromNotification(row({ metadata: { ...row().metadata, player_id: 'abc' } })).kind).toBe('info');
    expect(toastFromNotification(row({ metadata: { ...row().metadata, player_id: '' } })).kind).toBe('info');
  });

  it('a player id without a name gets no face either: the name is the headline and the initials', () => {
    const card = toastFromNotification(row({ metadata: { ...row().metadata, player_name: undefined } }));
    expect(card.kind).toBe('info');
    expect(card.player).toBeUndefined();
  });

  it('no metadata at all is a plain card, not a crash', () => {
    const card = toastFromNotification(row({ metadata: undefined as unknown as Record<string, unknown> }));
    expect(card.kind).toBe('info');
    expect(card.title).toBe('Free Agent Added');
  });

  it('SYSTEM is a plain info card', () => {
    const card = toastFromNotification(
      row({ type: 'SYSTEM', title: 'Keepers Locked', message: '3 keepers locked.', metadata: {} }),
    );
    expect(card).toMatchObject({ kind: 'info', title: 'Keepers Locked', description: '3 keepers locked.' });
  });

  it('CHAT names the sender, not "sent a message"', () => {
    const card = toastFromNotification(
      row({
        type: 'CHAT',
        title: 'Lime sent a message',
        message: 'who wants Makar',
        metadata: { sender_id: 'U2', sender_name: 'Lime' },
      }),
    );
    expect(card).toMatchObject({ kind: 'info', title: 'Lime', description: 'who wants Makar' });
  });

  it('CHAT without a sender name keeps the row title', () => {
    const card = toastFromNotification(row({ type: 'CHAT', title: 'Someone sent a message', metadata: {} }));
    expect(card.title).toBe('Someone sent a message');
  });

  it('waiver_result (a type the constraint may reject) reads as success or warning by its status', () => {
    const won = toastFromNotification(
      row({
        type: 'waiver_result' as unknown as Notification['type'],
        title: 'Waiver Claim Successful',
        message: 'Connor McDavid is now on your roster.',
        metadata: { claim_id: 'c1', player_id: 8478402, status: 'successful' },
      }),
    );
    expect(won.kind).toBe('success');
    const lost = toastFromNotification(
      row({
        type: 'waiver_result' as unknown as Notification['type'],
        title: 'Waiver Claim Missed',
        message: 'Your claim did not go through.',
        metadata: { claim_id: 'c1', player_id: 8478402, status: 'failed' },
      }),
    );
    expect(lost.kind).toBe('warning');
    // A player id without a player name is still not a face.
    expect(won.player).toBeUndefined();
  });

  it('an unknown type is info, never a throw', () => {
    expect(toastFromNotification(row({ type: 'trade_offer' as unknown as Notification['type'], metadata: {} })).kind).toBe('info');
  });
});

describe('playerIdOf and arrivedAt', () => {
  it('reads a digits-only id in either form and trims it', () => {
    expect(playerIdOf({ metadata: { player_id: '8478402' } })).toBe('8478402');
    expect(playerIdOf({ metadata: { player_id: 8478402 } })).toBe('8478402');
    expect(playerIdOf({ metadata: { player_id: ' 8478402 ' } })).toBe('8478402');
  });

  it('is null for nothing, empty, null and non-digits', () => {
    expect(playerIdOf({ metadata: {} })).toBeNull();
    expect(playerIdOf({ metadata: { player_id: null } })).toBeNull();
    expect(playerIdOf({ metadata: { player_id: '' } })).toBeNull();
    expect(playerIdOf({ metadata: { player_id: '84a' } })).toBeNull();
    expect(playerIdOf({ metadata: undefined as unknown as Record<string, unknown> })).toBeNull();
  });

  it('parses the realtime timestamp shape and degrades to undefined, not NaN', () => {
    expect(arrivedAt({ created_at: AT })).toBe(Date.parse(AT));
    expect(Number.isFinite(arrivedAt({ created_at: AT }))).toBe(true);
    expect(arrivedAt({ created_at: 'not a date' })).toBeUndefined();
  });
});

describe('the pill vocabulary', () => {
  it('every pill is a state of at most two words, in a tone the card can paint', () => {
    const tones = new Set(['good', 'attention', 'bad', 'neutral']);
    for (const [key, pill] of Object.entries(STATUS_PILLS)) {
      expect(pill.label.trim().split(/\s+/).length, key).toBeLessThanOrEqual(2);
      expect(tones.has(pill.tone), `${key}: ${pill.tone}`).toBe(true);
      // U+2014 is banned outright in anything a reader sees (aiVoice.json emDash).
      expect(pill.label).not.toContain('\u2014');
    }
  });

  it('carries the states the brief named, decided once', () => {
    expect(STATUS_PILLS.waiverCleared.label).toBe('Waiver cleared');
    expect(STATUS_PILLS.tradeAccepted.label).toBe('Trade accepted');
    expect(STATUS_PILLS.lineupLocked.label).toBe('Lineup locked');
    expect(STATUS_PILLS.draftPick.label).toBe('Draft pick');
    expect(STATUS_PILLS.injury.label).toBe('Injury');
    // A loss is the ruby; a thing to act on is the orange; a fact is neutral.
    expect(STATUS_PILLS.claimMissed.tone).toBe('bad');
    expect(STATUS_PILLS.tradeOffer.tone).toBe('attention');
    expect(STATUS_PILLS.injury.tone).toBe('attention');
    expect(STATUS_PILLS.lineupLocked.tone).toBe('neutral');
  });
});
