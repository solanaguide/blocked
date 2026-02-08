import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * DataProcessor handles all data logic separated from visualization:
 * - Trade processing and forwarding
 * - Block completion detection (from block:update stream)
 * - Top programs and tokens tracking
 *
 * Block transitions are now triggered by the block:update stream,
 * not by detecting slot changes in trades.
 */
export class DataProcessor {
  private currentSlot: number = 0;

  // Top programs/tokens tracking (available immediately for visualizations)
  private programVolumes: Map<string, number> = new Map();
  private tokenVolumes: Map<string, number> = new Map();
  private maxTracked: number = 25; // Track top 25 of each

  // Block data tracking (from block:update stream)
  private currentBlock: BlockMessage | null = null;
  private previousBlock: BlockMessage | null = null;
  private blockHistory: BlockMessage[] = [];
  private maxBlockHistory: number = 60; // Keep last 60 blocks (~24 seconds)

  // Callbacks for visualization
  private onTradeCallback?: (trade: TradeMessage, slot: number) => void;
  private onBlockCompleteCallback?: (blockData: BlockData, oldSlot: number, newSlot: number) => void;
  private onBlockDataCallback?: (block: BlockMessage) => void;

  constructor() {
    // No grace period needed anymore
  }

  /**
   * Register callback for when a trade should be visualized
   */
  onTrade(callback: (trade: TradeMessage, slot: number) => void) {
    this.onTradeCallback = callback;
  }

  /**
   * Register callback for when a block is completed
   * Now triggered by block:update stream, not slot detection
   */
  onBlockComplete(callback: (blockData: BlockData, oldSlot: number, newSlot: number) => void) {
    this.onBlockCompleteCallback = callback;
  }

  /**
   * Register callback for when block data arrives
   * Provides rich block metrics for Volume & Revenue scaling
   */
  onBlockData(callback: (block: BlockMessage) => void) {
    this.onBlockDataCallback = callback;
  }

  /**
   * Process incoming block message from block:update stream
   * This is now the SOURCE OF TRUTH for block completion
   */
  processBlock(block: BlockMessage) {
    // Store previous block for transition
    this.previousBlock = this.currentBlock;
    const oldSlot = this.previousBlock?.slot || 0;

    // Reset per-block volume tracking so leaderboards show current block only
    this.programVolumes.clear();
    this.tokenVolumes.clear();

    // Update current block
    this.currentBlock = block;
    this.currentSlot = block.slot;

    // Add to history (newest first)
    this.blockHistory.unshift(block);

    // Trim history if needed
    if (this.blockHistory.length > this.maxBlockHistory) {
      this.blockHistory.pop();
    }

    // Fire block complete callback (triggers visualization sweep + new block creation)
    // Always fire, even for first block (oldSlot=0) so a forming block is ready for particles
    if (this.onBlockCompleteCallback) {
      const blockData: BlockData = {
        slot: block.slot,
        trades: block.swapCount || 0,
        volume: block.swapVolumeUsd || 0,
        timestamp: Date.now(),
        particles: [],
      };
      this.onBlockCompleteCallback(blockData, oldSlot, block.slot);
    }

    // Fire block data callback (for rich metrics)
    if (this.onBlockDataCallback) {
      this.onBlockDataCallback(block);
    }
  }

  /**
   * Get current block data
   */
  getCurrentBlock(): BlockMessage | null {
    return this.currentBlock;
  }

  /**
   * Get block history (newest first)
   */
  getBlockHistory(): BlockMessage[] {
    return this.blockHistory;
  }

  /**
   * Process incoming trade message
   * Simplified: just track volumes and forward to visualization
   */
  processTrade(trade: TradeMessage) {
    // Track program and token volumes
    this.programVolumes.set(trade.p, (this.programVolumes.get(trade.p) || 0) + trade.vu);
    // Track both token_a and token_b volumes
    if (trade.ta) {
      this.tokenVolumes.set(trade.ta, (this.tokenVolumes.get(trade.ta) || 0) + trade.vu / 2);
    }
    if (trade.tb) {
      this.tokenVolumes.set(trade.tb, (this.tokenVolumes.get(trade.tb) || 0) + trade.vu / 2);
    }

    // Update current slot from trade if we don't have block data yet
    if (this.currentSlot === 0) {
      this.currentSlot = trade.s;
    }

    // Forward trade to visualization immediately
    if (this.onTradeCallback) {
      this.onTradeCallback(trade, trade.s);
    }
  }

  /**
   * Update method to be called every frame
   * No longer needed for grace period logic, but kept for potential future use
   */
  update(deltaTime: number) {
    // No-op now that grace period is removed
  }

  /**
   * Get current slot number
   */
  getCurrentSlot(): number {
    return this.currentSlot;
  }

  /**
   * Get top N programs by volume
   */
  getTopPrograms(limit: number = this.maxTracked): string[] {
    return Array.from(this.programVolumes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([program]) => program);
  }

  /**
   * Get top N tokens by volume
   */
  getTopTokens(limit: number = this.maxTracked): string[] {
    return Array.from(this.tokenVolumes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([token]) => token);
  }

  /**
   * Get program volumes map
   */
  getProgramVolumes(): Map<string, number> {
    return this.programVolumes;
  }

  /**
   * Get token volumes map
   */
  getTokenVolumes(): Map<string, number> {
    return this.tokenVolumes;
  }

  /**
   * Decay all volumes (for smooth transitions)
   */
  decayVolumes(factor: number = 0.98) {
    this.programVolumes.forEach((volume, program) => {
      this.programVolumes.set(program, volume * factor);
    });
    this.tokenVolumes.forEach((volume, token) => {
      this.tokenVolumes.set(token, volume * factor);
    });
  }
}
