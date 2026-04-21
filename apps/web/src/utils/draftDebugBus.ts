/**
 * Draft debug event bus — in-memory ring buffer of draft timing events
 * for the commissioner debug overlay and post-mortem analysis.
 *
 * Enabled when localStorage.draftDebug === '1' OR URL has ?draftDebug=1.
 * Records stay in memory until the page is reloaded. Nothing is sent anywhere.
 */

export type DraftDebugEventKind =
  | 'broadcast_received'        // pick arrived via Supabase Broadcast fast path
  | 'postgres_pick_received'    // pick arrived via postgres_changes slow path
  | 'postgres_league_received'  // league row (timerStartedAt) arrived via postgres_changes
  | 'pick_handler_invoked'      // DraftRoom realtime callback entered
  | 'poll_completed'            // background poll finished
  | 'reconcile_started'         // background reconciliation began
  | 'reconcile_completed'       // background reconciliation finished
  | 'timer_tick'                // sampled timer tick (not every tick — every ~2s)
  | 'timer_reset'               // client reset its local timer
  | 'realtime_status';          // channel connected/reconnecting/disconnected

export interface DraftDebugEvent {
  kind: DraftDebugEventKind;
  at: number; // Date.now()
  data?: Record<string, unknown>;
}

const MAX_EVENTS = 200;

class DraftDebugBus {
  private events: DraftDebugEvent[] = [];
  private subscribers = new Set<(e: DraftDebugEvent) => void>();
  private enabled: boolean | null = null;

  isEnabled(): boolean {
    if (this.enabled !== null) return this.enabled;
    if (typeof window === 'undefined') {
      this.enabled = false;
      return false;
    }
    try {
      const fromStorage = window.localStorage.getItem('draftDebug') === '1';
      const fromQuery = new URLSearchParams(window.location.search).get('draftDebug') === '1';
      this.enabled = fromStorage || fromQuery;
    } catch {
      this.enabled = false;
    }
    return this.enabled;
  }

  record(kind: DraftDebugEventKind, data?: Record<string, unknown>): void {
    if (!this.isEnabled()) return;
    const ev: DraftDebugEvent = { kind, at: Date.now(), data };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    this.subscribers.forEach((cb) => {
      try {
        cb(ev);
      } catch {
        // don't let a bad subscriber break the bus
      }
    });
  }

  getEvents(): readonly DraftDebugEvent[] {
    return this.events;
  }

  subscribe(cb: (e: DraftDebugEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }
}

export const draftDebugBus = new DraftDebugBus();
