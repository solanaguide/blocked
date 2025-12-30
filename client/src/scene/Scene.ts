import * as THREE from 'three';
import { Environment } from './Environment';
import { ParticleSystem } from './ParticleSystem';
import { BlockBuilder } from './BlockBuilder';
import type { TradeMessage } from '../../../shared/types';
import type { FocusMode, ParticleShape, BlockData } from '../types';

export class Scene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private environment: Environment;
  private particleSystem: ParticleSystem;
  private blockBuilder: BlockBuilder;

  private clock: THREE.Clock;
  private lastTime: number = 0;

  private currentSlot: number = 0;
  private blockStartTime: number = Date.now();
  private slotChangeTime: number = 0;
  private gracePeriodMs: number = 50; // Grace period after slot change before sweeping

  constructor(container: HTMLElement) {
    // Create scene
    this.scene = new THREE.Scene();

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 30, 60);
    this.camera.lookAt(0, 0, 0);

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);

    // Create subsystems
    this.environment = new Environment(this.scene);
    this.particleSystem = new ParticleSystem(this.scene);
    this.blockBuilder = new BlockBuilder(this.scene);

    // Setup clock
    this.clock = new THREE.Clock();

    // Handle window resize
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // Start animation
    this.animate();
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private animate() {
    requestAnimationFrame(this.animate.bind(this));

    let deltaTime = this.clock.getDelta() * 1000; // Convert to ms

    // CAP deltaTime to prevent huge jumps when tab becomes active after being inactive
    // (requestAnimationFrame pauses when tab inactive, but WebSocket keeps receiving)
    const MAX_DELTA = 100; // Cap at 100ms (~10fps minimum)
    if (deltaTime > MAX_DELTA) {
      console.log(`⚠️ Large deltaTime spike: ${deltaTime.toFixed(0)}ms, capping to ${MAX_DELTA}ms`);
      deltaTime = MAX_DELTA;
    }

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
      console.log(`📊 Particles: ${stats.total} total (${stats.locked} locked, ${stats.unlocked} unlocked) | Slots: ${slotInfo}`);
    }

    // Render
    this.renderer.render(this.scene, this.camera);

    this.lastTime = time;
  }

  addTrade(trade: TradeMessage) {
    const now = Date.now();

    // FIRST TRADE EVER: Create initial block before anything else
    if (this.currentSlot === 0) {
      console.log(`🎬 First trade! Creating initial block for slot ${trade.s}`);
      const blockData: BlockData = {
        slot: trade.s,
        trades: 0,
        volume: 0,
        timestamp: Date.now(),
        particles: [],
      };
      this.blockBuilder.startBlock(blockData);
      this.currentSlot = trade.s;
      this.slotChangeTime = now;
    }
    // Check for slot change, before spawning particle
    else if (trade.s !== this.currentSlot) {
      // New slot detected! Complete old block and start new one
      console.log(`🔄 Slot change detected: ${this.currentSlot} → ${trade.s}, starting grace period`);
      this.onBlockComplete(this.currentSlot, trade.s);
      this.slotChangeTime = now;
      this.currentSlot = trade.s;
    }

    // Grace period logic: assign particles to old slot if within grace period
    const timeSinceSlotChange = now - this.slotChangeTime;
    let assignToSlot = trade.s;

    if (timeSinceSlotChange < this.gracePeriodMs && trade.s === this.currentSlot) {
      // We're in grace period and this is a new-slot trade
      // Assign it to the OLD slot (currentSlot - 1) so it falls into the sweeping block
      const previousSlot = this.currentSlot - 1;
      if (this.blockBuilder.hasFormingBlockForSlot(previousSlot) || this.blockBuilder.isBlockSweeping(previousSlot)) {
        assignToSlot = previousSlot;
        if (Math.random() < 0.05) {
          console.log(`⏱️ Grace period: assigning trade to old slot ${previousSlot}`);
        }
      }
    }

    // Spawn particle with appropriate slot assignment
    this.particleSystem.addTrade(trade, assignToSlot);
  }

  onBlockComplete(oldSlot: number, newSlot: number) {
    const particles = this.particleSystem.getParticlesForBlock();

    // Calculate block stats
    let totalVolume = 0;
    for (const p of particles) {
      totalVolume += p.trade.vu;
    }

    const blockData: BlockData = {
      slot: newSlot,  // The NEW slot for the new block
      trades: particles.length,
      volume: totalVolume,
      timestamp: Date.now(),
      particles,
    };

    // Start new block - this will trigger sweeping of old blocks
    this.blockBuilder.startBlock(blockData, oldSlot);
    this.blockStartTime = Date.now();
  }

  setParticleShape(shape: ParticleShape) {
    this.particleSystem.setShape(shape);
  }

  setFocusMode(mode: FocusMode) {
    this.particleSystem.setFocusMode(mode);
  }

  adjustParticleSize(delta: number) {
    // Get current multiplier and adjust
    const current = (this.particleSystem as any).sizeMultiplier || 1.0;
    this.particleSystem.setSizeMultiplier(current + delta);
  }

  dispose() {
    this.renderer.dispose();
    window.removeEventListener('resize', this.onWindowResize.bind(this));
  }
}
