import * as THREE from 'three';
import { Environment } from './Environment';
import { ParticleSystem } from './ParticleSystem';
import { BlockBuilder } from './BlockBuilder';
import { DataProcessor } from '../data/DataProcessor';
import type { TradeMessage } from '../../../shared/types';
import type { FocusMode, ParticleShape, BlockData } from '../types';

export class Scene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private environment: Environment;
  private particleSystem: ParticleSystem;
  private blockBuilder: BlockBuilder;
  private dataProcessor: DataProcessor;

  private clock: THREE.Clock;
  private lastTime: number = 0;
  private blockStartTime: number = Date.now();

  constructor(container: HTMLElement, dataProcessor?: DataProcessor) {
    // Use provided DataProcessor or create a new one
    this.dataProcessor = dataProcessor || new DataProcessor();
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

    // Setup DataProcessor callbacks
    this.dataProcessor.onTrade((trade, slot) => {
      this.particleSystem.addTrade(trade, slot);
    });

    this.dataProcessor.onGracePeriodEnd((oldSlot, newSlot, bufferedTrades) => {
      console.log(`⏱️ Grace period ended, sweeping slot ${oldSlot}, spawning ${bufferedTrades.length} buffered particles for slot ${newSlot}`);

      // Complete the old block (triggers sweep)
      this.onBlockComplete(oldSlot, newSlot);

      // SIMPLE CLEANUP: Remove all particles older than 2 slots ago
      const minSlot = newSlot - 2;
      this.particleSystem.removeParticlesOlderThan(minSlot);

      // Spawn all buffered particles at once for the new slot
      for (const bufferedTrade of bufferedTrades) {
        this.particleSystem.addTrade(bufferedTrade, bufferedTrade.s);
      }
    });

    // Handle window resize
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // Handle particle click debugging
    window.addEventListener('click', this.onParticleClick.bind(this));

    // Start animation
    this.animate();
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

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

    // Update DataProcessor (handles grace period logic)
    this.dataProcessor.update(deltaTime);

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

    // Render
    this.renderer.render(this.scene, this.camera);

    this.lastTime = time;
  }

  private firstTradeHandled = false;

  addTrade(trade: TradeMessage) {
    // Delegate to DataProcessor - it handles all the slot detection and buffering logic
    this.dataProcessor.processTrade(trade);

    // On first trade, create initial block
    if (!this.firstTradeHandled && this.dataProcessor.getCurrentSlot() > 0) {
      this.firstTradeHandled = true;
      console.log(`🎬 First trade! Creating initial block for slot ${trade.s}`);
      const blockData: BlockData = {
        slot: trade.s,
        trades: 0,
        volume: 0,
        timestamp: Date.now(),
        particles: [],
      };
      this.blockBuilder.startBlock(blockData);
    }
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
    window.removeEventListener('click', this.onParticleClick.bind(this));
  }
}
