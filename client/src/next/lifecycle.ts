/**
 * Per-slot consensus timing relayed by the server from an RPC node:
 * first shred seen, block complete, confirmed, finalized (ms after first shred).
 */
export interface Life {
  slot: number;
  t: number;
  c?: number;
  o?: number;
  r?: number;
  dead?: boolean;
}

const lives = new Map<number, Life>();
const finals: number[] = [];
const streams: number[] = [];
const KEEP = 4000;
const SAMPLE = 120;
let newest = 0;

export function recordLife(l: Life) {
  lives.set(l.slot, l);
  if (l.slot > newest) newest = l.slot;
  if (l.r !== undefined) { finals.push(l.r); if (finals.length > SAMPLE) finals.shift(); }
  if (l.c !== undefined) { streams.push(l.c); if (streams.length > SAMPLE) streams.shift(); }
  if (lives.size > KEEP) for (const s of lives.keys()) { if (s < newest - KEEP) lives.delete(s); else break; }
}

export function life(slot: number) {
  return lives.get(slot);
}

function median(v: number[]) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** Median first-shred → finalized, ms */
export const finalityMs = () => median(finals);
/** Median first-shred → block complete, ms */
export const streamMs = () => median(streams);

/**
 * The cluster's clock (ms) at a fractional playhead, interpolated between
 * the first-shred times of neighbouring slots, so stages replay at the pace
 * they really happened.
 */
export function clusterTime(playhead: number): number | undefined {
  const s = Math.floor(playhead), f = playhead - s;
  for (let k = 0; k < 12; k++) {
    const a = lives.get(s - k)?.t;
    if (a === undefined) continue;
    const b = k === 0 ? lives.get(s + 1)?.t : undefined;
    return b !== undefined && b > a ? a + f * (b - a) : a + (k + f) * 200;
  }
  return undefined;
}

/**
 * Dev fallback: build the same records straight from a public RPC when the
 * feed doesn't carry them (e.g. a local client against an older server).
 */
export function directLifecycle(url = 'wss://api.mainnet-beta.solana.com') {
  const open = new Map<number, { t: number; c?: number; o?: number; seen: number }>();
  const ws = new WebSocket(url);
  ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'slotsUpdatesSubscribe' }));
  ws.onmessage = (e) => {
    const u = JSON.parse(e.data).params?.result;
    if (!u) return;
    let p = open.get(u.slot);
    if (u.type === 'firstShredReceived' && !p) open.set(u.slot, (p = { t: u.timestamp, seen: Date.now() }));
    if (!p) return;
    if (u.type === 'completed') p.c ??= u.timestamp - p.t;
    if (u.type === 'optimisticConfirmation') p.o ??= u.timestamp - p.t;
    if (u.type === 'root' || u.type === 'dead') {
      open.delete(u.slot);
      recordLife({ slot: u.slot, t: p.t, c: p.c, o: p.o, r: u.type === 'root' ? u.timestamp - p.t : undefined, dead: u.type === 'dead' });
    }
    for (const [s, q] of open) if (Date.now() - q.seen > 4000) { open.delete(s); recordLife({ slot: s, ...q }); }
  };
}

export const hasLife = () => newest > 0;
