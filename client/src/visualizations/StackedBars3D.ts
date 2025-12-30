import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * StackedBars3D - Endlessly scrolling 3D stacked bar chart with fire aesthetic
 *
 * CONCEPT: Infinite horizontal scrolling bar chart showing program trading volume.
 * - Each BAR SEGMENT = a program's volume in that time slice
 * - Bars are STACKED vertically by program
 * - COLOR = Fire gradient (blue base → yellow → orange → red at top)
 * - Bars scroll LEFT continuously like a historical chart
 * - Block change = WHOOSH effect with all bars pulsing
 * - New data appears on RIGHT side, old data scrolls off LEFT
 */
export class StackedBars3D extends BaseVisualization {
  private bars: StackedBar[] = [];
  private maxBars = 60; // Show last 60 time slices
  private programData: Map<string, number> = new Map();
  private updateInterval = 500; // Sample every 500ms
  private lastUpdateTime = 0;
  private scrollSpeed = 0.15;
  private pulseIntensity = 0;

  constructor() {
    super();

    this.camera.position.set(0, 20, 50);
    this.camera.lookAt(0, 0, 0);

    // Lighting for fire aesthetic
    const ambientLight = new THREE.AmbientLight(0xff6600, 0.3);
    this.scene.add(ambientLight);

    const fireLight1 = new THREE.PointLight(0xff3300, 2, 100);
    fireLight1.position.set(0, 20, 0);
    this.scene.add(fireLight1);

    const fireLight2 = new THREE.PointLight(0xffaa00, 1.5, 80);
    fireLight2.position.set(-20, 10, 10);
    this.scene.add(fireLight2);

    // Add floor grid
    const gridHelper = new THREE.GridHelper(100, 50, 0xff6600, 0x330000);
    gridHelper.position.y = -1;
    gridHelper.material.opacity = 0.3;
    gridHelper.material.transparent = true;
    this.scene.add(gridHelper);
  }

  getName(): string {
    return 'Stacked Bars 3D';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const program = trade.p;
    const volume = trade.vu;

    // Accumulate volume per program
    this.programData.set(program, (this.programData.get(program) || 0) + volume);
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    console.log(`🔥 Block ${newSlot} complete - ${blockData.trades} trades`);

    // WHOOSH pulse effect
    this.pulseIntensity = 2.0;
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime() * 1000;

    // Sample data periodically and create new bar
    if (time - this.lastUpdateTime > this.updateInterval) {
      this.createBar();
      this.lastUpdateTime = time;
    }

    // Scroll all bars to the left
    this.bars.forEach((bar, index) => {
      bar.position.x -= this.scrollSpeed;

      // Apply pulse effect
      if (this.pulseIntensity > 0) {
        const pulseScale = 1 + this.pulseIntensity * 0.2;
        bar.segments.forEach(segment => {
          segment.mesh.scale.x = pulseScale;
          (segment.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + this.pulseIntensity * 0.3;
        });
      }

      // Remove bars that scrolled off screen
      if (bar.position.x < -50) {
        bar.segments.forEach(segment => {
          this.scene.remove(segment.mesh);
          segment.mesh.geometry.dispose();
          (segment.mesh.material as THREE.Material).dispose();
        });
        this.bars.splice(index, 1);
      }
    });

    // Decay pulse
    if (this.pulseIntensity > 0) {
      this.pulseIntensity *= 0.95;
    }

    // Subtle camera sway
    this.camera.position.y = 20 + Math.sin(time * 0.0005) * 2;
    this.camera.position.z = 50 + Math.sin(time * 0.0003) * 5;
  }

  private createBar(): void {
    if (!this.dataProcessor) return;

    // Get top programs
    const topPrograms = this.dataProcessor.getTopPrograms(10);
    const programVolumes = this.dataProcessor.getProgramVolumes();

    if (topPrograms.length === 0) return;

    // Calculate total volume and segment heights
    let totalVolume = 0;
    topPrograms.forEach(program => {
      totalVolume += programVolumes.get(program) || 0;
    });

    if (totalVolume === 0) return;

    const maxHeight = 20;
    const barWidth = 1.5;
    const barDepth = 2;

    // Position for new bar (right side)
    const x = 30;

    // Create stacked segments
    const segments: BarSegment[] = [];
    let currentY = 0;

    topPrograms.forEach((program, index) => {
      const volume = programVolumes.get(program) || 0;
      const volumeRatio = volume / totalVolume;
      const segmentHeight = volumeRatio * maxHeight;

      if (segmentHeight < 0.1) return; // Skip tiny segments

      // Fire gradient: blue (base) → yellow → orange → red (top)
      const heightRatio = (currentY + segmentHeight / 2) / maxHeight;
      let color: number;
      if (heightRatio < 0.25) {
        color = 0x0066ff; // Blue base
      } else if (heightRatio < 0.5) {
        color = 0xffaa00; // Yellow
      } else if (heightRatio < 0.75) {
        color = 0xff6600; // Orange
      } else {
        color = 0xff0000; // Red hot
      }

      const geometry = new THREE.BoxGeometry(barWidth, segmentHeight, barDepth);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.5 + heightRatio * 0.5,
        metalness: 0.3,
        roughness: 0.4,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, currentY + segmentHeight / 2, 0);

      this.scene.add(mesh);

      segments.push({
        mesh,
        program,
        height: segmentHeight,
      });

      currentY += segmentHeight;
    });

    this.bars.push({
      segments,
      position: { x, y: 0, z: 0 },
    });

    // Limit number of bars
    if (this.bars.length > this.maxBars) {
      const oldBar = this.bars.shift()!;
      oldBar.segments.forEach(segment => {
        this.scene.remove(segment.mesh);
        segment.mesh.geometry.dispose();
        (segment.mesh.material as THREE.Material).dispose();
      });
    }

    // Decay program data for smooth transitions
    this.dataProcessor.decayVolumes(0.9);
  }

  dispose(): void {
    this.bars.forEach(bar => {
      bar.segments.forEach(segment => {
        this.scene.remove(segment.mesh);
        segment.mesh.geometry.dispose();
        (segment.mesh.material as THREE.Material).dispose();
      });
    });
    this.bars = [];

    super.dispose();
  }
}

interface BarSegment {
  mesh: THREE.Mesh;
  program: string;
  height: number;
}

interface StackedBar {
  segments: BarSegment[];
  position: { x: number; y: number; z: number };
}
