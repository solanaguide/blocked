import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors, txTypeColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';
import type { DataProcessor } from '../data/DataProcessor';

/**
 * LightningNetwork - Network graph of programs and tokens with lightning bolts
 *
 * CONCEPT: 3D network where nodes represent programs/tokens, trades = lightning bolts.
 * - Inner circle = Top programs (Jupiter, Raydium, etc.)
 * - Outer circle = Top tokens (SOL, USDC, USDT, etc.)
 * - Lightning bolt connects source program to random target
 * - Bolt THICKNESS = trade volume (bigger trades = thicker bolts)
 * - Node SIZE pulses with accumulated energy
 * - Block change = all nodes pulse simultaneously (network sync)
 */
export class LightningNetwork extends BaseVisualization {
  private nodes: Map<string, ProgramNode> = new Map();
  private bolts: LightningBolt[] = [];
  private cameraAngle: number = 0;
  private energyPulse: number = 0;

  // Track programs/tokens dynamically
  private topPrograms: string[] = [];
  private topTokens: string[] = [];
  private programVolumes: Map<string, number> = new Map();
  private tokenVolumes: Map<string, number> = new Map();

  // Block metrics for visual scaling
  private blockVolume = 0;
  private blockRevenue = 0;
  private completionRate = 1.0;
  private boltBrightnessMultiplier = 1.0;

  // Lighting references
  private ambientLight!: THREE.AmbientLight;

  constructor() {
    super();

    this.camera.position.set(0, 30, 60);
    this.camera.lookAt(0, 0, 0);

    // Ambient light
    this.ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.2);
    this.scene.add(this.ambientLight);

    // Nodes are created dynamically based on trading activity
  }

  /**
   * Override init to preload from cached network state
   */
  init(container: HTMLElement, dataProcessor: DataProcessor): void {
    super.init(container, dataProcessor);

    // Preload from cached network state (fire and forget)
    this.preloadFromCache();
  }

  /**
   * Fetch cached network state and initialize nodes immediately
   */
  private async preloadFromCache(): Promise<void> {
    try {
      const response = await fetch('/api/network-state');
      if (response.ok) {
        const state = await response.json();
        this.initializeFromCache(state);
      }
    } catch (err) {
      console.warn('LightningNetwork: Could not fetch network state for preloading');
    }
  }

  /**
   * Initialize nodes from cached network state
   */
  private initializeFromCache(state: {
    topPrograms: Array<{ id: string; volume: number; trades: number }>;
    topTokens: Array<{ id: string; volume: number; trades: number }>;
  }): void {
    // Initialize program volumes from cache
    if (state.topPrograms && state.topPrograms.length > 0) {
      state.topPrograms.slice(0, 8).forEach(p => {
        this.programVolumes.set(p.id, p.volume);
      });
    }

    // Initialize token volumes from cache
    if (state.topTokens && state.topTokens.length > 0) {
      state.topTokens.slice(0, 8).forEach(t => {
        this.tokenVolumes.set(t.id, t.volume);
      });
    }

    // Trigger network layout update
    this.updateNetwork();

    // Create initial lightning bolts between nodes if we have nodes
    if (this.nodes.size >= 2) {
      const nodeIds = Array.from(this.nodes.keys());
      const boltCount = Math.min(10, nodeIds.length * 2);
      for (let i = 0; i < boltCount; i++) {
        const sourceId = nodeIds[Math.floor(Math.random() * nodeIds.length)];
        const targetId = nodeIds[Math.floor(Math.random() * nodeIds.length)];
        if (sourceId !== targetId) {
          const sourceNode = this.nodes.get(sourceId);
          const targetNode = this.nodes.get(targetId);
          if (sourceNode && targetNode) {
            const color = programColors.get(sourceId) || 0x8b5cf6;
            this.createLightningBolt(sourceNode.mesh.position, targetNode.mesh.position, color, 0.2);
          }
        }
      }
    }

    const nodeCount = this.nodes.size;
    console.log(`LightningNetwork: Preloaded ${nodeCount} nodes, ${this.bolts.length} bolts from cache (programs: ${state.topPrograms?.length || 0}, tokens: ${state.topTokens?.length || 0})`);
  }

  private updateNetwork(): void {
    // Get top 8 programs and top 8 tokens by volume
    const sortedPrograms = Array.from(this.programVolumes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([p]) => p);

    const sortedTokens = Array.from(this.tokenVolumes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);

    // Only update if changed
    const programsChanged = JSON.stringify(sortedPrograms) !== JSON.stringify(this.topPrograms);
    const tokensChanged = JSON.stringify(sortedTokens) !== JSON.stringify(this.topTokens);

    if (!programsChanged && !tokensChanged) return;

    this.topPrograms = sortedPrograms;
    this.topTokens = sortedTokens;

    // Remove old nodes not in top lists
    const allTopIds = new Set([...this.topPrograms, ...this.topTokens]);
    this.nodes.forEach((node, id) => {
      if (!allTopIds.has(id)) {
        this.scene.remove(node.mesh);
        this.scene.remove(node.glow);
        this.scene.remove(node.wireframe);
        node.mesh.geometry.dispose();
        (node.mesh.material as THREE.Material).dispose();
        (node.wireframe.material as THREE.Material).dispose();
        this.nodes.delete(id);
      }
    });

    // Create nodes in two circles
    const innerRadius = 15; // Programs
    const outerRadius = 30; // Tokens

    // Create program nodes (inner circle)
    this.topPrograms.forEach((program, index) => {
      if (this.nodes.has(program)) return;

      const angle = (index / this.topPrograms.length) * Math.PI * 2;
      const x = Math.cos(angle) * innerRadius;
      const z = Math.sin(angle) * innerRadius;
      const y = 0;

      const color = programColors.get(program) || 0x8b5cf6;
      this.createNode(program, x, y, z, color, 2.5);
    });

    // Create token nodes (outer circle)
    this.topTokens.forEach((token, index) => {
      if (this.nodes.has(token)) return;

      const angle = (index / this.topTokens.length) * Math.PI * 2;
      const x = Math.cos(angle) * outerRadius;
      const z = Math.sin(angle) * outerRadius;
      const y = 0;

      const color = 0x06ffa5; // Green for tokens
      this.createNode(token, x, y, z, color, 1.8);
    });
  }

  private createNode(id: string, x: number, y: number, z: number, color: number, size: number): void {
    // Create sphere node
    const geometry = new THREE.SphereGeometry(size, 16, 16);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.2,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);

    // Add glow
    const glow = new THREE.PointLight(color, 1, 30);
    glow.position.copy(mesh.position);

    // Add wireframe
    const wireGeometry = new THREE.SphereGeometry(size * 1.1, 8, 8);
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: color,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
    });
    const wireframe = new THREE.Mesh(wireGeometry, wireMaterial);
    wireframe.position.copy(mesh.position);

    this.scene.add(mesh);
    this.scene.add(glow);
    this.scene.add(wireframe);

    this.nodes.set(id, {
      mesh,
      glow,
      wireframe,
      position: new THREE.Vector3(x, y, z),
      energy: 0,
    });
  }

  getName(): string {
    return 'Lightning Network';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const program = trade.p;
    const token = trade.ta || 'UNKNOWN'; // Use token_a as primary token
    const volume = trade.vu;

    // Track volumes
    this.programVolumes.set(program, (this.programVolumes.get(program) || 0) + volume);
    this.tokenVolumes.set(token, (this.tokenVolumes.get(token) || 0) + volume);

    // Update network periodically
    const time = this.clock.getElapsedTime();
    if (Math.floor(time) % 3 === 0 && Math.floor(time * 10) % 10 === 0) {
      this.updateNetwork();
    }

    // Create lightning bolt if nodes exist
    const sourceNode = this.nodes.get(program);
    if (!sourceNode) return;

    // Try to find token node, otherwise pick random
    let targetNode = this.nodes.get(token);
    if (!targetNode) {
      const nodeArray = Array.from(this.nodes.values());
      if (nodeArray.length === 0) return;
      targetNode = nodeArray[Math.floor(Math.random() * nodeArray.length)];
    }

    // Add energy to source node
    sourceNode.energy += volume;

    // Create lightning bolt - BIGGER THICKNESS for larger trades
    const thickness = Math.min(2.0, 0.2 + Math.log10(Math.max(1, volume)) * 0.3);

    this.createLightningBolt(sourceNode.position, targetNode.position, programColors.get(program) || 0xffffff, thickness);
  }

  private createLightningBolt(start: THREE.Vector3, end: THREE.Vector3, color: number, thickness: number): void {
    // Create jagged lightning path
    const points: THREE.Vector3[] = [start.clone()];
    const segments = 8;

    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const lerped = new THREE.Vector3().lerpVectors(start, end, t);

      // Add random jitter
      lerped.x += (Math.random() - 0.5) * 2;
      lerped.y += (Math.random() - 0.5) * 2;
      lerped.z += (Math.random() - 0.5) * 2;

      points.push(lerped);
    }

    points.push(end.clone());

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: color,
      linewidth: thickness,
      transparent: true,
      opacity: 1,
    });

    const bolt = new THREE.Line(geometry, material);
    this.scene.add(bolt);

    this.bolts.push({
      line: bolt,
      age: 0,
      lifetime: 300,
    });
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Pulse all nodes simultaneously - scaled by revenue
    this.energyPulse = Math.min(1.5, 1.0 + this.blockRevenue * 8);

    this.nodes.forEach(node => {
      node.glow.intensity = Math.min(8, 5.0 + this.blockRevenue * 40);
      (node.wireframe.material as THREE.MeshBasicMaterial).opacity = 0.8;
    });
  }

  /**
   * Handle rich block data - scale LightningNetwork by Volume/Revenue
   */
  onBlockData(block: BlockMessage): void {
    // Volume (affects node pulse intensity)
    this.blockVolume = block.swapVolumeUsd + block.transferVolumeUsd;

    // Revenue (affects bolt brightness and glow)
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9;

    // Completion rate
    const nonVote = block.completed + block.reverted;
    this.completionRate = nonVote > 0 ? block.completed / nonVote : 1.0;

    // Bolt brightness multiplier from priority fees
    const priorityFeeIntensity = block.priorityFees / 1e9;
    this.boltBrightnessMultiplier = Math.min(2.0, 1.0 + priorityFeeIntensity * 5);

    // Ambient light intensity from revenue
    this.ambientLight.intensity = Math.min(0.5, 0.2 + this.blockRevenue * 4);

    // Ambient color shifts with completion rate
    const baseColor = new THREE.Color(0x8b5cf6);
    const amberColor = new THREE.Color(txTypeColors.reverted);
    baseColor.lerp(amberColor, (1 - this.completionRate) * 0.4);
    this.ambientLight.color.copy(baseColor);

    // Update all node glow intensity based on revenue
    const baseGlow = 1 + this.blockRevenue * 15;
    this.nodes.forEach(node => {
      if (node.glow.intensity < baseGlow) {
        node.glow.intensity = baseGlow;
      }
    });
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Update nodes
    this.nodes.forEach(node => {
      // Pulse based on energy
      const energyScale = 1 + Math.min(node.energy / 100000, 0.5);
      node.mesh.scale.set(energyScale, energyScale, energyScale);

      // Decay energy
      node.energy *= 0.95;

      // Gentle float
      node.mesh.position.y = node.position.y + Math.sin(time * 0.5 + node.position.x) * 0.5;
      node.glow.position.copy(node.mesh.position);
      node.wireframe.position.copy(node.mesh.position);

      // Decay glow
      if (node.glow.intensity > 1) {
        node.glow.intensity *= 0.95;
      }

      // Rotate wireframe
      node.wireframe.rotation.y += deltaTime * 0.001;
    });

    // Update bolts
    this.bolts.forEach((bolt, index) => {
      bolt.age += deltaTime;

      // Fade out
      const fadeProgress = bolt.age / bolt.lifetime;
      (bolt.line.material as THREE.LineBasicMaterial).opacity = 1 - fadeProgress;

      // Remove old bolts
      if (bolt.age > bolt.lifetime) {
        this.scene.remove(bolt.line);
        bolt.line.geometry.dispose();
        (bolt.line.material as THREE.Material).dispose();
        this.bolts.splice(index, 1);
      }
    });

    // Block pulse effect
    if (this.energyPulse > 0) {
      this.energyPulse *= 0.9;
      this.nodes.forEach(node => {
        (node.wireframe.material as THREE.MeshBasicMaterial).opacity = 0.3 + this.energyPulse * 0.5;
      });
    } else {
      this.nodes.forEach(node => {
        (node.wireframe.material as THREE.MeshBasicMaterial).opacity *= 0.98;
      });
    }

    // Orbit camera
    this.cameraAngle += deltaTime * 0.0003;
    const radius = 40;
    this.camera.position.x = Math.cos(this.cameraAngle) * radius;
    this.camera.position.z = Math.sin(this.cameraAngle) * radius;
    this.camera.position.y = 20 + Math.sin(time * 0.2) * 5 + this.getCameraOffsetY();
    this.camera.lookAt(0, this.getCameraOffsetY() * 0.3, 0);
  }

  getLegend(): LegendItem[] {
    return [
      { label: 'Inner Nodes', color: 0x8b5cf6, description: 'Top programs (DEXes)' },
      { label: 'Outer Nodes', color: 0x06ffa5, description: 'Top traded tokens' },
      { label: 'Lightning Bolt', color: 0xff006e, description: 'Trade (program → token)' },
      { label: 'Bolt Thickness', color: 0x00CED1, description: 'Trade volume (log scale)' },
      { label: 'Node Pulse', color: 0xffffff, description: 'Accumulated trading energy' },
    ];
  }

  dispose(): void {
    this.nodes.forEach(node => {
      this.scene.remove(node.mesh);
      this.scene.remove(node.glow);
      this.scene.remove(node.wireframe);
      node.mesh.geometry.dispose();
      (node.mesh.material as THREE.Material).dispose();
      (node.wireframe.material as THREE.Material).dispose();
    });
    this.nodes.clear();

    this.bolts.forEach(bolt => {
      this.scene.remove(bolt.line);
      bolt.line.geometry.dispose();
      (bolt.line.material as THREE.Material).dispose();
    });
    this.bolts = [];

    super.dispose();
  }
}

interface ProgramNode {
  mesh: THREE.Mesh;
  glow: THREE.PointLight;
  wireframe: THREE.Mesh;
  position: THREE.Vector3;
  energy: number;
}

interface LightningBolt {
  line: THREE.Line;
  age: number;
  lifetime: number;
}
