import * as THREE from 'three';
import { IVisualization, IHUDConfig } from './IVisualization';
import type { DataProcessor } from '../data/DataProcessor';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData, FocusMode, ParticleShape } from '../types';
import { Tooltip, type InteractiveObject } from '../utils/Tooltip';

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
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

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
   * Render the scene (called by SceneManager after update)
   */
  render(): void {
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
}
