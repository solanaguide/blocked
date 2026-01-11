// WebSocket worker - handles all data processing off main thread

import type { WSMessage } from '../../shared/types';

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let wsUrl: string | null = null;

// Determine WebSocket URL
function getWsUrl(): string {
  // Check for explicit WS URL in query params or global config
  // This allows the embedding page to specify: ?ws=wss://live.example.com/ws
  const params = new URLSearchParams(self.location.search);
  const explicitUrl = params.get('ws');
  if (explicitUrl) {
    return explicitUrl;
  }

  // Default: same host, /ws path (works when served from same origin)
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
      const message: WSMessage = JSON.parse(event.data);
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
