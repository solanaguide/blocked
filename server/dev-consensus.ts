/**
 * Dev only: relay Alpenglow consensus summaries to a local browser, so the
 * client can run against the prod block feed plus real consensus data.
 *   ssh -N -L 6380:127.0.0.1:6379 forge@s.solanacompass.com
 *   ALPENGLOW_REDIS_PORT=6380 npm run dev:consensus
 */
import { WebSocketServer, WebSocket } from 'ws';
import { ConsensusFeed } from './consensus-feed.js';

const wss = new WebSocketServer({ port: 8091 });
const feed = new ConsensusFeed((m) => {
  const data = JSON.stringify(m);
  for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(data);
});
wss.on('connection', (ws) => { for (const m of feed.history()) ws.send(JSON.stringify(m)); });
feed.start();
console.log('Dev consensus relay on ws://localhost:8091');
