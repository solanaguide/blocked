import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors, colorToHex, txTypeColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';
import type { DataProcessor } from '../data/DataProcessor';

/**
 * FrequencyBars - Classic Winamp-style EQ visualization
 *
 * CONCEPT: Vertical bars representing top trading programs (like Winamp equalizer).
 * - Each bar = a program (Jupiter, Raydium, Orca, etc.)
 * - Bar HEIGHT = trade volume for that program (logarithmic scale)
 * - Bar COLOR = program's signature color with emissive glow
 * - Block change triggers bloom pulse and grid flash (bass kick effect)
 * - Shows top 10 programs dynamically (updates as trading patterns change)
 */
export class FrequencyBars extends BaseVisualization {
  private bars: Map<string, BarMesh> = new Map();
  private programData: Map<string, { volume: number; trades: number; target: number }> = new Map();
  private gridFloor: THREE.GridHelper;
  private bloomIntensity: number = 0;
  private maxBars = 10; // Show top 10 programs dynamically

  // Block metrics for visual scaling
  private blockVolume = 0;
  private blockRevenue = 0;
  private completionRate = 1.0;
  private baseEmissiveIntensity = 0.5;

  // Lighting references
  private ambientLight!: THREE.AmbientLight;
  private rimLight!: THREE.DirectionalLight;


  constructor() {
    super();

    // Position camera for better view
    this.camera.position.set(0, 15, 40);
    this.camera.lookAt(0, 5, 0);

    // Add synthwave grid floor
    this.gridFloor = new THREE.GridHelper(100, 50, 0x8b5cf6, 0x8b5cf6);
    this.gridFloor.position.y = -1;
    this.gridFloor.material.opacity = 0.3;
    this.gridFloor.material.transparent = true;
    this.scene.add(this.gridFloor);

    // Add purple ambient light
    this.ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.4);
    this.scene.add(this.ambientLight);

    // Add rim light
    this.rimLight = new THREE.DirectionalLight(0xff006e, 0.8);
    this.rimLight.position.set(-10, 10, -10);
    this.scene.add(this.rimLight);

    // Bars are created dynamically as programs appear
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
      console.warn('FrequencyBars: Could not fetch network state for preloading');
    }
  }

  /**
   * Initialize bars from cached network state
   */
  private initializeFromCache(state: {
    topPrograms: Array<{ id: string; volume: number; trades: number }>;
  }): void {
    if (!state.topPrograms || state.topPrograms.length === 0) return;

    // Initialize program data from cache
    state.topPrograms.slice(0, this.maxBars).forEach(p => {
      const maxHeight = 20;
      const volumeLog = Math.log10(Math.max(1, p.volume));
      const target = Math.min(maxHeight, 0.1 + volumeLog * 2);

      this.programData.set(p.id, {
        volume: p.volume,
        trades: p.trades,
        target: target,
      });
    });

    // Create bars immediately
    this.repositionBars();

    console.log(`FrequencyBars: Preloaded ${this.bars.size} bars from cache`);
  }

  private createOrUpdateBar(program: string, index: number, totalBars: number): void {
    if (this.bars.has(program)) return; // Bar already exists

    const barWidth = 3;
    const barSpacing = 5;
    const totalWidth = totalBars * barSpacing;
    const startX = -totalWidth / 2;
    const x = startX + index * barSpacing;
    const color = programColors.get(program) || 0x8b5cf6;

    // Create bar geometry (starts at height 0.1)
    const geometry = new THREE.BoxGeometry(barWidth, 0.1, barWidth);

    // Create gradient material
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.2,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0, 0);

    // Add edges for that retro look
    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
    const wireframe = new THREE.LineSegments(edges, lineMaterial);
    mesh.add(wireframe);

    // Add program label below the bar (use ID directly)
    const label = this.createTextSprite(program, color);
    label.position.set(x, -2.5, 0);
    label.scale.set(5, 1.5, 1);
    this.scene.add(label);

    this.scene.add(mesh);

    this.bars.set(program, {
      mesh,
      baseColor: color,
      currentHeight: 0.1,
      targetHeight: 0.1,
      wireframe,
      program,
      label,
    });
  }

  /**
   * Create a text sprite label
   */
  private createTextSprite(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = 'bold 24px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const hexColor = '#' + color.toString(16).padStart(6, '0');

    // Text shadow for visibility
    context.shadowColor = 'rgba(0, 0, 0, 0.8)';
    context.shadowBlur = 4;
    context.shadowOffsetX = 2;
    context.shadowOffsetY = 2;

    context.fillStyle = hexColor;
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    return new THREE.Sprite(material);
  }

  private repositionBars(): void {
    // Sort programs by volume to get top N
    const sorted = Array.from(this.programData.entries())
      .sort((a, b) => b[1].volume - a[1].volume)
      .slice(0, this.maxBars);

    const barWidth = 3;
    const barSpacing = 5;
    const totalWidth = sorted.length * barSpacing;
    const startX = -totalWidth / 2;

    // Reposition existing bars and create new ones
    sorted.forEach(([program, data], index) => {
      const x = startX + index * barSpacing;
      this.createOrUpdateBar(program, index, sorted.length);

      const bar = this.bars.get(program)!;
      bar.mesh.position.x = x;
      // Also reposition the label
      if (bar.label) {
        bar.label.position.x = x;
      }
    });

    // Remove bars not in top N
    const topPrograms = new Set(sorted.map(([p]) => p));
    this.bars.forEach((bar, program) => {
      if (!topPrograms.has(program)) {
        this.scene.remove(bar.mesh);
        bar.mesh.geometry.dispose();
        (bar.mesh.material as THREE.Material).dispose();
        bar.wireframe.geometry.dispose();
        (bar.wireframe.material as THREE.Material).dispose();
        // Dispose label
        if (bar.label) {
          this.scene.remove(bar.label);
          (bar.label.material as THREE.SpriteMaterial).map?.dispose();
          (bar.label.material as THREE.SpriteMaterial).dispose();
        }
        this.bars.delete(program);
      }
    });
  }

  getName(): string {
    return 'Frequency Bars';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const program = trade.p;

    if (!this.programData.has(program)) {
      this.programData.set(program, { volume: 0, trades: 0, target: 0.1 });
    }

    const data = this.programData.get(program)!;
    data.volume += trade.vu;
    data.trades++;

    // Update target height based on volume (logarithmic scale)
    const maxHeight = 20;
    const volumeLog = Math.log10(Math.max(1, data.volume));
    data.target = Math.min(maxHeight, 0.1 + volumeLog * 2);

    if (this.bars.has(program)) {
      const bar = this.bars.get(program)!;
      // Instant spike for visual feedback
      bar.currentHeight = Math.max(bar.currentHeight, data.target * 0.7);
    }
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // BASS KICK EFFECT: Trigger bloom pulse - scaled by revenue
    this.bloomIntensity = Math.min(3.0, 2.0 + this.blockRevenue * 15);

    // Flash the grid
    this.gridFloor.material.opacity = 0.8;

    // Reset all bars to start building for new block
    this.programData.forEach((data, program) => {
      data.volume = 0;
      data.trades = 0;
      data.target = 0.1;
    });
  }

  /**
   * Handle rich block data - scale FrequencyBars by Volume/Revenue
   */
  onBlockData(block: BlockMessage): void {
    // Volume (affects bar target scaling)
    this.blockVolume = block.swapVolumeUsd + block.transferVolumeUsd;

    // Revenue (affects brightness/glow)
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9;

    // Completion rate
    const nonVote = block.completed + block.reverted;
    this.completionRate = nonVote > 0 ? block.completed / nonVote : 1.0;

    // Base emissive intensity from revenue (brighter = more fees paid)
    this.baseEmissiveIntensity = Math.min(1.2, 0.5 + this.blockRevenue * 10);

    // Ambient light intensity from revenue
    this.ambientLight.intensity = Math.min(0.8, 0.4 + this.blockRevenue * 5);

    // Rim light color shifts with completion rate
    // High completion = pink, low completion = amber
    const baseColor = new THREE.Color(0xff006e);
    const amberColor = new THREE.Color(txTypeColors.reverted);
    baseColor.lerp(amberColor, (1 - this.completionRate) * 0.5);
    this.rimLight.color.copy(baseColor);

    // Rim light intensity from revenue
    this.rimLight.intensity = Math.min(1.5, 0.8 + this.blockRevenue * 8);

    // Grid color shifts with completion rate
    const gridColor = new THREE.Color(0x8b5cf6);
    gridColor.lerp(amberColor, (1 - this.completionRate) * 0.3);
    (this.gridFloor.material as THREE.LineBasicMaterial).color.copy(gridColor);
  }

  update(deltaTime: number): void {
    // Periodically reposition bars based on top programs
    const time = this.clock.getElapsedTime();
    if (Math.floor(time) % 2 === 0 && Math.floor(time * 10) % 10 === 0) {
      this.repositionBars();
    }

    // Smooth bar height transitions
    this.bars.forEach((bar, program) => {
      const data = this.programData.get(program);
      if (!data) return;

      // Lerp current height to target
      const lerpSpeed = 0.1;
      bar.currentHeight += (data.target - bar.currentHeight) * lerpSpeed;

      // Also add decay for smooth fall-off
      data.target *= 0.98;

      // Update mesh scale
      bar.mesh.scale.y = bar.currentHeight;
      bar.mesh.position.y = bar.currentHeight / 2;

      // Update wireframe
      bar.wireframe.scale.copy(bar.mesh.scale);

      // Hot color based on height and revenue
      const intensity = Math.min(1, bar.currentHeight / 20);
      const hotness = intensity * 0.8;
      (bar.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = this.baseEmissiveIntensity + hotness;
    });

    // Decay bloom effect
    if (this.bloomIntensity > 0) {
      this.bloomIntensity *= 0.92;

      // Apply bloom to bars
      this.bars.forEach(bar => {
        (bar.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity += this.bloomIntensity * 0.5;
      });
    }

    // Decay grid flash
    if (this.gridFloor.material.opacity > 0.3) {
      this.gridFloor.material.opacity *= 0.95;
    }

    // Rotate camera slightly for dynamic view
    this.camera.position.x = Math.sin(time * 0.1) * 5;
  }

  getLegend(): LegendItem[] {
    return [
      { label: 'Bar Height', color: 0x00CED1, description: 'Program trade volume (log scale)' },
      { label: 'Bar Color', color: 0x8b5cf6, description: 'Program identity' },
      { label: 'Glow', color: 0xff006e, description: 'Block revenue (brighter = more fees)' },
      { label: 'Bass Kick', color: 0xffffff, description: 'New block arrival' },
    ];
  }

  dispose(): void {
    this.bars.forEach(bar => {
      if (bar.mesh.geometry) bar.mesh.geometry.dispose();
      if (bar.mesh.material) (bar.mesh.material as THREE.Material).dispose();
      if (bar.wireframe.geometry) bar.wireframe.geometry.dispose();
      if (bar.wireframe.material) (bar.wireframe.material as THREE.Material).dispose();
      // Dispose label
      if (bar.label) {
        this.scene.remove(bar.label);
        (bar.label.material as THREE.SpriteMaterial).map?.dispose();
        (bar.label.material as THREE.SpriteMaterial).dispose();
      }
    });
    this.bars.clear();
    this.programData.clear();

    super.dispose();
  }
}

interface BarMesh {
  mesh: THREE.Mesh;
  wireframe: THREE.LineSegments;
  baseColor: number;
  currentHeight: number;
  targetHeight: number;
  program: string;
  label?: THREE.Sprite;
}
