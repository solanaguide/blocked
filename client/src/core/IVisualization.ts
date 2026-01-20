import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData, FocusMode, ParticleShape } from '../types';
import type { DataProcessor } from '../data/DataProcessor';
import type { LegendItem } from '../hud/Legend';

/**
 * HUD configuration interface
 * Allows each visualization to declare its HUD requirements
 */
export interface IHUDConfig {
  showBlockStats?: boolean;
  showProgramLeaderboard?: boolean;
  showTokenLeaderboard?: boolean;
  showCharts?: boolean;
  customPanels?: Array<{
    id: string;
    title: string;
    position: 'left' | 'right' | 'top' | 'bottom';
  }>;
}

/**
 * Core interface that all visualizations must implement
 * Provides a contract for scene lifecycle and data handling
 */
export interface IVisualization {
  /**
   * Initialize the visualization with a container element and data processor
   */
  init(container: HTMLElement, dataProcessor: DataProcessor): void;

  /**
   * Clean up and dispose of all resources
   */
  dispose(): void;

  /**
   * Handle a new trade event
   * @param trade The trade data
   * @param slot The slot number this trade belongs to
   */
  onTrade(trade: TradeMessage, slot: number): void;

  /**
   * Handle block completion event
   * @param blockData Data about the completed block
   * @param oldSlot The slot that just finished
   * @param newSlot The new slot that is starting
   */
  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void;

  /**
   * Update loop called every frame
   * @param deltaTime Time since last frame in milliseconds
   */
  update(deltaTime: number): void;

  /**
   * Get the display name of this visualization
   */
  getName(): string;

  /**
   * Get HUD configuration for this visualization
   * Returns null if no custom HUD is needed
   */
  getHUDConfig(): IHUDConfig | null;

  /**
   * Optional: Set particle shape (if visualization supports it)
   */
  setParticleShape?(shape: ParticleShape): void;

  /**
   * Optional: Set focus mode (if visualization supports it)
   */
  setFocusMode?(mode: FocusMode): void;

  /**
   * Optional: Adjust particle size (if visualization supports it)
   */
  adjustParticleSize?(delta: number): void;

  /**
   * Optional: Handle rich block data from block:update stream
   * Used for multi-dimensional scaling based on Volume, Revenue, tx composition
   */
  onBlockData?(block: BlockMessage): void;

  /**
   * Get legend items explaining this visualization's visual language.
   * Returns array of items describing what visual elements mean.
   */
  getLegend(): LegendItem[];
}
