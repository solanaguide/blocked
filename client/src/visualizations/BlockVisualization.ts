import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { Environment } from '../scene/Environment';
import { ParticleSystem } from '../scene/ParticleSystem';
import { BlockBuilder } from '../scene/BlockBuilder';
import type { TradeMessage } from '../../../shared/types';
import type { FocusMode, ParticleShape, BlockData } from '../types';

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
      console.log(`🎬 First trade! Creating initial block for slot ${slot}`);
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
    console.log(`⏱️ Block complete, sweeping slot ${oldSlot}, starting slot ${newSlot}`);

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

    // Debug logging every 3 seconds
    if (Math.floor(time / 3000) !== Math.floor(this.lastTime / 3000)) {
      const stats = this.particleSystem.getStats();
      const slotInfo = stats.slots.map(([slot, count]) => `${slot}:${count}`).join(', ');
      console.log(`📊 Particles: ${stats.total} total (${stats.locked} locked, ${stats.unlocked} unlocked) | Slots: ${slotInfo} | mesh.count: ${stats.meshCount}`);
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
        console.log('🔍 ========== PARTICLE DEBUG INFO ==========');
        console.log('Instance ID:', intersection.instanceId);
        console.log('Intersection point:', intersection.point);

        // Ask particle system to debug this instance
        this.particleSystem.debugParticleInstance(intersection.object, intersection.instanceId);
        console.log('🔍 =========================================');
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
   * Clean up when switching away from this visualization
   */
  dispose(): void {
    window.removeEventListener('click', this.onParticleClick.bind(this));
    super.dispose();
  }
}
