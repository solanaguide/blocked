import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

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
    const ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.4);
    this.scene.add(ambientLight);
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
    // Massive pulse effect
    this.pulseIntensity = 3.0;

    // Reset data
    this.programData.forEach(data => {
      data.volume = 0;
      data.trades = 0;
      data.targetTrades = 0.1;
      data.targetVolume = 0.1;
    });
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

      // Emissive intensity based on height + pulse
      const topIntensity = Math.min(1, bar.currentTradesHeight / 15);
      const bottomIntensity = Math.min(1, bar.currentVolumeHeight / 15);

      (bar.topMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + topIntensity * 0.7 + this.pulseIntensity * 0.3;
      (bar.bottomMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + bottomIntensity * 0.7 + this.pulseIntensity * 0.3;
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
