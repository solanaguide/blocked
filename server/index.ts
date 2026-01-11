import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { RedisSubscriber } from './redis-client.js';
import { MessageProcessor } from './message-processor.js';
import { config } from './config.js';
import type { BlockMessage } from '../shared/types.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const redisSubscriber = new RedisSubscriber();
const messageProcessor = new MessageProcessor();

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

// Setup Redis subscriber - timing diagnostics
let lastBlockTime = Date.now();
let lastBlockSlot = 0;
const tradesPerSlot: Map<number, number> = new Map();

redisSubscriber.onTrade((rawTrade) => {
  const slot = rawTrade.slot;
  tradesPerSlot.set(slot, (tradesPerSlot.get(slot) || 0) + 1);
  const trade = messageProcessor.processRawTrade(rawTrade);
  messageProcessor.addTrade(trade);
});

// Transform raw Redis block data into BlockMessage format
function transformBlockData(raw: any): BlockMessage {
  return {
    type: 'block',

    // Core block info
    slot: raw.slot,
    parentSlot: raw.parent_slot,
    blockhash: raw.blockhash,
    blockTime: raw.block_time,
    epoch: raw.epoch,
    leader: raw.leader,

    // Transaction counts (rename success/failed to completed/reverted)
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

    // Swaps - convert from micro-USD (divide by 1e12) to USD
    swapTxns: raw.swap_txns,
    swapCount: raw.swap_count,
    swapVolumeUsd: raw.swap_volume_usd / 1e12,
    uniqueTraders: raw.unique_traders,
    uniquePools: raw.unique_pools,
    uniqueTokens: raw.unique_tokens,

    // Transfers - convert from micro-USD to USD
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

redisSubscriber.onBlock((rawBlock) => {
  const now = Date.now();
  const blockGap = now - lastBlockTime;
  const slot = rawBlock.slot;
  const tradesReceived = tradesPerSlot.get(slot) || 0;
  const blockMessage = transformBlockData(rawBlock);

  // Diagnostic: block timing and trade alignment
  console.log(`BLOCK ${slot} | gap: ${blockGap}ms | trades: ${tradesReceived}/${rawBlock.swap_count} | delta: ${tradesReceived - rawBlock.swap_count}`);

  // Clean up old slots (keep last 10)
  if (tradesPerSlot.size > 20) {
    const slots = Array.from(tradesPerSlot.keys()).sort((a, b) => a - b);
    for (let i = 0; i < slots.length - 10; i++) {
      tradesPerSlot.delete(slots[i]);
    }
  }

  lastBlockTime = now;
  lastBlockSlot = slot;
  broadcast(blockMessage);
});

// Batch sender - sends every N ms
setInterval(() => {
  const { batch, blockComplete } = messageProcessor.getBatch();

  if (batch.batch.length > 0) {
    broadcast(batch);
  }

  if (blockComplete) {
    broadcast(blockComplete);
  }
}, config.websocket.batchInterval);

// Stats sender - sends every 1s
setInterval(() => {
  const stats = messageProcessor.getStats();
  broadcast(stats);
}, 1000);

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
