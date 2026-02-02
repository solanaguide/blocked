import { IVisualization } from './IVisualization';
import { DataProcessor } from '../data/DataProcessor';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * SceneManager handles registration and hot-swapping of visualizations
 * Ensures smooth transitions without data loss
 */
export class SceneManager {
  private scenes: Map<string, () => IVisualization> = new Map();
  private activeScene: IVisualization | null = null;
  private activeSceneName: string | null = null;
  private container: HTMLElement;
  private dataProcessor: DataProcessor;

  // Animation loop
  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;

  // Auto-cycle settings
  private autoCycle: boolean = false;
  private autoCycleInterval: number = 30000; // 30 seconds
  private autoCycleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement, dataProcessor: DataProcessor) {
    this.container = container;
    this.dataProcessor = dataProcessor;

    // Start animation loop
    this.startAnimationLoop();

    // Setup DataProcessor callbacks
    this.dataProcessor.onTrade((trade, slot) => {
      if (this.activeScene) {
        this.activeScene.onTrade(trade, slot);
      }
    });

    // Block completion is now triggered by block:update stream
    this.dataProcessor.onBlockComplete((blockData, oldSlot, newSlot) => {
      if (this.activeScene) {
        this.activeScene.onBlockComplete(blockData, oldSlot, newSlot);
      }
    });

    // Hook for rich block data from block:update stream
    this.dataProcessor.onBlockData((block: BlockMessage) => {
      if (this.activeScene && this.activeScene.onBlockData) {
        this.activeScene.onBlockData(block);
      }
    });
  }

  /**
   * Register a new visualization scene
   * @param name Unique identifier for the scene
   * @param factory Function that creates a new instance of the visualization
   */
  registerScene(name: string, factory: () => IVisualization): void {
    this.scenes.set(name, factory);
  }

  /**
   * Switch to a different visualization
   * @param name Name of the registered scene
   */
  switchScene(name: string): boolean {
    if (!this.scenes.has(name)) {
      console.error(`❌ Scene "${name}" not found`);
      return false;
    }

    // Don't switch if already active
    if (this.activeSceneName === name) {
      return true;
    }

    // Dispose old scene
    if (this.activeScene) {
      this.activeScene.dispose();
      this.activeScene = null;
    }

    // Create and initialize new scene
    const factory = this.scenes.get(name)!;
    this.activeScene = factory();
    this.activeScene.init(this.container, this.dataProcessor);

    this.activeSceneName = name;

    // Reset auto-cycle timer
    if (this.autoCycle) {
      this.resetAutoCycleTimer();
    }

    return true;
  }

  /**
   * Get the currently active scene
   */
  getActiveScene(): IVisualization | null {
    return this.activeScene;
  }

  /**
   * Get the name of the currently active scene
   */
  getActiveSceneName(): string | null {
    return this.activeSceneName;
  }

  /**
   * Get the DataProcessor instance
   */
  getDataProcessor(): DataProcessor {
    return this.dataProcessor;
  }

  /**
   * Get list of all registered scene names
   */
  getSceneNames(): string[] {
    return Array.from(this.scenes.keys());
  }

  /**
   * Switch to the next scene in the registry
   */
  nextScene(): void {
    const names = this.getSceneNames();
    if (names.length === 0) return;

    const currentIndex = this.activeSceneName ? names.indexOf(this.activeSceneName) : -1;
    const nextIndex = (currentIndex + 1) % names.length;
    this.switchScene(names[nextIndex]);
  }

  /**
   * Switch to the previous scene in the registry
   */
  previousScene(): void {
    const names = this.getSceneNames();
    if (names.length === 0) return;

    const currentIndex = this.activeSceneName ? names.indexOf(this.activeSceneName) : -1;
    const prevIndex = currentIndex <= 0 ? names.length - 1 : currentIndex - 1;
    this.switchScene(names[prevIndex]);
  }

  /**
   * Enable or disable auto-cycling through scenes
   */
  setAutoCycle(enabled: boolean, intervalMs: number = 30000): void {
    this.autoCycle = enabled;
    this.autoCycleInterval = intervalMs;

    if (enabled) {
      this.resetAutoCycleTimer();
    } else {
      if (this.autoCycleTimer) {
        clearTimeout(this.autoCycleTimer);
        this.autoCycleTimer = null;
      }
    }
  }

  /**
   * Reset the auto-cycle timer
   */
  private resetAutoCycleTimer(): void {
    if (this.autoCycleTimer) {
      clearTimeout(this.autoCycleTimer);
    }

    if (this.autoCycle) {
      this.autoCycleTimer = setTimeout(() => {
        this.nextScene();
      }, this.autoCycleInterval);
    }
  }

  /**
   * Start the animation loop
   */
  private startAnimationLoop(): void {
    this.lastFrameTime = performance.now();
    this.animate();
  }

  /**
   * Main animation loop
   */
  private animate(): void {
    this.animationFrameId = requestAnimationFrame(this.animate.bind(this));

    const now = performance.now();
    let deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;

    // CAP deltaTime to prevent huge jumps when tab becomes active
    const MAX_DELTA = 100; // Cap at 100ms (~10fps minimum)
    if (deltaTime > MAX_DELTA) {
      deltaTime = MAX_DELTA;
    }

    // Update DataProcessor (handles grace period logic)
    this.dataProcessor.update(deltaTime);

    // Update active scene
    if (this.activeScene) {
      this.activeScene.update(deltaTime);

      // Render the scene (if it has a render method)
      if ('render' in this.activeScene && typeof (this.activeScene as any).render === 'function') {
        (this.activeScene as any).render();
      }
    }
  }

  /**
   * Set camera Y offset for responsive layouts
   * @param offsetY Vertical offset (positive = camera looks higher)
   */
  setCameraOffset(offsetY: number): void {
    if (this.activeScene?.setCameraOffset) {
      this.activeScene.setCameraOffset(offsetY);
    }
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    // Stop animation loop
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.autoCycleTimer) {
      clearTimeout(this.autoCycleTimer);
      this.autoCycleTimer = null;
    }

    if (this.activeScene) {
      this.activeScene.dispose();
      this.activeScene = null;
    }

    this.scenes.clear();
  }
}
