import type { WireBlockMessage } from '../../../shared/types';

// Quote assets: a trade's "interesting" token is the other side of the pair
const QUOTES = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);

export interface Trade {
  usd: number;
  program: string;      // display name
  token: string;        // display symbol of the non-quote side
  tokenMint: string;
  order: number;        // 0..1 position within the block
  quality: number;      // 0 organic/unknown, 1 bot-like, 2 wash (from the indexer)
}

export interface Block {
  slot: number;
  leader: string;
  epoch: number;
  arrivedAt: number;
  txns: number;
  votes: number;
  completed: number;
  reverted: number;
  cu: number;
  okCu: number;
  failedCu: number;
  voteCu: number;
  jitoCu: number;
  jitoTxns: number;
  fees: number;          // lamports
  priorityFees: number;  // lamports
  jitoTips: number;      // lamports
  swapUsd: number;
  transferUsd: number;
  trades: Trade[];
}

// Unresolved programs arrive as raw base58 addresses
function shortName(n: string) {
  return n.length > 24 ? n.slice(0, 4) + '…' + n.slice(-4) : n;
}

function shortMint(m: string) {
  return m.slice(0, 4) + '…';
}

function decode(w: WireBlockMessage): Block {
  const raw = w as any;
  const tokens = w.tokenDex ?? [];
  const programs = w.programDex ?? [];
  const n = w.trades?.length ?? 0;
  const trades: Trade[] = (w.trades ?? []).map((t, i) => {
    const a = tokens[t.ta];
    const b = tokens[t.tb];
    const pick = a && !QUOTES.has(a.m) ? a : b && !QUOTES.has(b.m) ? b : a ?? b;
    const sym = pick?.s ?? (pick ? shortMint(pick.m) : '?');
    return {
      usd: Number.isFinite(t.vu) ? t.vu : 0,
      program: shortName(programs[t.p]?.n ?? '?'),
      token: sym.startsWith('$') ? sym : '$' + sym,
      tokenMint: pick?.m ?? '',
      order: n > 1 ? i / (n - 1) : 0.5,
      quality: t.q ?? 0,
    };
  });
  const cu = raw.cu ?? 0;
  const okCu = raw.completedCu ?? 0;
  const failedCu = raw.revertedCu ?? 0;
  return {
    slot: raw.slot,
    leader: raw.leader ?? '',
    epoch: raw.epoch ?? 0,
    arrivedAt: performance.now(),
    txns: raw.txns ?? 0,
    votes: raw.votes ?? 0,
    completed: raw.completed ?? 0,
    reverted: raw.reverted ?? 0,
    cu,
    okCu,
    failedCu,
    voteCu: Math.max(0, cu - okCu - failedCu),
    jitoCu: raw.jitoCu ?? 0,
    jitoTxns: raw.jitoTxns ?? 0,
    fees: raw.allFees ?? 0,
    priorityFees: raw.priorityFees ?? 0,
    jitoTips: raw.jitoTotal ?? 0,
    swapUsd: raw.swapVolumeUsd ?? 0,
    transferUsd: raw.transferVolumeUsd ?? 0,
    trades,
  };
}

function wsUrl() {
  const q = new URLSearchParams(location.search).get('ws');
  if (q) return q;
  // Build-time override: prod is served under solanacompass.com/3d, so the feed lives elsewhere
  if (typeof __WS_URL__ === 'string' && __WS_URL__) return __WS_URL__;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'wss://live.solanacompass.com/ws';
  }
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

export function connectFeed(onBlock: (b: Block) => void, onStatus: (up: boolean) => void) {
  let retry = 1000;
  const open = () => {
    const ws = new WebSocket(wsUrl());
    ws.onopen = () => { retry = 1000; onStatus(true); };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'block') onBlock(decode(m));
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      onStatus(false);
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 15000);
    };
  };
  open();
}
