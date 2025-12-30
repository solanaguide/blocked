import * as THREE from 'three';
import { IVisualization, IHUDConfig } from './IVisualization';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData, FocusMode, ParticleShape } from '../types';

/**
 * Base class for all visualizations
 * Handles common THREE.js setup and provides default implementations
 */
export abstract class BaseVisualization implements IVisualization {
  protected scene: THREE.Scene;
  protected camera: THREE.PerspectiveCamera;
  protected renderer: THREE.WebGLRenderer;
  protected clock: THREE.Clock;
  protected container: HTMLElement | null = null;

  private resizeHandler: (() => void) | null = null;

  constructor() {
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

    // Setup clock
    this.clock = new THREE.Clock();

    // Handle window resize
    this.resizeHandler = this.onWindowResize.bind(this);
    window.addEventListener('resize', this.resizeHandler);
  }

  /**
   * Initialize visualization by attaching to container
   */
  init(container: HTMLElement): void {
    this.container = container;

    // Clear any existing content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Append renderer
    container.appendChild(this.renderer.domElement);

    // Start animation loop
    this.animate();

    console.log(`✨ ${this.getName()} initialized`);
  }

  /**
   * Clean up all resources
   */
  dispose(): void {
    // Remove resize handler
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    // Dispose renderer
    this.renderer.dispose();

    // Remove canvas from container
    if (this.container && this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }

    // Clear scene
    while (this.scene.children.length > 0) {
      const object = this.scene.children[0];
      this.scene.remove(object);

      // Dispose geometries and materials
      if (object instanceof THREE.Mesh) {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(mat => mat.dispose());
          } else {
            object.material.dispose();
          }
        }
      }
    }

    console.log(`🗑️ ${this.getName()} disposed`);
  }

  /**
   * Handle window resize
   */
  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Animation loop
   */
  private animate(): void {
    if (!this.container) return; // Stop animating if disposed

    requestAnimationFrame(this.animate.bind(this));

    let deltaTime = this.clock.getDelta() * 1000; // Convert to ms

    // CAP deltaTime to prevent huge jumps when tab becomes active
    const MAX_DELTA = 100; // Cap at 100ms (~10fps minimum)
    if (deltaTime > MAX_DELTA) {
      deltaTime = MAX_DELTA;
    }

    // Call subclass update
    this.update(deltaTime);

    // Render scene
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Default HUD config - subclasses can override
   */
  getHUDConfig(): IHUDConfig | null {
    return {
      showBlockStats: true,
      showProgramLeaderboard: true,
      showTokenLeaderboard: true,
      showCharts: true,
    };
  }

  // Abstract methods that subclasses must implement
  abstract getName(): string;
  abstract onTrade(trade: TradeMessage, slot: number): void;
  abstract onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void;
  abstract update(deltaTime: number): void;
}
