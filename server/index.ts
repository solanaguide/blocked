import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { RedisSubscriber } from './redis-client.js';
import { config } from './config.js';
import type { BlockMessage, TradeMessage } from '../shared/types.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const redisSubscriber = new RedisSubscriber();

const clients = new Set<WebSocket>();
let redisConnected = false;
const startTime = Date.now();

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

// Shorten program IDs for common ones
function shortenProgramId(id: string): string {
  const map: Record<string, string> = {
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'JUP',
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'RAYDIUM_CLMM',
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'RAYDIUM_CP',
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'ORCA',
    'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': 'PHOENIX',
    'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG': 'RAYDIUM_CPMM',
    'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj': 'LIFINITY',
  };
  return map[id] || id.slice(0, 8);
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

  const trade: TradeMessage = {
    s: raw.slot,
    t: new Date(raw['@timestamp']).getTime(),
    sig: raw.signature.slice(0, 8),
    ta: shortenMint(raw.token_a.id),
    tb: shortenMint(raw.token_b.id),
    aa: raw.token_a.amount.toString(),
    ab: raw.token_b.amount.toString(),
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

redisSubscriber.onBlock((rawBlock) => {
  const now = Date.now();
  const blockGap = now - lastBlockTime;
  const slot = rawBlock.slot;

  // Get accumulated trades for this slot
  const trades = tradesPerSlot.get(slot) || [];
  const blockMessage = transformBlockData(rawBlock, trades);

  // Diagnostic log
  console.log(`BLOCK ${slot} | gap: ${blockGap}ms | trades: ${trades.length}/${rawBlock.swap_count}`);

  // Clean up old slots (keep last 10)
  if (tradesPerSlot.size > 20) {
    const slots = Array.from(tradesPerSlot.keys()).sort((a, b) => a - b);
    for (let i = 0; i < slots.length - 10; i++) {
      tradesPerSlot.delete(slots[i]);
    }
  }

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
