import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors, tokenColors, hashColor, volumeHeatmap } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
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
    const ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.3);
    this.scene.add(ambientLight);

    const spotLight = new THREE.SpotLight(0xff006e, 1);
    spotLight.position.set(0, 50, 0);
    spotLight.angle = Math.PI / 4;
    this.scene.add(spotLight);
  }

  getName(): string {
    return 'Heatmap Grid';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const program = trade.p;
    const token = trade.ti || 'UNKNOWN';
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
    console.log(`🗺️ Block ${newSlot} complete - ${blockData.trades} trades`);

    // Wave ripple effect from center
    this.rippleWave = 1.0;
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

      // Update color based on height (heatmap)
      const intensity = Math.min(1, cell.currentHeight / 15);
      const heatColor = volumeHeatmap(cell.volume);
      (cell.mesh.material as THREE.MeshStandardMaterial).color.setHex(heatColor);
      (cell.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(heatColor);
      (cell.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + intensity * 0.7;

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
