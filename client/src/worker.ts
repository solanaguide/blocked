// WebSocket worker - handles all data processing off main thread

import type { WSMessage, BlockMessage, TradeMessage, WireBlockMessage, WireTokenEntry, CompactTrade } from '../../shared/types';

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let wsUrl: string | null = null;

// Well-known mint → short name (must match server's shortenMint)
const KNOWN_MINTS: Record<string, string> = {
  'So11111111111111111111111111111111111111112': 'SOL',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
};

function shortenMint(mint: string): string {
  return KNOWN_MINTS[mint] || mint.slice(0, 8);
}

// Decompress wire block message into the BlockMessage format expected by all client code
function decompressBlock(wire: WireBlockMessage): BlockMessage {
  const { tokenDex, programDex, trades: compactTrades, ...blockFields } = wire;

  // Build tokenNames and tokenImages from the dex
  const tokenNames: Record<string, string> = {};
  const tokenImages: Record<string, string> = {};
  const shortMints: string[] = []; // parallel array: shortMint for each tokenDex index

  for (const entry of tokenDex) {
    const short = shortenMint(entry.m);
    shortMints.push(short);
    if (entry.s) {
      tokenNames[short] = entry.s;
      if (entry.l) {
        tokenImages[entry.s] = entry.l;
      }
    }
  }

  // Expand compact trades into full TradeMessage[]
  const trades: TradeMessage[] = compactTrades.map(ct => ({
    s: wire.slot,
    t: ct.t,
    sig: ct.sig,
    ta: shortMints[ct.ta],
    tb: shortMints[ct.tb],
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

// Determine WebSocket URL
function getWsUrl(): string {
  // Check for explicit WS URL in query params
  // This allows the embedding page to specify: ?ws=wss://live.example.com/ws
  const params = new URLSearchParams(self.location.search);
  const explicitUrl = params.get('ws');
  if (explicitUrl) {
    return explicitUrl;
  }

  // Development: connect to production WS server
  if (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1') {
    return 'wss://live.solanacompass.com/ws';
  }

  // Production: same host, /ws path
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
