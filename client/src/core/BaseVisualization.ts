import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { IVisualization, IHUDConfig } from './IVisualization';
import type { DataProcessor } from '../data/DataProcessor';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData, FocusMode, ParticleShape } from '../types';
import { Tooltip, type InteractiveObject } from '../utils/Tooltip';
import type { LegendItem } from '../hud/Legend';

/**
 * Bloom configuration for visualizations
 */
export interface BloomConfig {
  strength: number;
  radius: number;
  threshold: number;
}

/**
 * Default bloom settings per visualization name
 * Tuned for clarity: neon/glow effects get more bloom, data-heavy vizs get less
 */
const BLOOM_PRESETS: Record<string, BloomConfig> = {
  // Neon aesthetic visualizations - higher bloom
  'VR Tunnel': { strength: 0.8, radius: 0.4, threshold: 0.75 },
  'Lightning Network': { strength: 0.8, radius: 0.4, threshold: 0.7 },
  'Nyan Trade': { strength: 0.6, radius: 0.4, threshold: 0.75 },

  // Data-centric visualizations - subtle bloom for readability
  'ECG Monitor': { strength: 0.4, radius: 0.3, threshold: 0.85 },
  'Frequency Bars': { strength: 0.4, radius: 0.3, threshold: 0.85 },
  'Heatmap Grid': { strength: 0.3, radius: 0.25, threshold: 0.85 },
  'Stacked Bars 3D': { strength: 0.3, radius: 0.25, threshold: 0.85 },
  'Double-Sided EQ': { strength: 0.4, radius: 0.3, threshold: 0.8 },

  // Particle/effect visualizations - moderate bloom
  'Particle Nebula': { strength: 0.6, radius: 0.4, threshold: 0.7 },
  'Token Galaxy': { strength: 0.7, radius: 0.4, threshold: 0.7 },
  'Economic Pulse': { strength: 0.7, radius: 0.4, threshold: 0.75 },
  'Trade Stream': { strength: 0.5, radius: 0.3, threshold: 0.8 },
  'Volume Flow': { strength: 0.4, radius: 0.3, threshold: 0.8 },

  // Block/structure visualizations - low bloom
  'Block Stack 3D': { strength: 0.4, radius: 0.3, threshold: 0.85 },
  'Block Visualization': { strength: 0.4, radius: 0.3, threshold: 0.8 },
  'Revenue Tracker': { strength: 0.5, radius: 0.3, threshold: 0.8 },
  'Waveform Horizon': { strength: 0.4, radius: 0.3, threshold: 0.85 },
};

// Default to subtle bloom for unlisted visualizations (clarity over prettiness)
const DEFAULT_BLOOM: BloomConfig = { strength: 0.4, radius: 0.3, threshold: 0.85 };

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
  protected dataProcessor: DataProcessor | null = null;

  // Post-processing
  protected composer: EffectComposer;
  protected bloomPass: UnrealBloomPass;
  protected bloomEnabled: boolean = true;

  // Interaction support
  protected tooltip: Tooltip;
  protected raycaster: THREE.Raycaster;
  protected mouse: THREE.Vector2;
  protected interactiveObjects: InteractiveObject[] = [];
  protected hoveredObject: InteractiveObject | null = null;

  private resizeHandler: (() => void) | null = null;
  private mouseMoveHandler: ((event: MouseEvent) => void) | null = null;
  private clickHandler: ((event: MouseEvent) => void) | null = null;

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
      preserveDrawingBuffer: true, // Required for Playwright screenshots
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Setup post-processing
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Get bloom config for this visualization
    const bloomConfig = BLOOM_PRESETS[this.getName()] || DEFAULT_BLOOM;

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      bloomConfig.strength,
      bloomConfig.radius,
      bloomConfig.threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Setup clock
    this.clock = new THREE.Clock();

    // Initialize interaction support
    this.tooltip = new Tooltip();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Handle window resize
    this.resizeHandler = this.onWindowResize.bind(this);
    window.addEventListener('resize', this.resizeHandler);
  }

  /**
   * Initialize visualization by attaching to container and providing data processor
   */
  init(container: HTMLElement, dataProcessor: DataProcessor): void {
    this.container = container;
    this.dataProcessor = dataProcessor;

    // Clear any existing content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Append renderer
    container.appendChild(this.renderer.domElement);

    // Setup interaction event handlers
    this.mouseMoveHandler = this.onMouseMove.bind(this);
    this.clickHandler = this.onMouseClick.bind(this);
    window.addEventListener('mousemove', this.mouseMoveHandler);
    window.addEventListener('click', this.clickHandler);

    // NOTE: Animation loop is managed by SceneManager, not here
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

    // Remove interaction handlers
    if (this.mouseMoveHandler) {
      window.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
    if (this.clickHandler) {
      window.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
    }

    // Dispose tooltip
    this.tooltip.dispose();
    this.interactiveObjects = [];

    // Dispose post-processing
    this.composer.dispose();

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

  }

  /**
   * Handle window resize
   */
  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloomPass.resolution.set(window.innerWidth, window.innerHeight);
  }

  /**
   * Render the scene (called by SceneManager after update)
   */
  render(): void {
    if (this.bloomEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Toggle bloom effect on/off
   */
  toggleBloom(): boolean {
    this.bloomEnabled = !this.bloomEnabled;
    return this.bloomEnabled;
  }

  /**
   * Set bloom enabled state
   */
  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
  }

  /**
   * Get bloom enabled state
   */
  isBloomEnabled(): boolean {
    return this.bloomEnabled;
  }

  /**
   * Update bloom parameters
   */
  setBloomParams(strength?: number, radius?: number, threshold?: number): void {
    if (strength !== undefined) this.bloomPass.strength = strength;
    if (radius !== undefined) this.bloomPass.radius = radius;
    if (threshold !== undefined) this.bloomPass.threshold = threshold;
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

  /**
   * Handle mouse move for raycasting and tooltips
   */
  private onMouseMove(event: MouseEvent): void {
    // Convert mouse position to normalized device coordinates (-1 to +1)
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // Update interactions
    this.updateInteractions(event.clientX, event.clientY);
  }

  /**
   * Handle mouse click for opening Solscan links
   */
  private onMouseClick(event: MouseEvent): void {
    if (this.hoveredObject?.data.signature) {
      window.open(`https://solscan.io/tx/${this.hoveredObject.data.signature}`, '_blank');
    }
  }

  /**
   * Update raycasting and show/hide tooltip
   */
  protected updateInteractions(mouseX: number, mouseY: number): void {
    if (this.interactiveObjects.length === 0) {
      this.tooltip.hide();
      this.hoveredObject = null;
      return;
    }

    // Raycast from camera through mouse position
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Get all meshes from interactive objects
    const meshes = this.interactiveObjects.map(obj => obj.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, true);

    if (intersects.length > 0) {
      // Find the interactive object that was hit
      const hitMesh = intersects[0].object;
      const obj = this.interactiveObjects.find(o => o.mesh === hitMesh || o.mesh.children.includes(hitMesh));

      if (obj) {
        // Show tooltip with trade info
        const content = Tooltip.formatTradeInfo(obj.data);
        this.tooltip.show(mouseX, mouseY, content);
        this.hoveredObject = obj;

        // Change cursor to pointer if clickable
        if (obj.data.signature) {
          document.body.style.cursor = 'pointer';
        }
      }
    } else {
      // No intersection - hide tooltip
      this.tooltip.hide();
      this.hoveredObject = null;
      document.body.style.cursor = 'default';
    }
  }

  // Abstract methods that subclasses must implement
  abstract getName(): string;
  abstract onTrade(trade: TradeMessage, slot: number): void;
  abstract onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void;
  abstract update(deltaTime: number): void;

  /**
   * Optional hook for rich block data from block:update stream
   * Visualizations can implement this to access Volume, Revenue, and tx composition
   * for multi-dimensional scaling
   */
  onBlockData?(block: BlockMessage): void;

  /**
   * Get legend items explaining this visualization's visual language.
   * Subclasses should override this to provide meaningful legend content.
   */
  getLegend(): LegendItem[] {
    // Default empty legend - subclasses should override
    return [];
  }
}
