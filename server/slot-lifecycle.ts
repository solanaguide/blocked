import WebSocket from 'ws';
import { config } from './config.js';

/**
 * Per-slot consensus timing from an RPC node's slotsUpdatesSubscribe stream.
 * Under Alpenglow the certificates themselves stay inside validators, but the
 * node still reports when it saw each stage, which is enough to show the
 * pipeline: shreds arriving, block complete, confirmed, finalized.
 */
export interface SlotLifecycle {
  type: 'lifecycle';
  slot: number;
  t: number;      // node timestamp (ms) of the first shred
  c?: number;     // ms after t: block complete
  o?: number;     // ms after t: optimistically confirmed (notarized)
  r?: number;     // ms after t: finalized (rooted)
  dead?: 1;
}

interface Pending {
  first?: number;
  completed?: number;
  confirmed?: number;
  root?: number;
  dead?: boolean;
  seen: number;
}

const EMIT_AFTER_MS = 4000;   // give up waiting for a root after this
const RECENT = 60;            // replayed to new clients so they start with history

export class SlotLifecycleFeed {
  private slots = new Map<number, Pending>();
  private recent: SlotLifecycle[] = [];
  private ws?: WebSocket;
  private retry = 1000;
  private sweep?: NodeJS.Timeout;

  constructor(private emit: (m: SlotLifecycle) => void) {}

  start() {
    this.connect();
    this.sweep = setInterval(() => this.flushStale(), 1000);
  }

  stop() {
    clearInterval(this.sweep);
    this.ws?.removeAllListeners();
    this.ws?.close();
  }

  history() {
    return this.recent;
  }

  private connect() {
    const ws = new WebSocket(config.slotUpdatesWs);
    this.ws = ws;
    ws.on('open', () => {
      this.retry = 1000;
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'slotsUpdatesSubscribe' }));
      console.log(`Slot lifecycle: subscribed via ${new URL(config.slotUpdatesWs).host}`);
    });
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.error) console.error('Slot lifecycle RPC error:', m.error.message);
        if (m.method === 'slotsUpdatesNotification') this.onUpdate(m.params.result);
      } catch { /* ignore malformed frames */ }
    });
    ws.on('close', () => {
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 30000);
    });
    ws.on('error', (err) => console.error('Slot lifecycle WS error:', err.message));
  }

  private onUpdate(u: { type: string; slot: number; timestamp: number }) {
    let p = this.slots.get(u.slot);
    if (!p) {
      // Slots first seen mid-flight (e.g. right after connecting) have no start time
      if (u.type !== 'firstShredReceived') return;
      p = { seen: Date.now() };
      this.slots.set(u.slot, p);
    }
    switch (u.type) {
      case 'firstShredReceived': p.first ??= u.timestamp; break;
      case 'completed': p.completed ??= u.timestamp; break;
      case 'optimisticConfirmation': p.confirmed ??= u.timestamp; break;
      case 'root': p.root ??= u.timestamp; break;
      case 'dead': p.dead = true; break;
      default: return;
    }
    if (p.root !== undefined || p.dead) this.finish(u.slot, p);
  }

  private flushStale() {
    const now = Date.now();
    for (const [slot, p] of this.slots) if (now - p.seen > EMIT_AFTER_MS) this.finish(slot, p);
  }

  private finish(slot: number, p: Pending) {
    this.slots.delete(slot);
    if (p.first === undefined) return;
    const rel = (v?: number) => (v === undefined ? undefined : Math.max(0, v - p.first!));
    const m: SlotLifecycle = { type: 'lifecycle', slot, t: p.first };
    const c = rel(p.completed), o = rel(p.confirmed), r = rel(p.root);
    if (c !== undefined) m.c = c;
    if (o !== undefined) m.o = o;
    if (r !== undefined) m.r = r;
    if (p.dead) m.dead = 1;
    this.recent.push(m);
    if (this.recent.length > RECENT) this.recent.shift();
    this.emit(m);
  }
}
