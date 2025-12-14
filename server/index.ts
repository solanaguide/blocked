import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { RedisSubscriber } from './redis-client.js';
import { MessageProcessor } from './message-processor.js';
import { config } from './config.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const redisSubscriber = new RedisSubscriber();
const messageProcessor = new MessageProcessor();

const clients = new Set<WebSocket>();

// Serve static files (for production)
app.use(express.static('dist/client'));

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('🔌 Client connected');
  clients.add(ws);

  ws.on('close', () => {
    console.log('🔌 Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
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

// Setup Redis subscriber
let tradeCount = 0;
redisSubscriber.onTrade((rawTrade) => {
  tradeCount++;
  const trade = messageProcessor.processRawTrade(rawTrade);
  messageProcessor.addTrade(trade);
});

// Debug: Log trade rate every 5 seconds
setInterval(() => {
  console.log(`📊 Trades received: ${tradeCount} | Clients connected: ${clients.size}`);
  tradeCount = 0;
}, 5000);

// Batch sender - sends every 50ms
let batchesSent = 0;
setInterval(() => {
  const { batch, blockComplete } = messageProcessor.getBatch();

  if (batch.batch.length > 0) {
    batchesSent++;
    console.log(`📤 Sending batch #${batchesSent}: ${batch.batch.length} trades, slot ${batch.currentSlot}`);
    broadcast(batch);
  }

  if (blockComplete) {
    console.log(`🎯 Block ${blockComplete.slot} complete: ${blockComplete.trades} trades, $${blockComplete.volume.toFixed(2)}`);
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

    server.listen(config.websocket.port, () => {
      console.log(`🚀 WebSocket server running on ws://localhost:${config.websocket.port}/ws`);
      console.log(`📊 Batching trades every ${config.websocket.batchInterval}ms`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await redisSubscriber.close();
  server.close();
  process.exit(0);
});

start();
