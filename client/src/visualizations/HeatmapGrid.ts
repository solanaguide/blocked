import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors, tokenColors, hashColor, volumeHeatmap, txTypeColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';
import type { DataProcessor } from '../data/DataProcessor';

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
  private tokens = ['SOL', 'USDC', 'USDT', 'BONK', 'JUP', 'WIF']; // Expanded to 6 tokens
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

  // Shadow-casting light reference
  private shadowLight!: THREE.DirectionalLight;
  private shadowFloor!: THREE.Mesh;

  // Labels
  private labels: THREE.Sprite[] = [];


  constructor() {
    super();

    // Enable shadow maps on renderer
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera.position.set(30, 40, 30);
    this.camera.lookAt(0, 0, 0);

    // Shadow-receiving floor
    const floorGeometry = new THREE.PlaneGeometry(60, 60);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a0a1e,
      roughness: 0.9,
      metalness: 0.1,
    });
    this.shadowFloor = new THREE.Mesh(floorGeometry, floorMaterial);
    this.shadowFloor.rotation.x = -Math.PI / 2;
    this.shadowFloor.position.y = -1;
    this.shadowFloor.receiveShadow = true;
    this.scene.add(this.shadowFloor);

    // Create synthwave grid floor overlay
    this.gridFloor = new THREE.GridHelper(60, 30, 0x8b5cf6, 0xff006e);
    this.gridFloor.position.y = -0.99;
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
        mesh.castShadow = true;
        mesh.receiveShadow = true;

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

    // Shadow-casting directional light
    this.shadowLight = new THREE.DirectionalLight(0xffffff, 0.5);
    this.shadowLight.position.set(20, 40, 20);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.width = 1024;
    this.shadowLight.shadow.mapSize.height = 1024;
    this.shadowLight.shadow.camera.near = 1;
    this.shadowLight.shadow.camera.far = 80;
    this.shadowLight.shadow.camera.left = -40;
    this.shadowLight.shadow.camera.right = 40;
    this.shadowLight.shadow.camera.top = 40;
    this.shadowLight.shadow.camera.bottom = -40;
    this.shadowLight.shadow.bias = -0.001;
    this.scene.add(this.shadowLight);

    // Create labels for rows (programs) and columns (tokens)
    this.createLabels();
  }

  /**
   * Override init to preload from cached network state
   */
  init(container: HTMLElement, dataProcessor: DataProcessor): void {
    super.init(container, dataProcessor);
    this.preloadFromCache();
  }

  /**
   * Fetch cached network state and initialize cell heights
   */
  private async preloadFromCache(): Promise<void> {
    try {
      const response = await fetch('/api/network-state');
      if (response.ok) {
        const state = await response.json();
        this.initializeFromCache(state);
      }
    } catch (err) {
      console.warn('HeatmapGrid: Could not fetch network state for preloading');
    }
  }

  /**
   * Initialize cell heights from cached network state
   */
  private initializeFromCache(state: {
    topPrograms: Array<{ id: string; volume: number; trades: number }>;
    topTokens: Array<{ id: string; volume: number; trades: number }>;
  }): void {
    if (!state.topPrograms || !state.topTokens) return;

    // Create a volume distribution across known cells
    // This gives an immediate visual without needing exact pair data
    const programVolumes = new Map(state.topPrograms.map(p => [p.id, p.volume]));
    const tokenVolumes = new Map(state.topTokens.map(t => [t.id, t.volume]));

    let updatedCells = 0;
    const maxHeight = 15;

    this.cells.forEach((cell, key) => {
      const progVol = programVolumes.get(cell.program) || 0;
      const tokVol = tokenVolumes.get(cell.token) || 0;

      if (progVol > 0 && tokVol > 0) {
        // Estimate cell volume as geometric mean of program and token volumes
        // This distributes the cached data across the grid plausibly
        const estimatedVolume = Math.sqrt(progVol * tokVol) / 100;

        if (estimatedVolume > 0) {
          cell.volume = estimatedVolume;
          const volumeLog = Math.log10(Math.max(1, estimatedVolume));
          cell.targetHeight = Math.min(maxHeight, 0.1 + volumeLog * 1.5);
          cell.currentHeight = cell.targetHeight * 0.5; // Start partway up for animation
          updatedCells++;
        }
      }
    });

    console.log(`HeatmapGrid: Preloaded ${updatedCells} cells with initial heights from cache`);
  }

  /**
   * Create axis labels for the grid
   */
  private createLabels(): void {
    const cellSpacing = 4;
    const gridWidth = this.programs.length * cellSpacing;
    const gridDepth = this.tokens.length * cellSpacing;
    const startX = -gridWidth / 2;
    const startZ = -gridDepth / 2;

    // Program labels (Y-axis / rows) - on the left side (use IDs directly)
    this.programs.forEach((program, i) => {
      const label = this.createTextSprite(
        program,
        programColors.get(program) || 0xffffff
      );
      label.position.set(startX - 6, 1, startZ + i * cellSpacing);
      label.scale.set(8, 2, 1);
      this.scene.add(label);
      this.labels.push(label);
    });

    // Token labels (X-axis / columns) - on the front
    this.tokens.forEach((token, j) => {
      const label = this.createTextSprite(
        token,
        tokenColors.get(token) || 0xffffff
      );
      label.position.set(startX + j * cellSpacing, 1, startZ - 4);
      label.scale.set(6, 2, 1);
      this.scene.add(label);
      this.labels.push(label);
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
    context.font = 'bold 28px Arial';
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

      // Decay target for smooth fall-off (slower decay for longer visibility)
      cell.targetHeight *= 0.995;

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
    this.camera.position.y = 40 + Math.sin(time * 0.3) * 5 + this.getCameraOffsetY();
    this.camera.lookAt(0, 5 + this.getCameraOffsetY() * 0.3, 0);
  }

  getLegend(): LegendItem[] {
    return [
      { label: 'Cell Height', color: 0x00CED1, description: 'Trade volume (log scale)' },
      { label: 'Blue → Pink', color: 0x0044ff, description: 'Low → High volume' },
      { label: 'Rows', color: 0x8b5cf6, description: 'DEX Programs (Jupiter, Raydium, etc.)' },
      { label: 'Columns', color: 0xffffff, description: 'Tokens (SOL, USDC, etc.)' },
      { label: 'Wave Effect', color: 0xff006e, description: 'New block arrival' },
    ];
  }

  dispose(): void {
    this.cells.forEach(cell => {
      this.scene.remove(cell.mesh);
      cell.mesh.geometry.dispose();
      (cell.mesh.material as THREE.Material).dispose();
    });
    this.cells.clear();

    // Dispose labels
    this.labels.forEach(label => {
      this.scene.remove(label);
      (label.material as THREE.SpriteMaterial).map?.dispose();
      (label.material as THREE.SpriteMaterial).dispose();
    });
    this.labels = [];

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
