// WebSocket worker - handles all data processing off main thread

import type { WSMessage, BlockMessage, TradeMessage, WireBlockMessage } from '../../shared/types';

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let wsUrl: string | null = null;

// Decompress wire block message into the BlockMessage format expected by all client code
function decompressBlock(wire: WireBlockMessage): BlockMessage {
  const { tokenDex, programDex, trades: compactTrades, ...blockFields } = wire;
  const blockTimeMs = wire.blockTime * 1000;

  // Build tokenNames and tokenImages from the dex
  const tokenNames: Record<string, string> = {};
  const tokenImages: Record<string, string> = {};

  for (const entry of tokenDex) {
    if (entry.s) {
      tokenNames[entry.m] = entry.s;
      if (entry.l) {
        tokenImages[entry.s] = entry.l;
      }
    }
  }

  // Expand compact trades into full TradeMessage[]
  const trades: TradeMessage[] = compactTrades.map((ct, i) => ({
    s: wire.slot,
    t: blockTimeMs + ct.dt,
    idx: i,
    ta: tokenDex[ct.ta].m,
    tb: tokenDex[ct.tb].m,
    vu: ct.vu,
    p: programDex[ct.p],
  }));

  return {
    ...blockFields,
    trades,
    tokenNames: Object.keys(tokenNames).length > 0 ? tokenNames : undefined,
    tokenImages: Object.keys(tokenImages).length > 0 ? tokenImages : undefined,
  };
}

// WebSocket URL — baked in at build time, or derived from current host
const WS_URL = typeof __WS_URL__ === 'string' ? __WS_URL__ : null;

function getWsUrl(): string {
  if (WS_URL) return WS_URL;

  // Development: connect to production WS server
  if (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1') {
    return 'wss://live.solanacompass.com/ws';
  }

  // Default: same host
  const protocol = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${self.location.host}/ws`;
}

// Connect to WebSocket server
function connect() {
  if (!wsUrl) {
    wsUrl = getWsUrl();
  }

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    postMessage({ type: 'connected' });

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const raw = JSON.parse(event.data);

      // Detect wire format: if tokenDex exists, decompress; otherwise pass through
      let message: WSMessage;
      if (raw.type === 'block' && raw.tokenDex) {
        message = decompressBlock(raw as WireBlockMessage);
      } else {
        message = raw as WSMessage;
      }

      postMessage({
        type: 'ws_message',
        data: message,
      });
    } catch (err) {
      console.error('Worker: Failed to parse message', err);
    }
  };

  ws.onerror = (err) => {
    console.error('Worker: WebSocket error', err);
  };

  ws.onclose = () => {
    postMessage({ type: 'disconnected' });

    // Reconnect after 2 seconds
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        connect();
      }, 2000) as unknown as number;
    }
  };
}

// Start connection
connect();

// Handle messages from main thread
self.onmessage = (event) => {
  const { type, data } = event.data;

  if (type === 'ping') {
    postMessage({ type: 'pong' });
  }

  // Allow main thread to update WS URL and reconnect
  if (type === 'set_ws_url') {
    wsUrl = data;
    if (ws) {
      ws.close();
    }
  }
};
