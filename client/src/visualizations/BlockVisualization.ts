import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { Environment } from '../scene/Environment';
import { ParticleSystem } from '../scene/ParticleSystem';
import { BlockBuilder } from '../scene/BlockBuilder';
import { txTypeColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { FocusMode, ParticleShape, BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';

/**
 * BlockVisualization - The original falling particles visualization
 * Particles fall into blocks, which sweep away when slots change
 */
export class BlockVisualization extends BaseVisualization {
  private environment: Environment;
  private particleSystem: ParticleSystem;
  private blockBuilder: BlockBuilder;
  private lastTime: number = 0;
  private blockStartTime: number = Date.now();
  private firstTradeHandled = false;

  // Block data state
  private showVoteParticles: boolean = true;
  private lastBlockSlot: number = 0;
  private currentBlockData: BlockMessage | null = null;

  constructor() {
    super();

    // Create subsystems
    this.environment = new Environment(this.scene);
    this.particleSystem = new ParticleSystem(this.scene);
    this.blockBuilder = new BlockBuilder(this.scene);

    // Handle particle click debugging
    window.addEventListener('click', this.onParticleClick.bind(this));
  }

  getName(): string {
    return 'Block Visualization';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    // On first trade, create initial block
    if (!this.firstTradeHandled) {
      this.firstTradeHandled = true;
      const blockData: BlockData = {
        slot: slot,
        trades: 0,
        volume: 0,
        timestamp: Date.now(),
        particles: [],
      };
      this.blockBuilder.startBlock(blockData);
    }

    // Add trade to particle system
    this.particleSystem.addTrade(trade, slot);
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {

    // SIMPLE CLEANUP: Remove all particles older than 2 slots ago
    const minSlot = newSlot - 2;
    this.particleSystem.removeParticlesOlderThan(minSlot);

    // Get particles for block visualization
    const particles = this.particleSystem.getParticlesForBlock();

    // Calculate block stats
    let totalVolume = 0;
    for (const p of particles) {
      totalVolume += p.trade.vu;
    }

    const completeBlockData: BlockData = {
      slot: newSlot,
      trades: particles.length,
      volume: totalVolume,
      timestamp: Date.now(),
      particles,
    };

    // Start new block - this will trigger sweeping of old blocks
    this.blockBuilder.startBlock(completeBlockData, oldSlot);
    this.blockStartTime = Date.now();
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime() * 1000;

    // Update subsystems
    this.environment.update(time);
    this.particleSystem.update(deltaTime, this.blockBuilder);
    this.blockBuilder.update(deltaTime);

    // Clean up all particles for blocks that finished sweeping and exited screen
    const slotsToCleanup = this.blockBuilder.getSlotsToCleanup();
    for (const slot of slotsToCleanup) {
      this.particleSystem.removeParticlesForSlot(slot);
    }

    this.lastTime = time;
  }

  /**
   * Handle particle click debugging
   */
  private onParticleClick(event: MouseEvent) {
    // Convert mouse position to normalized device coordinates
    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Raycast to find clicked object
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const intersects = raycaster.intersectObjects(this.scene.children, true);

    if (intersects.length > 0) {
      const intersection = intersects[0];

      // Check if it's an instanced mesh (particle)
      if (intersection.object instanceof THREE.InstancedMesh && intersection.instanceId !== undefined) {
        // Ask particle system to debug this instance
        this.particleSystem.debugParticleInstance(intersection.object, intersection.instanceId);
      }
    }
  }

  /**
   * Set particle shape
   */
  setParticleShape(shape: ParticleShape): void {
    this.particleSystem.setShape(shape);
  }

  /**
   * Set focus mode (color coding)
   */
  setFocusMode(mode: FocusMode): void {
    this.particleSystem.setFocusMode(mode);
  }

  /**
   * Adjust particle size
   */
  adjustParticleSize(delta: number): void {
    const current = (this.particleSystem as any).sizeMultiplier || 1.0;
    this.particleSystem.setSizeMultiplier(current + delta);
  }

  /**
   * Handle rich block data from block:update stream
   * Spawns particles for ALL transaction types (votes, completed, reverted)
   */
  onBlockData(block: BlockMessage): void {
    // Skip if we already processed this block
    if (block.slot === this.lastBlockSlot) {
      return;
    }
    this.lastBlockSlot = block.slot;
    this.currentBlockData = block;

    // Calculate how many particles to spawn
    // We scale down to keep performance reasonable
    // Original: ~1500 txns per block, we spawn proportionally
    const scaleFactor = 0.1; // Show 10% of actual tx counts

    // Vote particles (golden) - network consensus heartbeat
    if (this.showVoteParticles) {
      const voteCount = Math.ceil(block.votes * scaleFactor * 0.5); // Extra reduction for votes
      if (voteCount > 0) {
        this.particleSystem.addTxTypeParticles(voteCount, 'vote', block.slot, 0.3);
      }
    }

    // Completed transaction particles (cyan)
    const completedCount = Math.ceil(block.completed * scaleFactor);
    if (completedCount > 0) {
      this.particleSystem.addTxTypeParticles(completedCount, 'completed', block.slot, 0.5);
    }

    // Reverted transaction particles (amber)
    const revertedCount = Math.ceil(block.reverted * scaleFactor);
    if (revertedCount > 0) {
      this.particleSystem.addTxTypeParticles(revertedCount, 'reverted', block.slot, 0.5);
    }

    // Jito MEV particles (orange) - if there are jito transactions
    if (block.jitoTxns > 0) {
      const jitoCount = Math.ceil(block.jitoTxns * scaleFactor);
      if (jitoCount > 0) {
        this.particleSystem.addTxTypeParticles(jitoCount, 'jito', block.slot, 0.7);
      }
    }

  }

  /**
   * Toggle vote particle visibility
   */
  toggleVoteParticles(): boolean {
    this.showVoteParticles = !this.showVoteParticles;
    return this.showVoteParticles;
  }

  getLegend(): LegendItem[] {
    return [
      { label: 'Gold Particles', color: txTypeColors.vote, description: 'Vote transactions (consensus)' },
      { label: 'Cyan Particles', color: txTypeColors.completed, description: 'Completed transactions' },
      { label: 'Amber Particles', color: txTypeColors.reverted, description: 'Reverted transactions' },
      { label: 'Orange Particles', color: txTypeColors.jito, description: 'MEV (Jito) transactions' },
      { label: 'Block Polygon', color: 0x8b5cf6, description: 'Completed block structure' },
      { label: 'Particle Size', color: 0xffffff, description: 'Trade volume (log scale)' },
    ];
  }

  /**
   * Clean up when switching away from this visualization
   */
  dispose(): void {
    window.removeEventListener('click', this.onParticleClick.bind(this));
    super.dispose();
  }
}
