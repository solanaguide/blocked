import { TradeMessage, BatchMessage, BlockCompleteMessage, StatsMessage } from '../shared/types.js';

interface RawTrade {
  '@timestamp': string;
  slot: number;
  signature: string;
  market_id: string;
  instruction_index: number;
  inner_instruction_index?: number;
  tokens: string[];
  token_a: {
    id: string;
    amount: number;
    price_usd: number;
    price_sol: number;
    decimals: number;
  };
  token_b: {
    id: string;
    amount: number;
    price_usd: number;
    price_sol: number;
    decimals: number;
  };
  signer_id: string;
  program_id: string;
  parent_program_id?: string;
  is_inner_swap: boolean;
  is_wash_trade: boolean;
  source: string;
}

export class MessageProcessor {
  private tradeBuffer: TradeMessage[] = [];
  private currentSlot: number = 0;
  private slotStartTime: number = Date.now();

  // Current block stats (reset on each slot change)
  private blockStats = {
    trades: 0,
    volume: 0,
    tokens: new Set<string>(),
    programs: {} as Record<string, number>,
  };

  // Rolling window stats (last 60 seconds)
  private windowStats: Array<{
    timestamp: number;
    trades: number;
    volume: number;
    programs: Record<string, number>;
  }> = [];
  private windowDuration = 60000; // 60 seconds

  processRawTrade(raw: RawTrade): TradeMessage {
    // Calculate volume in USD (token_a amount * price_usd, accounting for decimals and 1e12 precision)
    const volumeUsd = (raw.token_a.amount / Math.pow(10, raw.token_a.decimals)) *
                      (raw.token_a.price_usd / 1e12);

    // Shorten program IDs for common ones
    const programShort = this.shortenProgramId(raw.program_id);

    const trade: TradeMessage = {
      s: raw.slot,
      t: new Date(raw['@timestamp']).getTime(),
      sig: raw.signature.slice(0, 8),
      ta: this.shortenMint(raw.token_a.id),
      tb: this.shortenMint(raw.token_b.id),
      aa: raw.token_a.amount.toString(),
      ab: raw.token_b.amount.toString(),
      vu: volumeUsd,
      p: programShort,
    };

    if (raw.parent_program_id) {
      trade.pp = this.shortenProgramId(raw.parent_program_id);
    }

    // Update current block stats
    this.blockStats.trades++;
    this.blockStats.volume += volumeUsd;
    this.blockStats.tokens.add(raw.token_a.id);
    this.blockStats.tokens.add(raw.token_b.id);
    this.blockStats.programs[programShort] = (this.blockStats.programs[programShort] || 0) + 1;

    // Check for slot change
    if (raw.slot !== this.currentSlot && this.currentSlot !== 0) {
      // New block detected - will be handled by getBatch
    }
    this.currentSlot = raw.slot;

    return trade;
  }

  addTrade(trade: TradeMessage) {
    this.tradeBuffer.push(trade);
  }

  getBatch(): { batch: BatchMessage; blockComplete?: BlockCompleteMessage } {
    const batch = [...this.tradeBuffer];
    this.tradeBuffer = [];

    // Calculate block progress (assuming 350ms blocks, 50ms batches = 7 batches per block)
    const timeSinceSlotStart = Date.now() - this.slotStartTime;
    const blockProgress = Math.min((timeSinceSlotStart % 350) / 350, 1);

    const batchMessage: BatchMessage = {
      type: 'trades',
      batch,
      currentSlot: this.currentSlot,
      blockProgress,
    };

    // Check if we've moved to a new slot
    let blockComplete: BlockCompleteMessage | undefined;
    if (batch.length > 0) {
      const newSlot = batch[batch.length - 1].s;
      if (newSlot !== this.currentSlot && this.currentSlot !== 0) {
        blockComplete = {
          type: 'block_complete',
          slot: this.currentSlot,
          trades: this.blockStats.trades,
          volume: this.blockStats.volume,
          timestamp: Date.now(),
        };

        // Add current block stats to rolling window
        this.windowStats.push({
          timestamp: Date.now(),
          trades: this.blockStats.trades,
          volume: this.blockStats.volume,
          programs: { ...this.blockStats.programs },
        });

        // Trim window to last 60 seconds
        const cutoff = Date.now() - this.windowDuration;
        this.windowStats = this.windowStats.filter(s => s.timestamp > cutoff);

        // Reset block stats for new block
        this.slotStartTime = Date.now();
        this.blockStats = {
          trades: 0,
          volume: 0,
          tokens: new Set(),
          programs: {},
        };
      }
    }

    return { batch: batchMessage, blockComplete };
  }

  getStats(): StatsMessage {
    // Aggregate stats from rolling window (last 60 seconds) PLUS current block
    let totalTrades = this.blockStats.trades; // Start with current block
    let totalVolume = this.blockStats.volume;
    const aggregatedPrograms: Record<string, number> = { ...this.blockStats.programs };

    // Add completed blocks from window
    for (const stat of this.windowStats) {
      totalTrades += stat.trades;
      totalVolume += stat.volume;
      for (const [program, count] of Object.entries(stat.programs)) {
        aggregatedPrograms[program] = (aggregatedPrograms[program] || 0) + count;
      }
    }

    return {
      type: 'stats',
      slot: this.currentSlot,
      blockProgress: Math.min((Date.now() - this.slotStartTime) % 350 / 350, 1),
      window: {
        trades: totalTrades,
        volume: totalVolume,
        tokens: this.blockStats.tokens, // Current block tokens
        programs: aggregatedPrograms,
      },
    };
  }

  private shortenProgramId(id: string): string {
    const map: Record<string, string> = {
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'JUP',
      'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'RAYDIUM_CLMM',
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'RAYDIUM_CP',
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'ORCA',
      'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': 'PHOENIX',
      'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG': 'RAYDIUM_CPMM',
      'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj': 'LIFINITY',
      'BSfD6SHZigAfDWSjzD5Q41jw8LmKwtmjskPH9XW1mrRW': 'PHOENIX_V1',
      'FLASHX8DrLbgeR8FcfNV1F5krxYcYMUdBkrP1EPBtxB9': 'FLASH',
      'TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH': 'TESS',
    };
    return map[id] || id.slice(0, 8);
  }

  private shortenMint(mint: string): string {
    const map: Record<string, string> = {
      'So11111111111111111111111111111111111111112': 'SOL',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
    };
    return map[mint] || mint.slice(0, 8);
  }
}
