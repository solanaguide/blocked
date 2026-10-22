/**
 * Alpenglow consensus per slot, as seen by our Firedancer nodes: when each
 * node saw the block notarized and finalized, in ms after it completed.
 */
export interface NodeView { city: string; n?: number; f?: number }
export interface Consensus {
  slot: number;
  nk?: string;
  fk?: string;
  votes?: number;
  dur?: number;
  nodes: NodeView[];
  notarized?: number;   // median across nodes, ms after completion
  finalized?: number;
}

const bySlot = new Map<number, Consensus>();
const finals: number[] = [];
const kinds: string[] = [];
const perCity = new Map<string, number[]>();
const KEEP = 3000, SAMPLE = 150;
let newest = 0;

function median(v: number[]) {
  if (!v.length) return undefined;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function push<T>(a: T[], v: T, max = SAMPLE) {
  a.push(v);
  if (a.length > max) a.shift();
}

export function recordConsensus(m: any) {
  const nodes: NodeView[] = (m.n ?? []).map(([city, n, f]: [string, number | null, number | null]) => ({ city, n: n ?? undefined, f: f ?? undefined }));
  const c: Consensus = {
    slot: m.slot, nk: m.nk, fk: m.fk, votes: m.v, dur: m.d, nodes,
    notarized: median(nodes.flatMap((x) => (x.n === undefined ? [] : [x.n]))),
    finalized: median(nodes.flatMap((x) => (x.f === undefined ? [] : [x.f]))),
  };
  const update = bySlot.has(c.slot);
  bySlot.set(c.slot, c);
  if (c.slot > newest) newest = c.slot;
  if (!update) {
    if (c.finalized !== undefined) push(finals, c.finalized);
    if (c.fk) push(kinds, c.fk);
    for (const x of nodes) if (x.f !== undefined) {
      const a = perCity.get(x.city) ?? [];
      push(a, x.f, 60);
      perCity.set(x.city, a);
    }
  }
  if (bySlot.size > KEEP) for (const s of bySlot.keys()) { if (s < newest - KEEP) bySlot.delete(s); else break; }
}

export const consensus = (slot: number) => bySlot.get(slot);
export const hasConsensus = () => newest > 0;
/** Median ms from block completion to finalized, across nodes and recent slots */
export const finalityMs = () => median(finals) ?? 0;
/** Share of recent slots finalized on the given path */
export const kindShare = (k: string) => (kinds.length ? kinds.filter((x) => x === k).length / kinds.length : 0);
export const cityFinality = () => [...perCity].map(([city, v]) => ({ city, ms: median(v)! })).sort((a, b) => a.ms - b.ms);

/** Dev: a second socket to the local consensus relay */
export function connectConsensus(url: string) {
  const open = () => {
    const ws = new WebSocket(url);
    ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.type === 'consensus') recordConsensus(m); } catch { /* ignore */ } };
    ws.onclose = () => setTimeout(open, 3000);
  };
  open();
}
