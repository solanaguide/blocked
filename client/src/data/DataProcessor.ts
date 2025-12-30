import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * DataProcessor handles all data logic separated from visualization:
 * - Slot detection and tracking
 * - Grace period management
 * - Trade buffering
 * - Block completion detection
 * - Top programs and tokens tracking
 *
 * This allows visualizations to focus purely on rendering without
 * worrying about data timing and state management.
 */
export class DataProcessor {
  private currentSlot: number = 0;
  private slotChangeTime: number = 0;
  private gracePeriodMs: number = 50; // Buffer new slot particles before sweeping old block
  private inGracePeriod: boolean = false;
  private pendingSlot: number = 0;
  private tradeBuffer: TradeMessage[] = [];

  // Top programs/tokens tracking (available immediately for visualizations)
  private programVolumes: Map<string, number> = new Map();
  private tokenVolumes: Map<string, number> = new Map();
  private maxTracked: number = 25; // Track top 25 of each

  // Callbacks for visualization
  private onTradeCallback?: (trade: TradeMessage, slot: number) => void;
  private onBlockCompleteCallback?: (blockData: BlockData, oldSlot: number, newSlot: number) => void;
  private onGracePeriodEndCallback?: (oldSlot: number, newSlot: number, bufferedTrades: TradeMessage[]) => void;

  constructor(gracePeriodMs: number = 50) {
    this.gracePeriodMs = gracePeriodMs;
  }

  /**
   * Register callback for when a trade should be visualized
   */
  onTrade(callback: (trade: TradeMessage, slot: number) => void) {
    this.onTradeCallback = callback;
  }

  /**
   * Register callback for when a block is completed
   */
  onBlockComplete(callback: (blockData: BlockData, oldSlot: number, newSlot: number) => void) {
    this.onBlockCompleteCallback = callback;
  }

  /**
   * Register callback for when grace period ends
   * Provides: oldSlot, newSlot, and array of buffered trades to spawn
   */
  onGracePeriodEnd(callback: (oldSlot: number, newSlot: number, bufferedTrades: TradeMessage[]) => void) {
    this.onGracePeriodEndCallback = callback;
  }

  /**
   * Process incoming trade message
   */
  processTrade(trade: TradeMessage) {
    const now = Date.now();

    // Track program and token volumes
    this.programVolumes.set(trade.p, (this.programVolumes.get(trade.p) || 0) + trade.vu);
    // Track both token_a and token_b volumes
    if (trade.ta) {
      this.tokenVolumes.set(trade.ta, (this.tokenVolumes.get(trade.ta) || 0) + trade.vu / 2);
    }
    if (trade.tb) {
      this.tokenVolumes.set(trade.tb, (this.tokenVolumes.get(trade.tb) || 0) + trade.vu / 2);
    }

    // FIRST TRADE EVER: Initialize current slot
    if (this.currentSlot === 0) {
      console.log(`🎬 First trade! Initializing slot ${trade.s}`);
      this.currentSlot = trade.s;
      this.slotChangeTime = now;

      // Spawn first trade immediately
      if (this.onTradeCallback) {
        this.onTradeCallback(trade, trade.s);
      }
      return;
    }

    // Check for slot change
    if (trade.s !== this.currentSlot && !this.inGracePeriod) {
      // New slot detected! Start grace period
      console.log(`🔄 Slot change detected: ${this.currentSlot} → ${trade.s}, starting ${this.gracePeriodMs}ms grace period`);

      this.inGracePeriod = true;
      this.pendingSlot = trade.s;
      this.slotChangeTime = now;

      // Buffer this trade instead of spawning it
      this.tradeBuffer.push(trade);
      return;
    }

    // During grace period: buffer new slot trades, spawn old slot trades
    if (this.inGracePeriod) {
      if (trade.s === this.pendingSlot) {
        // Buffer new slot trades
        this.tradeBuffer.push(trade);
      } else if (trade.s === this.currentSlot) {
        // Spawn old slot trades immediately (stragglers)
        if (this.onTradeCallback) {
          this.onTradeCallback(trade, trade.s);
        }
      }
      return;
    }

    // Normal operation: spawn particle immediately
    if (this.onTradeCallback) {
      this.onTradeCallback(trade, trade.s);
    }
  }

  /**
   * Update method to be called every frame
   * Handles grace period expiration
   */
  update(deltaTime: number) {
    // Check if grace period expired
    const now = Date.now();
    if (this.inGracePeriod && (now - this.slotChangeTime) >= this.gracePeriodMs) {
      console.log(`⏱️ Grace period ended, transitioning ${this.currentSlot} → ${this.pendingSlot}, spawning ${this.tradeBuffer.length} buffered trades`);

      const oldSlot = this.currentSlot;
      const newSlot = this.pendingSlot;
      const bufferedTrades = [...this.tradeBuffer]; // Copy for callback

      // Notify about grace period end
      if (this.onGracePeriodEndCallback) {
        this.onGracePeriodEndCallback(oldSlot, newSlot, bufferedTrades);
      }

      // Clear buffer and update state
      this.tradeBuffer = [];
      this.currentSlot = this.pendingSlot;
      this.inGracePeriod = false;
    }
  }

  /**
   * Get current slot number
   */
  getCurrentSlot(): number {
    return this.currentSlot;
  }

  /**
   * Get pending slot number (if in grace period)
   */
  getPendingSlot(): number {
    return this.pendingSlot;
  }

  /**
   * Check if currently in grace period
   */
  isInGracePeriod(): boolean {
    return this.inGracePeriod;
  }

  /**
   * Get number of buffered trades
   */
  getBufferedTradeCount(): number {
    return this.tradeBuffer.length;
  }

  /**
   * Set grace period duration
   */
  setGracePeriod(ms: number) {
    this.gracePeriodMs = ms;
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
