// WebSocket worker - handles all data processing off main thread

import type { WSMessage, TradeMessage, BatchMessage, BlockCompleteMessage } from '../../shared/types';

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;

// Connect to WebSocket server
function connect() {
  const protocol = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${self.location.hostname}:8080/ws`;

  console.log('Worker: Connecting to', wsUrl);

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Worker: Connected to WebSocket');
    postMessage({ type: 'connected' });

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const message: WSMessage = JSON.parse(event.data);

      // Forward all messages to main thread
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
    console.log('Worker: Disconnected from WebSocket');
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
  const { type } = event.data;

  if (type === 'ping') {
    postMessage({ type: 'pong' });
  }
};
