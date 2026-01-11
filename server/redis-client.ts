import Redis from 'ioredis';
import { config } from './config.js';

export class RedisSubscriber {
  private subscriber: Redis;
  private onTradeCallback?: (trade: any) => void;
  private onBlockCallback?: (block: any) => void;

  constructor() {
    this.subscriber = new Redis({
      host: config.redis.host,
      port: config.redis.port,
    });

    this.subscriber.on('error', (err) => {
      console.error('Redis subscriber error:', err);
    });

    this.subscriber.on('connect', () => {
      console.log(`✅ Connected to Redis at ${config.redis.host}:${config.redis.port}`);
    });
  }

  async subscribe() {
    await this.subscriber.subscribe(
      config.redis.channels.tradeExecuted,
      config.redis.channels.blockUpdate
    );
    console.log(`📡 Subscribed to ${config.redis.channels.tradeExecuted}`);
    console.log(`📡 Subscribed to ${config.redis.channels.blockUpdate}`);

    this.subscriber.on('message', (channel, message) => {
      if (channel === config.redis.channels.tradeExecuted) {
        try {
          const trade = JSON.parse(message);
          this.onTradeCallback?.(trade);
        } catch (err) {
          console.error('Failed to parse trade message:', err);
        }
      } else if (channel === config.redis.channels.blockUpdate) {
        try {
          const block = JSON.parse(message);
          this.onBlockCallback?.(block);
        } catch (err) {
          console.error('Failed to parse block message:', err);
        }
      }
    });
  }

  onTrade(callback: (trade: any) => void) {
    this.onTradeCallback = callback;
  }

  onBlock(callback: (block: any) => void) {
    this.onBlockCallback = callback;
  }

  async close() {
    await this.subscriber.quit();
  }
}
