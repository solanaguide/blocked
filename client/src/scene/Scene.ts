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

    const deltaTime = this.clock.getDelta() * 1000; // Convert to ms
    const time = this.clock.getElapsedTime() * 1000;

    // Update subsystems
    this.environment.update(time);
    this.particleSystem.update(deltaTime);
    this.blockBuilder.update(deltaTime);

    // Render
    this.renderer.render(this.scene, this.camera);

    this.lastTime = time;
  }

  addTrade(trade: TradeMessage) {
    this.particleSystem.addTrade(trade);

    // Create impact effect at a random position near center
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 5;
    const impactPos = new THREE.Vector3(
      Math.cos(angle) * radius,
      (Math.random() - 0.5) * 3,
      Math.sin(angle) * radius
    );
    this.blockBuilder.createImpactEffect(impactPos);

    // Update current slot
    if (trade.s !== this.currentSlot && this.currentSlot !== 0) {
      // New block!
      this.onBlockComplete(this.currentSlot);
    }
    this.currentSlot = trade.s;
  }

  onBlockComplete(slot: number) {
    const particles = this.particleSystem.getParticlesForBlock();

    // Calculate block stats (would come from server ideally)
    let totalVolume = 0;
    for (const p of particles) {
      totalVolume += p.trade.vu;
    }

    const blockData: BlockData = {
      slot,
      trades: particles.length,
      volume: totalVolume,
      timestamp: Date.now(),
      particles,
    };

    this.blockBuilder.startBlock(blockData);
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
