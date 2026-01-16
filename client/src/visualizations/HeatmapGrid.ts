import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors, tokenColors, hashColor, volumeHeatmap, txTypeColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * HeatmapGrid - 3D matrix showing program × token trading volume
 *
 * CONCEPT: Each cell on the grid represents a program-token pair (e.g. "Jupiter-SOL").
 * - Cell HEIGHT = trade volume for that pair (logarithmic scale)
 * - Cell COLOR = volume heatmap (blue=low → purple → pink → red=high)
 * - Rows = Programs (JUP, RAYDIUM, ORCA, etc.)
 * - Columns = Tokens (SOL, USDC, USDT)
 * - Block change triggers wave ripple across grid
 * - Cells decay over time showing real-time activity
 */
export class HeatmapGrid extends BaseVisualization {
  private cells: Map<string, GridCell> = new Map();
  private gridFloor: THREE.GridHelper;
  private programs = ['JUP', 'RAYDIUM_CLMM', 'RAYDIUM_CP', 'ORCA', 'PHOENIX', 'LIFINITY', 'FLASH'];
  private tokens = ['SOL', 'USDC', 'USDT'];
  private rippleWave: number = 0;
  private rippleOrigin: { x: number; z: number } | null = null;
  private cameraAngle: number = 0;

  // Block metrics for visual scaling
  private blockVolume = 0;
  private blockRevenue = 0;
  private completionRate = 1.0;
  private baseEmissiveIntensity = 0.3;

  // Lighting references
  private ambientLight!: THREE.AmbientLight;
  private spotLight!: THREE.SpotLight;

  constructor() {
    super();

    this.camera.position.set(30, 40, 30);
    this.camera.lookAt(0, 0, 0);

    // Create synthwave grid floor
    this.gridFloor = new THREE.GridHelper(60, 30, 0x8b5cf6, 0xff006e);
    this.gridFloor.position.y = -1;
    this.gridFloor.material.opacity = 0.5;
    this.gridFloor.material.transparent = true;
    this.scene.add(this.gridFloor);

    // Create cells
    const cellSpacing = 4;
    const gridWidth = this.programs.length * cellSpacing;
    const gridDepth = this.tokens.length * cellSpacing;
    const startX = -gridWidth / 2;
    const startZ = -gridDepth / 2;

    this.programs.forEach((program, i) => {
      this.tokens.forEach((token, j) => {
        const x = startX + i * cellSpacing;
        const z = startZ + j * cellSpacing;

        const geometry = new THREE.BoxGeometry(3, 0.1, 3);
        // Start with default low-volume color (will update based on activity)
        const material = new THREE.MeshStandardMaterial({
          color: 0x0044ff, // Start blue (low volume)
          emissive: 0x0044ff,
          emissiveIntensity: 0.3,
          metalness: 0.8,
          roughness: 0.2,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, 0, z);

        // Add edges
        const edges = new THREE.EdgesGeometry(geometry);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
        const wireframe = new THREE.LineSegments(edges, lineMaterial);
        mesh.add(wireframe);

        this.scene.add(mesh);

        this.cells.set(`${program}-${token}`, {
          mesh,
          program,
          token,
          volume: 0,
          trades: 0,
          targetHeight: 0.1,
          currentHeight: 0.1,
          x,
          z,
        });
      });
    });

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.3);
    this.scene.add(this.ambientLight);

    this.spotLight = new THREE.SpotLight(0xff006e, 1);
    this.spotLight.position.set(0, 50, 0);
    this.spotLight.angle = Math.PI / 4;
    this.scene.add(this.spotLight);
  }

  getName(): string {
    return 'Heatmap Grid';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const program = trade.p;
    const token = trade.ta || 'UNKNOWN'; // Use token_a as primary token
    const key = `${program}-${token}`;

    if (!this.cells.has(key)) {
      // Try with just major tokens
      const majorTokens = ['SOL', 'USDC', 'USDT'];
      for (const majorToken of majorTokens) {
        const altKey = `${program}-${majorToken}`;
        if (this.cells.has(altKey) && token.includes(majorToken)) {
          this.updateCell(altKey, trade.vu);
          return;
        }
      }
      return;
    }

    this.updateCell(key, trade.vu);
  }

  private updateCell(key: string, volume: number): void {
    const cell = this.cells.get(key)!;
    cell.volume += volume;
    cell.trades++;

    // Calculate height based on volume (logarithmic)
    const maxHeight = 15;
    const volumeLog = Math.log10(Math.max(1, cell.volume));
    cell.targetHeight = Math.min(maxHeight, 0.1 + volumeLog * 1.5);
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Wave ripple effect from center - scaled by revenue
    this.rippleWave = Math.min(1.5, 1.0 + this.blockRevenue * 8);
    this.rippleOrigin = { x: 0, z: 0 };

    // Flash grid
    this.gridFloor.material.opacity = 1.0;

    // Reset all cells for new block
    this.cells.forEach(cell => {
      cell.volume = 0;
      cell.trades = 0;
      cell.targetHeight = 0.1;
    });
  }

  /**
   * Handle rich block data - scale HeatmapGrid by Volume/Revenue
   */
  onBlockData(block: BlockMessage): void {
    // Volume (affects cell height scaling)
    this.blockVolume = block.swapVolumeUsd + block.transferVolumeUsd;

    // Revenue (affects glow intensity)
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9;

    // Completion rate
    const nonVote = block.completed + block.reverted;
    this.completionRate = nonVote > 0 ? block.completed / nonVote : 1.0;

    // Base emissive intensity from revenue
    this.baseEmissiveIntensity = Math.min(0.8, 0.3 + this.blockRevenue * 8);

    // Ambient light intensity from revenue
    this.ambientLight.intensity = Math.min(0.6, 0.3 + this.blockRevenue * 4);

    // Ambient color shifts with completion rate
    const baseColor = new THREE.Color(0x8b5cf6);
    const amberColor = new THREE.Color(txTypeColors.reverted);
    baseColor.lerp(amberColor, (1 - this.completionRate) * 0.4);
    this.ambientLight.color.copy(baseColor);

    // Spotlight intensity from revenue
    this.spotLight.intensity = Math.min(2.0, 1.0 + this.blockRevenue * 15);

    // Spotlight color shifts with completion rate
    const spotBaseColor = new THREE.Color(0xff006e);
    spotBaseColor.lerp(amberColor, (1 - this.completionRate) * 0.3);
    this.spotLight.color.copy(spotBaseColor);

    // Grid floor color shifts with completion rate
    const gridColor = new THREE.Color(0x8b5cf6);
    gridColor.lerp(amberColor, (1 - this.completionRate) * 0.3);
    (this.gridFloor.material as THREE.LineBasicMaterial).color.copy(gridColor);
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Update cells
    this.cells.forEach(cell => {
      // Lerp height
      cell.currentHeight += (cell.targetHeight - cell.currentHeight) * 0.1;

      // Decay target for smooth fall-off
      cell.targetHeight *= 0.98;

      // Update mesh
      cell.mesh.scale.y = cell.currentHeight;
      cell.mesh.position.y = cell.currentHeight / 2;

      // Update color based on height (heatmap) and revenue
      const intensity = Math.min(1, cell.currentHeight / 15);
      const heatColor = volumeHeatmap(cell.volume);
      (cell.mesh.material as THREE.MeshStandardMaterial).color.setHex(heatColor);
      (cell.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(heatColor);
      (cell.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = this.baseEmissiveIntensity + intensity * 0.7;

      // Ripple wave effect
      if (this.rippleWave > 0 && this.rippleOrigin) {
        const dx = cell.x - this.rippleOrigin.x;
        const dz = cell.z - this.rippleOrigin.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const wavePos = this.rippleWave * 30;

        if (Math.abs(distance - wavePos) < 5) {
          const rippleStrength = 1 - Math.abs(distance - wavePos) / 5;
          cell.mesh.position.y += rippleStrength * 2 * this.rippleWave;
        }
      }
    });

    // Decay ripple
    if (this.rippleWave > 0) {
      this.rippleWave *= 0.92;
    }

    // Decay grid flash
    if (this.gridFloor.material.opacity > 0.5) {
      this.gridFloor.material.opacity *= 0.95;
    }

    // Orbit camera
    this.cameraAngle += deltaTime * 0.0002;
    const radius = 45;
    this.camera.position.x = Math.cos(this.cameraAngle) * radius;
    this.camera.position.z = Math.sin(this.cameraAngle) * radius;
    this.camera.position.y = 40 + Math.sin(time * 0.3) * 5;
    this.camera.lookAt(0, 5, 0);
  }

  dispose(): void {
    this.cells.forEach(cell => {
      this.scene.remove(cell.mesh);
      cell.mesh.geometry.dispose();
      (cell.mesh.material as THREE.Material).dispose();
    });
    this.cells.clear();

    super.dispose();
  }
}

interface GridCell {
  mesh: THREE.Mesh;
  program: string;
  token: string;
  volume: number;
  trades: number;
  targetHeight: number;
  currentHeight: number;
  x: number;
  z: number;
}
