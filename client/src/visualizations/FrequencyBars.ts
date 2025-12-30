import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors, colorToHex } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * FrequencyBars - Classic Winamp-style EQ visualization
 * Vertical bars for each program, height = volume, with gradient coloring
 */
export class FrequencyBars extends BaseVisualization {
  private bars: Map<string, BarMesh> = new Map();
  private programData: Map<string, { volume: number; trades: number; target: number }> = new Map();
  private gridFloor: THREE.GridHelper;
  private bloomIntensity: number = 0;

  // Known programs to show as bars
  private programs = ['JUP', 'RAYDIUM_CLMM', 'RAYDIUM_CP', 'ORCA', 'PHOENIX', 'LIFINITY', 'FLASH'];

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
    const ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.4);
    this.scene.add(ambientLight);

    // Add rim light
    const rimLight = new THREE.DirectionalLight(0xff006e, 0.8);
    rimLight.position.set(-10, 10, -10);
    this.scene.add(rimLight);

    // Create bars for each program
    this.createBars();
  }

  private createBars(): void {
    const barWidth = 3;
    const barSpacing = 5;
    const totalWidth = this.programs.length * barSpacing;
    const startX = -totalWidth / 2;

    this.programs.forEach((program, index) => {
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

      this.scene.add(mesh);

      this.bars.set(program, {
        mesh,
        baseColor: color,
        currentHeight: 0.1,
        targetHeight: 0.1,
        wireframe,
      });

      // Initialize program data
      this.programData.set(program, { volume: 0, trades: 0, target: 0.1 });
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
    console.log(`🎵 Block ${newSlot} complete - ${blockData.trades} trades, $${blockData.volume.toFixed(2)}`);

    // BASS KICK EFFECT: Trigger bloom pulse
    this.bloomIntensity = 2.0;

    // Flash the grid
    this.gridFloor.material.opacity = 0.8;

    // Reset all bars to start building for new block
    this.programData.forEach((data, program) => {
      data.volume = 0;
      data.trades = 0;
      data.target = 0.1;
    });
  }

  update(deltaTime: number): void {
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

      // Hot color based on height
      const intensity = Math.min(1, bar.currentHeight / 20);
      const hotness = intensity * 0.8;
      (bar.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + hotness;
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
    const time = this.clock.getElapsedTime();
    this.camera.position.x = Math.sin(time * 0.1) * 5;
  }

  dispose(): void {
    this.bars.forEach(bar => {
      if (bar.mesh.geometry) bar.mesh.geometry.dispose();
      if (bar.mesh.material) (bar.mesh.material as THREE.Material).dispose();
      if (bar.wireframe.geometry) bar.wireframe.geometry.dispose();
      if (bar.wireframe.material) (bar.wireframe.material as THREE.Material).dispose();
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
}
