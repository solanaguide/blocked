import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { RedisSubscriber } from './redis-client.js';
import { config } from './config.js';
import { TokenResolver } from './token-resolver.js';
import { programNames } from '../shared/program-names.js';
import type { BlockMessage, TradeMessage } from '../shared/types.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const redisSubscriber = new RedisSubscriber();

const clients = new Set<WebSocket>();
let redisConnected = false;
const startTime = Date.now();

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

// Reverse map: shortMint → fullMint (populated during processRawTrade)
const mintReverseMap: Map<string, string> = new Map();

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
  });
});

// Serve static files (client build)
app.use(express.static('dist/client'));

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`WS connect: ${clientIp} (${clients.size + 1} total)`);
  clients.add(ws);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WS disconnect: ${clientIp} (${clients.size} total)`);
  });

  ws.on('error', (err) => {
    console.error(`WS error [${clientIp}]:`, err.message);
    clients.delete(ws);
  });
});

// Broadcast to all connected clients
function broadcast(message: any) {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Trade accumulator - collect trades per slot, send with block
let lastBlockTime = Date.now();
const tradesPerSlot: Map<number, TradeMessage[]> = new Map();

// Shorten program IDs using the full program names map
function shortenProgramId(id: string): string {
  return programNames[id] || id.slice(0, 8);
}

// Shorten token mints
function shortenMint(mint: string): string {
  const map: Record<string, string> = {
    'So11111111111111111111111111111111111111112': 'SOL',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  };
  return map[mint] || mint.slice(0, 8);
}

// Process raw trade into compact format
function processRawTrade(raw: any): TradeMessage {
  const volumeUsd = (raw.token_a.amount / Math.pow(10, raw.token_a.decimals)) *
                    (raw.token_a.price_usd / 1e12);

  const shortA = shortenMint(raw.token_a.id);
  const shortB = shortenMint(raw.token_b.id);

  // Populate reverse map for token name resolution
  mintReverseMap.set(shortA, raw.token_a.id);
  mintReverseMap.set(shortB, raw.token_b.id);

  const trade: TradeMessage = {
    s: raw.slot,
    t: new Date(raw['@timestamp']).getTime(),
    sig: raw.signature.slice(0, 8),
    ta: shortA,
    tb: shortB,
    vu: volumeUsd,
    p: shortenProgramId(raw.program_id),
  };

  if (raw.parent_program_id) {
    trade.pp = shortenProgramId(raw.parent_program_id);
  }

  return trade;
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

// Transform raw Redis block data into BlockMessage format
function transformBlockData(raw: any, trades: TradeMessage[]): BlockMessage {
  return {
    type: 'block',

    // Core block info
    slot: raw.slot,
    parentSlot: raw.parent_slot,
    blockhash: raw.blockhash,
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

    // Bundled trades
    trades,
  };
}

redisSubscriber.onBlock(async (rawBlock) => {
  const now = Date.now();
  const blockGap = now - lastBlockTime;
  const slot = rawBlock.slot;

  // Get accumulated trades for this slot
  const trades = tradesPerSlot.get(slot) || [];
  const blockMessage = transformBlockData(rawBlock, trades);

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
    // Remove entries with negligible values
    if (data.volume < 0.01 && data.trades < 0.01) {
      networkCache.topPrograms.delete(program);
    }
  });

  networkCache.topTokens.forEach((data, token) => {
    data.volume *= CACHE_DECAY;
    data.trades *= CACHE_DECAY;
    // Remove entries with negligible values
    if (data.volume < 0.01 && data.trades < 0.01) {
      networkCache.topTokens.delete(token);
    }
  });

  // Diagnostic log - show what slots we have trades for
  const trackedSlots = Array.from(tradesPerSlot.keys()).sort((a, b) => b - a).slice(0, 5);
  console.log(`BLOCK ${slot} | gap: ${blockGap}ms | trades: ${trades.length}/${rawBlock.swap_count} | tracked slots: [${trackedSlots.join(', ')}]`);

  // Clean up old slots (keep last 10)
  if (tradesPerSlot.size > 20) {
    const slots = Array.from(tradesPerSlot.keys()).sort((a, b) => a - b);
    for (let i = 0; i < slots.length - 10; i++) {
      tradesPerSlot.delete(slots[i]);
    }
  }

  // Collect mints from this block's trades for token resolution
  const blockMints = new Map<string, string>(); // shortMint → fullMint
  for (const trade of trades) {
    const fullA = mintReverseMap.get(trade.ta);
    const fullB = mintReverseMap.get(trade.tb);
    if (fullA) blockMints.set(trade.ta, fullA);
    if (fullB) blockMints.set(trade.tb, fullB);
  }

  // Resolve any unknown tokens via Jupiter API
  const fullMints = Array.from(blockMints.values());
  const missingMints = tokenResolver.getMissing(fullMints);
  if (missingMints.length > 0) {
    await tokenResolver.resolve(missingMints);
  }

  // Attach resolved names and images for this block's tokens only
  blockMessage.tokenNames = tokenResolver.buildTokenNames(blockMints);
  blockMessage.tokenImages = tokenResolver.buildTokenImages(blockMints);

  lastBlockTime = now;
  broadcast(blockMessage);
});

// Start server
async function start() {
  try {
    await redisSubscriber.subscribe();
    redisConnected = true;

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
  await redisSubscriber.close();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nSIGTERM received, shutting down...');
  await redisSubscriber.close();
  server.close();
  process.exit(0);
});

start();
