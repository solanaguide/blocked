export const config = {
  redis: {
    host: 'localhost',
    port: 16379,
    channels: {
      tradeExecuted: 'trade:executed',
      priceUpdate: 'price:update',
    },
  },
  websocket: {
    port: 8080,
    batchInterval: 50, // 50ms batching for 350ms blocks (7 batches per block)
  },
  server: {
    port: 3001,
  },
};
