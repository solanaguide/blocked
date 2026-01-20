import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors, txTypeColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';
import type { DataProcessor } from '../data/DataProcessor';

/**
 * DoubleSidedEQ - Mirror EQ bars showing TWO different metrics
 *
 * CONCEPT: Dual-metric equalizer showing trades AND volume simultaneously.
 * - Each bar = a program (top 12 programs)
 * - TOP bars = number of trades (count)
 * - BOTTOM bars = trade volume (USD)
 * - Both use LOG SCALE for better visibility of small values
 * - Color = program signature color
 * - Block change = massive pulse in both directions
 * - Lets you see which programs have high volume vs high trade count
 */
export class DoubleSidedEQ extends BaseVisualization {
  private bars: Map<string, DoubleSidedBar> = new Map();
  private programData: Map<string, { volume: number; trades: number; targetTrades: number; targetVolume: number }> = new Map();
  private centerLine: THREE.Line;
  private pulseIntensity: number = 0;
  private maxBars = 12;

  // Block metrics for visual scaling
  private blockVolume = 0;
  private blockRevenue = 0;
  private completionRate = 1.0;
  private baseEmissiveIntensity = 0.3;

  // Lighting references
  private ambientLight!: THREE.AmbientLight;

  constructor() {
    super();

    this.camera.position.set(0, 0, 50);
    this.camera.lookAt(0, 0, 0);

    // Create center line
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-40, 0, 0),
      new THREE.Vector3(40, 0, 0),
    ]);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x8b5cf6, linewidth: 3 });
    this.centerLine = new THREE.Line(lineGeometry, lineMaterial);
    this.scene.add(this.centerLine);

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.4);
    this.scene.add(this.ambientLight);
  }

  /**
   * Override init to preload from cached network state
   */
  init(container: HTMLElement, dataProcessor: DataProcessor): void {
    super.init(container, dataProcessor);
    this.preloadFromCache();
  }

  /**
   * Fetch cached network state and initialize bars immediately
   */
  private async preloadFromCache(): Promise<void> {
    try {
      const response = await fetch('/api/network-state');
      if (response.ok) {
        const state = await response.json();
        this.initializeFromCache(state);
      }
    } catch (err) {
      console.warn('DoubleSidedEQ: Could not fetch network state for preloading');
    }
  }

  /**
   * Initialize bars from cached network state
   */
  private initializeFromCache(state: {
    topPrograms: Array<{ id: string; volume: number; trades: number }>;
  }): void {
    if (!state.topPrograms || state.topPrograms.length === 0) return;

    const maxHeight = 15;

    // Initialize program data from cache
    state.topPrograms.slice(0, this.maxBars).forEach(p => {
      const tradesLog = Math.log10(Math.max(1, p.trades));
      const volumeLog = Math.log10(Math.max(1, p.volume));

      this.programData.set(p.id, {
        volume: p.volume,
        trades: p.trades,
        targetTrades: Math.min(maxHeight, 0.1 + tradesLog * 3),
        targetVolume: Math.min(maxHeight, 0.1 + volumeLog * 1.5),
      });
    });

    // Create bars immediately
    this.updateBars();

    console.log(`DoubleSidedEQ: Preloaded ${this.bars.size} bars from cache`);
  }

  getName(): string {
    return 'Double-Sided EQ';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const program = trade.p;

    if (!this.programData.has(program)) {
      this.programData.set(program, { volume: 0, trades: 0, targetTrades: 0.1, targetVolume: 0.1 });
    }

    const data = this.programData.get(program)!;
    data.volume += trade.vu;
    data.trades++;

    // Update target heights - LOG SCALE for both
    const maxHeight = 15;

    // Trades: log scale
    const tradesLog = Math.log10(Math.max(1, data.trades));
    data.targetTrades = Math.min(maxHeight, 0.1 + tradesLog * 3);

    // Volume: log scale
    const volumeLog = Math.log10(Math.max(1, data.volume));
    data.targetVolume = Math.min(maxHeight, 0.1 + volumeLog * 1.5);
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Massive pulse effect - scaled by revenue
    this.pulseIntensity = Math.min(5.0, 3.0 + this.blockRevenue * 20);

    // Reset data
    this.programData.forEach(data => {
      data.volume = 0;
      data.trades = 0;
      data.targetTrades = 0.1;
      data.targetVolume = 0.1;
    });
  }

  /**
   * Handle rich block data - scale DoubleSidedEQ by Volume/Revenue
   */
  onBlockData(block: BlockMessage): void {
    // Volume (affects bar scaling)
    this.blockVolume = block.swapVolumeUsd + block.transferVolumeUsd;

    // Revenue (affects brightness/glow)
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9;

    // Completion rate
    const nonVote = block.completed + block.reverted;
    this.completionRate = nonVote > 0 ? block.completed / nonVote : 1.0;

    // Base emissive intensity from revenue
    this.baseEmissiveIntensity = Math.min(0.8, 0.3 + this.blockRevenue * 8);

    // Ambient light intensity from revenue
    this.ambientLight.intensity = Math.min(0.8, 0.4 + this.blockRevenue * 5);

    // Ambient color shifts with completion rate
    const baseColor = new THREE.Color(0x8b5cf6);
    const amberColor = new THREE.Color(txTypeColors.reverted);
    baseColor.lerp(amberColor, (1 - this.completionRate) * 0.4);
    this.ambientLight.color.copy(baseColor);

    // Center line color shifts with completion rate
    (this.centerLine.material as THREE.LineBasicMaterial).color.copy(baseColor);
  }

  update(deltaTime: number): void {
    // Update bar layout periodically
    const time = this.clock.getElapsedTime();
    if (Math.floor(time) % 2 === 0 && Math.floor(time * 10) % 10 === 0) {
      this.updateBars();
    }

    // Update existing bars
    this.bars.forEach((bar, program) => {
      const data = this.programData.get(program);
      if (!data) return;

      // Lerp to targets separately
      bar.currentTradesHeight += (data.targetTrades - bar.currentTradesHeight) * 0.1;
      bar.currentVolumeHeight += (data.targetVolume - bar.currentVolumeHeight) * 0.1;

      // Decay
      data.targetTrades *= 0.98;
      data.targetVolume *= 0.98;

      // Update top bar (trades - grows upward)
      bar.topMesh.scale.y = bar.currentTradesHeight;
      bar.topMesh.position.y = bar.currentTradesHeight / 2;

      // Update bottom bar (volume - grows downward)
      bar.bottomMesh.scale.y = bar.currentVolumeHeight;
      bar.bottomMesh.position.y = -bar.currentVolumeHeight / 2;

      // Emissive intensity based on height + pulse + revenue
      const topIntensity = Math.min(1, bar.currentTradesHeight / 15);
      const bottomIntensity = Math.min(1, bar.currentVolumeHeight / 15);

      (bar.topMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = this.baseEmissiveIntensity + topIntensity * 0.7 + this.pulseIntensity * 0.3;
      (bar.bottomMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = this.baseEmissiveIntensity + bottomIntensity * 0.7 + this.pulseIntensity * 0.3;
    });

    // Decay pulse
    if (this.pulseIntensity > 0) {
      this.pulseIntensity *= 0.9;
    }
  }

  private updateBars(): void {
    // Get top programs
    const sorted = Array.from(this.programData.entries())
      .sort((a, b) => b[1].volume - a[1].volume)
      .slice(0, this.maxBars);

    const barWidth = 2;
    const barSpacing = 4;
    const totalWidth = sorted.length * barSpacing;
    const startX = -totalWidth / 2;

    // Create/update bars
    sorted.forEach(([program], index) => {
      const x = startX + index * barSpacing;
      const color = programColors.get(program) || 0x8b5cf6;

      if (!this.bars.has(program)) {
        this.createBar(program, x, color, barWidth);
      } else {
        // Reposition existing bar
        const bar = this.bars.get(program)!;
        bar.topMesh.position.x = x;
        bar.bottomMesh.position.x = x;
      }
    });

    // Remove bars not in top N
    const topPrograms = new Set(sorted.map(([p]) => p));
    this.bars.forEach((bar, program) => {
      if (!topPrograms.has(program)) {
        this.scene.remove(bar.topMesh);
        this.scene.remove(bar.bottomMesh);
        bar.topMesh.geometry.dispose();
        (bar.topMesh.material as THREE.Material).dispose();
        bar.bottomMesh.geometry.dispose();
        (bar.bottomMesh.material as THREE.Material).dispose();
        this.bars.delete(program);
      }
    });
  }

  private createBar(program: string, x: number, color: number, width: number): void {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.2,
    });

    // Top bar (grows upward)
    const topGeometry = new THREE.BoxGeometry(width, 0.1, width);
    const topMesh = new THREE.Mesh(topGeometry, material.clone());
    topMesh.position.set(x, 0, 0);
    this.scene.add(topMesh);

    // Bottom bar (grows downward)
    const bottomGeometry = new THREE.BoxGeometry(width, 0.1, width);
    const bottomMesh = new THREE.Mesh(bottomGeometry, material.clone());
    bottomMesh.position.set(x, 0, 0);
    this.scene.add(bottomMesh);

    this.bars.set(program, {
      topMesh,
      bottomMesh,
      currentTradesHeight: 0.1,
      currentVolumeHeight: 0.1,
    });
  }

  getLegend(): LegendItem[] {
    return [
      { label: 'Top Bars (↑)', color: 0x00CED1, description: 'Trade count (log scale)' },
      { label: 'Bottom Bars (↓)', color: 0x8b5cf6, description: 'Trade volume USD (log scale)' },
      { label: 'Bar Color', color: 0xff006e, description: 'Program identity' },
      { label: 'Center Line', color: 0x8b5cf6, description: 'Zero baseline' },
      { label: 'Pulse Effect', color: 0xffffff, description: 'Block completion' },
    ];
  }

  dispose(): void {
    this.bars.forEach(bar => {
      this.scene.remove(bar.topMesh);
      this.scene.remove(bar.bottomMesh);
      bar.topMesh.geometry.dispose();
      (bar.topMesh.material as THREE.Material).dispose();
      bar.bottomMesh.geometry.dispose();
      (bar.bottomMesh.material as THREE.Material).dispose();
    });
    this.bars.clear();

    super.dispose();
  }
}

interface DoubleSidedBar {
  topMesh: THREE.Mesh;
  bottomMesh: THREE.Mesh;
  currentTradesHeight: number;
  currentVolumeHeight: number;
}
