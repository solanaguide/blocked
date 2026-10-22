// Environment-based configuration for production deployment
export const config = {
  // Current max compute units per block; changes with network upgrades
  blockCuLimit: parseInt(process.env.BLOCK_CU_LIMIT || '60000000', 10),
  // Alpenglow stage events from validatormetrics' fd:monitor-all (Laravel-prefixed channel)
  alpenglow: {
    host: process.env.ALPENGLOW_REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.ALPENGLOW_REDIS_PORT || '6379', 10),
    channel: process.env.ALPENGLOW_CHANNEL || 'solana_compass_database_fd:alpenglow',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    channels: {
      tradeExecuted: 'trade:executed',
      priceUpdate: 'price:update',
      blockUpdate: 'block:update',
    },
  },
  websocket: {
    port: parseInt(process.env.WS_PORT || '3847', 10),
    batchInterval: parseInt(process.env.BATCH_INTERVAL || '50', 10),
  },
  cors: {
    // Comma-separated list of allowed origins, or '*' for all
    origins: process.env.CORS_ORIGINS || '*',
  },
};
