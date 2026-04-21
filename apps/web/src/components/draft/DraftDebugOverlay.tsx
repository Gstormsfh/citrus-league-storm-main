import { useEffect, useState } from 'react';
import {
  draftDebugBus,
  type DraftDebugEvent,
  type DraftDebugEventKind,
} from '@/utils/draftDebugBus';

interface DraftDebugOverlayProps {
  show: boolean;
  timerStartedAt: string | null | undefined;
  pickTimeLimit: number | undefined;
  realtimeStatus: 'connected' | 'reconnecting' | 'disconnected';
}

/**
 * Commissioner-only debug overlay for investigating draft timing.
 * Shows a live feed of the draftDebugBus events plus a summary of
 * the most recent broadcast / postgres / poll / tick timestamps so
 * we can see at a glance which path is delivering picks and timer
 * updates, and how long the gap is between them.
 *
 * Toggle with ?draftDebug=1 in the URL or localStorage.draftDebug=1.
 * Passed `show` from DraftRoom — hidden otherwise.
 */
export function DraftDebugOverlay({
  show,
  timerStartedAt,
  pickTimeLimit,
  realtimeStatus,
}: DraftDebugOverlayProps) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!show) return;
    // Re-render whenever a new event is recorded OR once per second so
    // the "N ms ago" counters update.
    const unsub = draftDebugBus.subscribe(() => forceTick((t) => t + 1));
    const interval = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [show]);

  if (!show) return null;

  // Recompute on every render — forceTick above drives re-renders whenever
  // a new event lands OR once per second for the "Nms ago" counters.
  const events = draftDebugBus.getEvents();
  const latestByKind: Partial<Record<DraftDebugEventKind, DraftDebugEvent>> = {};
  for (const e of events) {
    latestByKind[e.kind] = e;
  }
  const recentEvents = events.slice(-20).reverse();

  const now = Date.now();
  const fmtAgo = (e: DraftDebugEvent | undefined) =>
    e ? `${now - e.at}ms ago` : '—';

  const broadcast = latestByKind['broadcast_received'];
  const pgPick = latestByKind['postgres_pick_received'];
  const pgLeague = latestByKind['postgres_league_received'];
  const poll = latestByKind['poll_completed'];
  const tick = latestByKind['timer_tick'];
  const reset = latestByKind['timer_reset'];

  const timerElapsedMs = timerStartedAt
    ? now - new Date(timerStartedAt).getTime()
    : null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        width: 380,
        maxHeight: '60vh',
        background: 'rgba(15, 15, 20, 0.95)',
        color: '#e5e7eb',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        border: '1px solid #374151',
        borderRadius: 6,
        zIndex: 9999,
        boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid #374151',
          fontWeight: 600,
          color: '#fbbf24',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>DRAFT DEBUG</span>
        <span style={{ color: realtimeStatus === 'connected' ? '#10b981' : '#ef4444' }}>
          rt: {realtimeStatus}
        </span>
      </div>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #374151' }}>
        <div>timerStartedAt: <span style={{ color: '#93c5fd' }}>{timerStartedAt ?? 'null'}</span></div>
        <div>pickTimeLimit: {pickTimeLimit ?? '—'}s</div>
        <div>elapsed: {timerElapsedMs !== null ? `${Math.floor(timerElapsedMs / 1000)}s` : '—'}</div>
      </div>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #374151' }}>
        <div>broadcast: {fmtAgo(broadcast)} {broadcast?.data?.pickNumber ? `#${String(broadcast.data.pickNumber)}` : ''}</div>
        <div>pg pick:   {fmtAgo(pgPick)} {pgPick?.data?.pickNumber ? `#${String(pgPick.data.pickNumber)}` : ''}</div>
        <div>pg league: {fmtAgo(pgLeague)}</div>
        <div>poll:      {fmtAgo(poll)} {poll?.data?.durationMs ? `(${String(poll.data.durationMs)}ms)` : ''}</div>
        <div>tick:      {fmtAgo(tick)} {tick?.data?.remaining !== undefined ? `r=${String(tick.data.remaining)}` : ''}</div>
        <div>reset:     {fmtAgo(reset)} {reset?.data?.source ? `(${String(reset.data.source)})` : ''}</div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: '4px 10px' }}>
        {recentEvents.map((e, idx) => (
          <div key={`${e.at}-${idx}`} style={{ opacity: 0.85, paddingTop: 2 }}>
            <span style={{ color: '#9ca3af' }}>{new Date(e.at).toISOString().slice(11, 23)}</span>{' '}
            <span style={{ color: '#fbbf24' }}>{e.kind}</span>
            {e.data ? ` ${JSON.stringify(e.data)}` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
