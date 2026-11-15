import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { RedisSubscriber } from './redis-client.js';
import { config } from './config.js';
import { TokenResolver } from './token-resolver.js';
import { programNames } from '../shared/program-names.js';
import type { TopSwap, WireBlockMessage, WireTokenEntry, WireProgramEntry, CompactTrade, AggregationInterval, BlockFields } from '../shared/types.js';
import { VALID_INTERVALS } from '../shared/types.js';
import { TimeAggregator } from './time-aggregator.js';
import type { TradeSummary } from './time-aggregator.js';
import { ConsensusFeed } from './consensus-feed.js';
import { ValidatorNames } from './validator-names.js';
import { SolPrice } from './sol-price.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: true });

const redisSubscriber = new RedisSubscriber();

interface ClientState {
  channels: Set<string>;
  // Optional field allowlist: when set, outgoing messages are trimmed to these
  // top-level keys (plus `type`/`interval`). Lets constrained clients (e.g. ESP32)
  // receive small payloads.
  fields?: string[];
  // Whether this client gets consensus messages: true with no allowlist, or when
  // the allowlist names at least one consensus field.
  consensus: boolean;
}

const MAX_FIELDS = 64;
const ALWAYS_FIELDS = ['type', 'interval'];
const CONSENSUS_FIELDS = new Set(['n', 'd', 'v', 'nk', 'fk']);

// Recent block messages (~30 s), replayed to clients that connect with ?since=<slot>
const BLOCK_REPLAY = 150;
const recentBlocks: WireBlockMessage[] = [];

const clients = new Map<WebSocket, ClientState>();
let redisConnected = false;
const startTime = Date.now();

const timeAggregator = new TimeAggregator();
const consensus = new ConsensusFeed((m) => broadcast(m, 'blocks', true));
timeAggregator.onBucketComplete((interval, data) => {
  const price = solPrice.get();
  broadcast(price === undefined ? data : { ...data, solPrice: price }, interval);
});

// Network state cache for instant visualization startup
interface NetworkStateCache {
  topPrograms: Map<string, { volume: number; trades: number }>;
  topTokens: Map<string, { volume: number; trades: number }>;
  recentVolume: number;
  recentTrades: number;
  lastBlockSlot: number;
  lastBlockTime: number;
}

const networkCache: NetworkStateCache = {
  topPrograms: new Map(),
  topTokens: new Map(),
  recentVolume: 0,
  recentTrades: 0,
  lastBlockSlot: 0,
  lastBlockTime: 0,
};

// Token name resolver (Jupiter API)
const tokenResolver = new TokenResolver();

// Validator identity → display name (Solana Compass)
const validatorNames = new ValidatorNames();

// SOL/USD price (Solana Compass), omitted from messages when stale
const solPrice = new SolPrice();

// Signature cache for redirect route: slot → full signatures array
const sigCache = new Map<number, string[]>();

// Decay factor for rolling averages (applied per block)
const CACHE_DECAY = 0.9;

// CORS configuration
const corsOrigins = config.cors.origins === '*'
  ? '*'
  : config.cors.origins.split(',').map(s => s.trim());

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: redisConnected ? 'healthy' : 'degraded',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    connections: clients.size,
    redis: redisConnected ? 'connected' : 'disconnected',
  });
});

// Network state endpoint for instant visualization startup
app.get('/api/network-state', (req, res) => {
  // Convert Maps to sorted arrays (top 10)
  const topPrograms = Array.from(networkCache.topPrograms.entries())
    .map(([id, data]) => ({ id, volume: data.volume, trades: data.trades }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  const topTokens = Array.from(networkCache.topTokens.entries())
    .map(([id, data]) => ({ id, volume: data.volume, trades: data.trades }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  res.json({
    topPrograms,
    topTokens,
    recentVolume: networkCache.recentVolume,
    recentTrades: networkCache.recentTrades,
    lastBlockSlot: networkCache.lastBlockSlot,
    lastBlockTime: networkCache.lastBlockTime,
    blockCuLimit: config.blockCuLimit,
  });
});

// Redirect to Solscan transaction page by slot + trade index
app.get('/go/:slot/:idx', (req, res) => {
  const slot = parseInt(req.params.slot, 10);
  const idx = parseInt(req.params.idx, 10);
  const sigs = sigCache.get(slot);
  if (!sigs || idx < 0 || idx >= sigs.length) {
    res.status(404).send('Trade not found (block may have expired from cache)');
    return;
  }
  res.redirect(302, `https://solscan.io/tx/${sigs[idx]}`);
});

// Aggregated data endpoints
app.get('/api/aggregated/:interval', (req, res) => {
  const interval = req.params.interval as AggregationInterval;
  if (!VALID_INTERVALS.includes(interval)) {
    res.status(400).json({ error: `Invalid interval. Use: ${VALID_INTERVALS.join(', ')}` });
    return;
  }
  const latest = timeAggregator.getLatestSnapshot(interval);
  const history = timeAggregator.getHistory(interval);
  res.json({ latest, history });
});

// Serve static files (client build)
app.use(express.static('dist/client'));

// Apply a subscription (channels and/or field allowlist) to a client's state.
// Used for both the connect URL query and later `subscribe` messages.
const VALID_CHANNELS = new Set<string>(['blocks', ...VALID_INTERVALS]);
function applySubscription(state: ClientState, channels: unknown, fields: unknown) {
  if (Array.isArray(channels)) {
    const valid = new Set<string>(channels.filter((c): c is string => typeof c === 'string' && VALID_CHANNELS.has(c)));
    if (valid.size > 0) state.channels = valid;
  }
  if (Array.isArray(fields)) {
    const list = Array.from(new Set<string>(
      fields.filter((f): f is string => typeof f === 'string' && f.length > 0 && f.length <= 64)
    )).slice(0, MAX_FIELDS).sort();
    state.fields = list.length > 0 ? list : undefined;
  }
  state.consensus = !state.fields || state.fields.some(f => CONSENSUS_FIELDS.has(f));
}

function describe(state: ClientState): string {
  return Array.from(state.channels).join(', ') + (state.fields ? ` | fields: ${state.fields.join(',')}` : '');
}

function serialize(message: any, state: ClientState): string {
  return JSON.stringify(state.fields ? projectFields(message, state.fields) : message);
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const state: ClientState = { channels: new Set(['blocks']), consensus: true };
  let since: number | undefined;

  // Subscription can be given up front in the URL (/ws?channels=blocks&fields=slot,leader)
  // so constrained clients never receive a full-size message. Unknown params are ignored.
  try {
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const split = (v: string | null) => v === null ? undefined : v.split(',').map(x => x.trim()).filter(Boolean);
    applySubscription(state, split(q.get('channels')), split(q.get('fields')));
    const s = q.get('since');
    if (s !== null && /^\d+$/.test(s.trim())) since = Number(s.trim());
  } catch { /* ignore malformed URL */ }

  // Replay missed blocks (slot > since, in slot order) before the live stream.
  // Sent synchronously before the client joins `clients`, so no duplicates.
  let replayed = 0;
  if (since !== undefined && state.channels.has('blocks') && since < networkCache.lastBlockSlot) {
    const missed = recentBlocks.filter(b => b.slot > since!).sort((a, b) => a.slot - b.slot);
    for (const b of missed) ws.send(serialize(b, state));
    replayed = missed.length;
  }

  clients.set(ws, state);
  console.log(`WS connect: ${clientIp} (${clients.size} total) [${describe(state)}]${since !== undefined ? ` since=${since} replayed=${replayed}` : ''}`);
  if (state.consensus && state.channels.has('blocks')) {
    for (const m of consensus.history()) ws.send(serialize(m, state));
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'subscribe') {
        applySubscription(state, msg.channels, msg.fields);
        console.log(`WS subscribe [${clientIp}]: ${describe(state)}`);
      }
    } catch { /* ignore malformed messages */ }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WS disconnect: ${clientIp} (${clients.size} total)`);
  });

  ws.on('error', (err) => {
    console.error(`WS error [${clientIp}]:`, err.message);
    clients.delete(ws);
  });
});

// Broadcast to subscribed clients
function projectFields(message: any, fields: string[]): any {
  const out: any = {};
  for (const k of ALWAYS_FIELDS) if (k in message) out[k] = message[k];
  for (const k of fields) if (k in message) out[k] = message[k];
  return out;
}

function broadcast(message: any, channel: string = 'blocks', isConsensus = false) {
  // Serialize once per distinct field set (full message keyed by '')
  const cache = new Map<string, string>();
  for (const [ws, state] of clients) {
    if (ws.readyState !== WebSocket.OPEN || !state.channels.has(channel)) continue;
    if (isConsensus && !state.consensus) continue;
    const key = state.fields ? state.fields.join(',') : '';
    let data = cache.get(key);
    if (data === undefined) {
      data = serialize(message, state);
      cache.set(key, data);
    }
    ws.send(data);
  }
}

// Trade accumulator - collect trades per slot, send with block
let lastBlockTime = Date.now();

interface AccumulatedTrade {
  ta: string;          // full mint address for token A
  tb: string;          // full mint address for token B
  p: string;           // full program address
  vu: number;          // volume USD
  t: number;           // timestamp (ms)
  sig: string;         // full transaction signature (for redirect cache)
  q: number;           // indexer trade quality: 0 organic/unknown, 1 bot-like, 2 wash
}
const tradesPerSlot: Map<number, AccumulatedTrade[]> = new Map();

// Process raw trade — all identifiers are full base58 addresses
function processRawTrade(raw: any): AccumulatedTrade {
  const volumeUsd = (raw.token_a.amount / Math.pow(10, raw.token_a.decimals)) *
                    (raw.token_a.price_usd / 1e12);

  return {
    t: new Date(raw['@timestamp']).getTime(),
    sig: raw.signature,
    ta: raw.token_a.id,
    tb: raw.token_b.id,
    vu: volumeUsd,
    p: raw.program_id,
    q: raw.is_wash_trade ? 2 : raw.trade_quality === 'bot_like' ? 1 : 0,
  };
}

redisSubscriber.onTrade((rawTrade) => {
  const slot = rawTrade.slot;
  const trade = processRawTrade(rawTrade);

  if (!tradesPerSlot.has(slot)) {
    tradesPerSlot.set(slot, []);
  }
  tradesPerSlot.get(slot)!.push(trade);

  // Update network cache with this trade
  const program = trade.p;
  const tokenA = trade.ta;
  const volume = trade.vu;

  // Update program stats
  const programData = networkCache.topPrograms.get(program) || { volume: 0, trades: 0 };
  programData.volume += volume;
  programData.trades += 1;
  networkCache.topPrograms.set(program, programData);

  // Update token stats (token A is the primary traded token)
  const tokenData = networkCache.topTokens.get(tokenA) || { volume: 0, trades: 0 };
  tokenData.volume += volume;
  tokenData.trades += 1;
  networkCache.topTokens.set(tokenA, tokenData);

  // Update recent totals
  networkCache.recentVolume += volume;
  networkCache.recentTrades += 1;
});

// Transform raw Redis block data into BlockFields (no trades — attached separately as wire format)
function transformBlockFields(raw: any): Omit<WireBlockMessage, 'tokenDex' | 'programDex' | 'trades'> {
  return {
    type: 'block',

    // Core block info
    slot: raw.slot,
    blockTime: raw.block_time,
    epoch: raw.epoch,
    leader: raw.leader,

    // Transaction counts
    txns: raw.txns,
    votes: raw.votes,
    completed: raw.success,
    reverted: raw.failed,

    // Compute Units
    cu: raw.cu,
    completedCu: raw.success_cu,
    revertedCu: raw.failed_cu,
    avgCu: raw.average_cu,
    medianCu: raw.median_cu,

    // Fees (lamports)
    allFees: raw.all_fees,
    baseFees: raw.base_fees,
    priorityFees: raw.priority_fees,
    rewards: raw.rewards,
    avgFee: raw.average_fee,
    medianFee: raw.median_fee,
    feesPerVolumeBps: raw.fees_per_volume_bps,

    // Jito MEV
    jitoTxns: raw.jito_transactions,
    jitoTotal: raw.jito_total,
    jitoAvgTip: raw.jito_average_tip,
    jitoMedianTip: raw.jito_median_tip,
    jitoCu: raw.jito_cu,

    // Priority fees
    priorityTxns: raw.priority_transactions,
    priorityAvg: raw.priority_average,
    priorityMedian: raw.priority_median,
    priorityMin: raw.priority_min,
    priorityMax: raw.priority_max,
    dualTipTxns: raw.dual_tip_transactions,

    // Swaps
    swapTxns: raw.swap_txns,
    swapCount: raw.swap_count,
    swapVolumeUsd: raw.swap_volume_usd / 1e12,
    uniqueTraders: raw.unique_traders,
    uniquePools: raw.unique_pools,
    uniqueTokens: raw.unique_tokens,

    // Transfers
    transferTxns: raw.transfer_txns,
    transferCount: raw.transfer_count,
    transferVolumeUsd: raw.transfer_volume_usd / 1e12,

    // Accounts
    uniqueAccounts: raw.unique_accounts,
    uniqueWritable: raw.unique_writable,
    uniquePrograms: raw.unique_programs,
    uniqueSigners: raw.unique_signers,

    // Instructions
    totalInstructions: raw.total_instructions,
    totalInnerInstructions: raw.total_inner_instructions,
    avgCpiDepth: raw.avg_cpi_depth,
  };
}

// Build wire-format lookup tables and compact trades from accumulated trades
function buildWireTrades(trades: AccumulatedTrade[], blockTimeSec: number): {
  tokenDex: WireTokenEntry[];
  programDex: WireProgramEntry[];
  compactTrades: CompactTrade[];
} {
  const tokenIndexMap = new Map<string, number>();   // fullMint → index
  const programIndexMap = new Map<string, number>(); // fullProgramId → index
  const tokenDex: WireTokenEntry[] = [];
  const programDex: WireProgramEntry[] = [];
  const blockTimeMs = blockTimeSec * 1000;

  function getTokenIndex(mint: string): number {
    let idx = tokenIndexMap.get(mint);
    if (idx === undefined) {
      idx = tokenDex.length;
      tokenIndexMap.set(mint, idx);
      const info = tokenResolver.getTokenInfo(mint);
      tokenDex.push({
        m: mint,
        s: info ? `$${info.symbol}` : undefined,
        l: info?.image,
      });
    }
    return idx;
  }

  function getProgramIndex(programId: string): number {
    let idx = programIndexMap.get(programId);
    if (idx === undefined) {
      idx = programDex.length;
      programIndexMap.set(programId, idx);
      programDex.push({
        id: programId,
        n: programNames[programId] || programId,
      });
    }
    return idx;
  }

  const compactTrades: CompactTrade[] = trades.map(trade => ({
    ta: getTokenIndex(trade.ta),
    tb: getTokenIndex(trade.tb),
    p: getProgramIndex(trade.p),
    vu: trade.vu,
    dt: trade.t - blockTimeMs,
    ...(trade.q ? { q: trade.q } : {}),
  }));

  return { tokenDex, programDex, compactTrades };
}

// Quote-side tokens: when a swap involves one of these, name the other side.
const QUOTE_MINTS = new Set([
  'So11111111111111111111111111111111111111112',  // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

function computeTopSwap(trades: AccumulatedTrade[]): TopSwap | undefined {
  let top: AccumulatedTrade | undefined;
  for (const t of trades) {
    if (t.q === 2) continue; // skip wash trades
    if (Number.isFinite(t.vu) && (!top || t.vu > top.vu)) top = t;
  }
  if (!top) return undefined;
  const mint = QUOTE_MINTS.has(top.ta) && !QUOTE_MINTS.has(top.tb) ? top.tb : top.ta;
  const symbol = tokenResolver.getTokenInfo(mint)?.symbol ?? mint.slice(0, 4);
  return {
    usd: Math.round(top.vu),
    symbol,
    dex: programNames[top.p] || top.p.slice(0, 4),
  };
}

redisSubscriber.onBlock(async (rawBlock) => {
  const now = Date.now();
  const blockGap = now - lastBlockTime;
  const slot = rawBlock.slot;

  // Get accumulated trades for this slot
  const trades = tradesPerSlot.get(slot) || [];
  const blockFields = transformBlockFields(rawBlock);

  // Update network cache block info
  networkCache.lastBlockSlot = slot;
  networkCache.lastBlockTime = rawBlock.block_time;

  // Apply decay to cache values (rolling window effect)
  networkCache.recentVolume *= CACHE_DECAY;
  networkCache.recentTrades *= CACHE_DECAY;

  // Decay program and token volumes
  networkCache.topPrograms.forEach((data, program) => {
    data.volume *= CACHE_DECAY;
    data.trades *= CACHE_DECAY;
    if (data.volume < 0.01 && data.trades < 0.01) {
      networkCache.topPrograms.delete(program);
    }
  });

  networkCache.topTokens.forEach((data, token) => {
    data.volume *= CACHE_DECAY;
    data.trades *= CACHE_DECAY;
    if (data.volume < 0.01 && data.trades < 0.01) {
      networkCache.topTokens.delete(token);
    }
  });

  // Diagnostic log
  const trackedSlots = Array.from(tradesPerSlot.keys()).sort((a, b) => b - a).slice(0, 5);
  console.log(`BLOCK ${slot} | gap: ${blockGap}ms | trades: ${trades.length}/${rawBlock.swap_count} | tracked slots: [${trackedSlots.join(', ')}]`);

  // Clean up old slots (keep last 10)
  if (tradesPerSlot.size > 20) {
    const slots = Array.from(tradesPerSlot.keys()).sort((a, b) => a - b);
    for (let i = 0; i < slots.length - 10; i++) {
      tradesPerSlot.delete(slots[i]);
    }
  }

  // Resolve any unknown tokens via Jupiter API
  const mints = new Set<string>();
  for (const trade of trades) {
    mints.add(trade.ta);
    mints.add(trade.tb);
  }
  const missingMints = tokenResolver.getMissing(Array.from(mints));
  if (missingMints.length > 0) {
    await tokenResolver.resolve(missingMints);
  }

  // Build wire-format compact trades with lookup tables
  const { tokenDex, programDex, compactTrades } = buildWireTrades(trades, rawBlock.block_time);

  // Cache signatures for redirect route (client links to /go/:slot/:idx)
  sigCache.set(slot, trades.map(t => t.sig));
  // Keep only last 10 blocks in cache
  if (sigCache.size > 10) {
    const oldest = Array.from(sigCache.keys()).sort((a, b) => a - b);
    for (let i = 0; i < oldest.length - 10; i++) {
      sigCache.delete(oldest[i]);
    }
  }

  const wireMessage: WireBlockMessage = {
    ...blockFields,
    tokenDex,
    programDex,
    trades: compactTrades,
    leaderName: validatorNames.get(rawBlock.leader),
    topSwap: computeTopSwap(trades),
    solPrice: solPrice.get(),
  };

  // Feed block + trade summaries to time aggregator
  const tradeSummaries: TradeSummary[] = trades.map(t => ({
    program: t.p,
    tokenA: t.ta,
    volume: t.vu,
  }));
  timeAggregator.ingestBlock(blockFields as BlockFields, tradeSummaries);

  lastBlockTime = now;
  recentBlocks.push(wireMessage);
  if (recentBlocks.length > BLOCK_REPLAY) recentBlocks.shift();
  broadcast(wireMessage);
});

// Start server
async function start() {
  try {
    await redisSubscriber.subscribe();
    redisConnected = true;

    timeAggregator.start();
    consensus.start();
    validatorNames.start();
    solPrice.start();

    server.listen(config.websocket.port, () => {
      console.log(`Server started on port ${config.websocket.port}`);
      console.log(`  WebSocket: ws://localhost:${config.websocket.port}/ws`);
      console.log(`  Health:    http://localhost:${config.websocket.port}/health`);
      console.log(`  Redis:     ${config.redis.host}:${config.redis.port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  timeAggregator.stop();
  consensus.stop();
  await redisSubscriber.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nSIGTERM received, shutting down...');
  timeAggregator.stop();
  consensus.stop();
  await redisSubscriber.close();
  server.close();
  process.exit(0);
});

start();
