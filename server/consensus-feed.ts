import Redis from 'ioredis';
import { config } from './config.js';

/**
 * Alpenglow consensus as seen by our Firedancer nodes (validatormetrics
 * fd:monitor-all). Each node publishes completed / notarized / finalized per
 * slot; latencies are ms after the block completed, on that node's clock.
 * Browsers get one compact summary per slot instead of every node event.
 */
interface Pending {
  nk?: string;
  fk?: string;
  votes?: number;
  durations: number[];
  nodes: Map<string, { n?: number; f?: number }>;
  first: number;
  sent: boolean;
}

export interface ConsensusMessage {
  type: 'consensus';
  slot: number;
  nk?: string;                 // notarization kind: regular | fallback
  fk?: string;                 // finalization kind: fast | slow
  v?: number;                  // vote count
  d?: number;                  // median block time across nodes, ms
  n: [string, number | null, number | null][];   // city, notarized ms, finalized ms
}

const SEND_AFTER_MS = 900;       // most nodes have finalized well within this
const LATE_UNTIL_MS = 10_000;    // slow stragglers still update the slot until then
const RECENT = 60;

export class ConsensusFeed {
  private redis?: Redis;
  private slots = new Map<number, Pending>();
  private recent: ConsensusMessage[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private emit: (m: ConsensusMessage) => void) {}

  start() {
    const { host, port, channel } = config.alpenglow;
    this.redis = new Redis({ host, port, lazyConnect: false });
    this.redis.on('error', (err) => console.error('Alpenglow Redis error:', err.message));
    this.redis.subscribe(channel).then(() => console.log(`📡 Subscribed to ${channel} at ${host}:${port}`)).catch(() => {});
    this.redis.on('message', (_ch, raw) => {
      try { this.onEvent(JSON.parse(raw)); } catch { /* ignore malformed */ }
    });
    this.timer = setInterval(() => this.flush(), 200);
  }

  stop() {
    clearInterval(this.timer);
    this.redis?.disconnect();
  }

  history() {
    return this.recent;
  }

  private onEvent(e: any) {
    if (typeof e.slot !== 'number' || typeof e.city !== 'string') return;
    let p = this.slots.get(e.slot);
    if (!p) {
      p = { durations: [], nodes: new Map(), first: Date.now(), sent: false };
      this.slots.set(e.slot, p);
    }
    p.nk = e.notarization_kind ?? p.nk;
    p.fk = e.finalization_kind ?? p.fk;
    p.votes = e.vote_count ?? p.votes;
    const node = p.nodes.get(e.city) ?? {};
    if (e.stage === 'completed' && typeof e.duration_ms === 'number') p.durations.push(e.duration_ms);
    if (e.stage === 'notarized' && typeof e.latency_ms === 'number') node.n ??= e.latency_ms;
    if (e.stage === 'finalized' && typeof e.latency_ms === 'number') {
      node.f ??= e.latency_ms;
      if (p.sent) this.send(e.slot, p);    // a straggler finalized after the summary went out
    }
    p.nodes.set(e.city, node);
  }

  private flush() {
    const now = Date.now();
    for (const [slot, p] of this.slots) {
      if (!p.sent && now - p.first >= SEND_AFTER_MS) { p.sent = true; this.send(slot, p); }
      if (now - p.first > LATE_UNTIL_MS) this.slots.delete(slot);
    }
  }

  private send(slot: number, p: Pending) {
    const d = [...p.durations].sort((a, b) => a - b);
    const m: ConsensusMessage = {
      type: 'consensus',
      slot,
      n: [...p.nodes].map(([city, x]) => [city, x.n ?? null, x.f ?? null]),
    };
    if (p.nk) m.nk = p.nk;
    if (p.fk) m.fk = p.fk;
    if (p.votes) m.v = p.votes;
    if (d.length) m.d = d[d.length >> 1];
    const i = this.recent.findIndex((r) => r.slot === slot);
    if (i >= 0) this.recent[i] = m; else { this.recent.push(m); if (this.recent.length > RECENT) this.recent.shift(); }
    this.emit(m);
  }
}
