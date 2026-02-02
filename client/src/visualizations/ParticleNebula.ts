import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { volumeHeatmap, txTypeColors, programColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';
import type { DataProcessor } from '../data/DataProcessor';

/**
 * ParticleNebula - Cloud of glowing particles in 3D space
 *
 * CONCEPT: Floating particle cloud where each trade spawns a glowing particle.
 * Particles cluster around their program's region in 3D space and drift slowly.
 * Larger trades = bigger, brighter particles. On block change, all particles
 * experience a gravitational collapse toward their cluster centers (like a supernova).
 *
 * PERFORMANCE: Uses InstancedMesh for 200 particles → 1 draw call
 */
export class ParticleNebula extends BaseVisualization {
  private maxParticles = 200;
  private particleData: NebulaParticleData[] = [];
  private instancedMesh: THREE.InstancedMesh;
  private programClusters: Map<string, THREE.Vector3> = new Map();
  private clusterLabels: Map<string, THREE.Sprite> = new Map();
  private gravitationalCollapse: number = 0;
  private cameraAngle: number = 0;
  private sharedLight: THREE.PointLight;
  private ambientLight: THREE.AmbientLight;

  // Block metrics for visual scaling
  private blockVolume = 0;
  private blockRevenue = 0;
  private completionRate = 1.0;
  private nebulaIntensity = 1.0;


  // Reusable objects to avoid GC pressure
  private readonly _tempMatrix = new THREE.Matrix4();
  private readonly _tempPosition = new THREE.Vector3();
  private readonly _tempQuaternion = new THREE.Quaternion();
  private readonly _tempScale = new THREE.Vector3();
  private readonly _tempColor = new THREE.Color();
  private readonly _tempVec3 = new THREE.Vector3();

  constructor() {
    super();

    this.camera.position.set(0, 30, 50);
    this.camera.lookAt(0, 0, 0);

    // Define program cluster positions
    const programs = ['JUP', 'RAYDIUM_CLMM', 'RAYDIUM_CP', 'ORCA', 'PHOENIX', 'LIFINITY', 'FLASH'];
    const radius = 20;

    programs.forEach((program, index) => {
      const angle = (index / programs.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = (Math.random() - 0.5) * 10;

      const position = new THREE.Vector3(x, y, z);
      this.programClusters.set(program, position);

      // Create floating label for this cluster (use ID directly)
      const label = this.createTextSprite(
        program,
        programColors.get(program) || 0xffffff
      );
      label.position.copy(position);
      label.position.y += 8; // Float above cluster center
      this.scene.add(label);
      this.clusterLabels.set(program, label);
    });

    // Ambient lighting
    this.ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.2);
    this.scene.add(this.ambientLight);

    // Single shared light for all particles (performance optimization)
    this.sharedLight = new THREE.PointLight(0xff006e, 3, 100);
    this.scene.add(this.sharedLight);

    // Background stars
    this.createStarfield();

    // Create InstancedMesh for particles - single geometry and material for all
    const geometry = new THREE.SphereGeometry(1, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 1,
    });

    this.instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Enable per-instance colors
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxParticles * 3),
      3
    );
    this.instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // Initialize all instances as invisible (scale 0)
    for (let i = 0; i < this.maxParticles; i++) {
      this._tempMatrix.makeScale(0, 0, 0);
      this.instancedMesh.setMatrixAt(i, this._tempMatrix);
      this.instancedMesh.setColorAt(i, this._tempColor.setHex(0x000000));
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    this.scene.add(this.instancedMesh);
  }

  /**
   * Override init to preload from cached network state
   */
  init(container: HTMLElement, dataProcessor: DataProcessor): void {
    super.init(container, dataProcessor);
    this.preloadFromCache();
  }

  /**
   * Fetch cached network state and initialize particles immediately
   */
  private async preloadFromCache(): Promise<void> {
    try {
      const response = await fetch('/api/network-state');
      if (response.ok) {
        const state = await response.json();
        this.initializeFromCache(state);
      }
    } catch (err) {
      console.warn('ParticleNebula: Could not fetch network state for preloading');
    }
  }

  /**
   * Initialize particles from cached network state
   */
  private initializeFromCache(state: {
    topPrograms: Array<{ id: string; volume: number; trades: number }>;
  }): void {
    if (!state.topPrograms || state.topPrograms.length === 0) return;

    let createdParticles = 0;

    // Create particles for each program based on cached trade count
    state.topPrograms.slice(0, 8).forEach(p => {
      const clusterPos = this.programClusters.get(p.id);
      if (!clusterPos) return;

      // Create a few particles per program
      const particleCount = Math.min(10, Math.ceil(p.trades / 50));
      for (let i = 0; i < particleCount && this.particleData.length < this.maxParticles; i++) {
        const position = new THREE.Vector3(
          clusterPos.x + (Math.random() - 0.5) * 10,
          clusterPos.y + (Math.random() - 0.5) * 10,
          clusterPos.z + (Math.random() - 0.5) * 10
        );

        const size = 0.5 + Math.random() * 1.5;
        const color = volumeHeatmap(p.volume / particleCount);

        const velocity = new THREE.Vector3(
          (Math.random() - 0.5) * 0.05,
          (Math.random() - 0.5) * 0.05,
          (Math.random() - 0.5) * 0.05
        );

        const instanceIndex = this.particleData.length;
        this.particleData.push({
          position,
          velocity,
          size,
          color,
          age: Math.random() * 3000, // Start with varied ages
          lifetime: 6000 + Math.random() * 4000,
          program: p.id,
          clusterPos: clusterPos.clone(),
          instanceIndex,
          opacity: 1.0,
        });

        // Update the instance matrix and color
        this._tempPosition.copy(position);
        this._tempScale.set(size, size, size);
        this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
        this.instancedMesh.setMatrixAt(instanceIndex, this._tempMatrix);
        this._tempColor.setHex(color);
        this.instancedMesh.setColorAt(instanceIndex, this._tempColor);

        createdParticles++;
      }
    });

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    console.log(`ParticleNebula: Preloaded ${createdParticles} particles from cache`);
  }

  private createStarfield(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 1000;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 300;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 300;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 300;
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.3,
      transparent: true,
      opacity: 0.4,
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(stars);
  }

  getName(): string {
    return 'Particle Nebula';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const program = trade.p;
    const volume = trade.vu;

    // Get cluster position or create random position
    let clusterPos = this.programClusters.get(program);
    if (!clusterPos) {
      clusterPos = new THREE.Vector3(
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 40
      );
    }

    // Create particle near cluster with some randomness
    const position = new THREE.Vector3(
      clusterPos.x + (Math.random() - 0.5) * 10,
      clusterPos.y + (Math.random() - 0.5) * 10,
      clusterPos.z + (Math.random() - 0.5) * 10
    );

    // Particle size based on volume
    const size = Math.min(3, 0.5 + Math.log10(Math.max(1, volume)) * 0.3);
    const color = volumeHeatmap(volume);

    // Random drift velocity
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.05,
      (Math.random() - 0.5) * 0.05,
      (Math.random() - 0.5) * 0.05
    );

    // Find an available slot or replace oldest
    let instanceIndex: number;
    if (this.particleData.length < this.maxParticles) {
      instanceIndex = this.particleData.length;
      this.particleData.push({
        instanceIndex,
        position,
        velocity,
        size,
        color,
        lifetime: 6000,
        age: 0,
        program,
        clusterPos: clusterPos.clone(),
        opacity: 1,
      });
    } else {
      // Replace oldest particle
      const oldest = this.particleData.shift()!;
      instanceIndex = oldest.instanceIndex;
      this.particleData.push({
        instanceIndex,
        position,
        velocity,
        size,
        color,
        lifetime: 6000,
        age: 0,
        program,
        clusterPos: clusterPos.clone(),
        opacity: 1,
      });
    }

    // Update instance matrix and color
    this._tempPosition.copy(position);
    this._tempScale.setScalar(size);
    this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
    this.instancedMesh.setMatrixAt(instanceIndex, this._tempMatrix);

    this._tempColor.setHex(color);
    this.instancedMesh.setColorAt(instanceIndex, this._tempColor);
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Gravitational collapse effect - scaled by revenue
    this.gravitationalCollapse = Math.min(1.5, 0.8 + this.blockRevenue * 10);
  }

  /**
   * Handle rich block data - scale ParticleNebula by Volume/Revenue
   */
  onBlockData(block: BlockMessage): void {
    // Volume (affects nebula density perception)
    this.blockVolume = block.swapVolumeUsd + block.transferVolumeUsd;

    // Revenue (affects brightness)
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9;

    // Completion rate
    const nonVote = block.completed + block.reverted;
    this.completionRate = nonVote > 0 ? block.completed / nonVote : 1.0;

    // Calculate nebula intensity from revenue per tx
    const revenuePerTx = block.txns > 0 ? this.blockRevenue / block.txns : 0;
    this.nebulaIntensity = Math.min(2.0, 1.0 + revenuePerTx * 10000);

    // Update shared light intensity based on revenue
    this.sharedLight.intensity = Math.min(6, 3 + this.blockRevenue * 40);

    // Ambient light color shifts with completion rate
    const baseColor = new THREE.Color(0x8b5cf6);
    const amberColor = new THREE.Color(txTypeColors.reverted);
    baseColor.lerp(amberColor, (1 - this.completionRate) * 0.4);
    this.ambientLight.color.copy(baseColor);
    this.ambientLight.intensity = 0.2 + this.blockRevenue * 2;
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();
    let needsMatrixUpdate = false;
    let needsColorUpdate = false;

    // Update particles
    for (let i = this.particleData.length - 1; i >= 0; i--) {
      const particle = this.particleData[i];
      particle.age += deltaTime;

      // Drift movement
      particle.position.add(particle.velocity);

      // Gravitational attraction to cluster during collapse
      if (this.gravitationalCollapse > 0) {
        this._tempVec3.subVectors(particle.clusterPos, particle.position);
        this._tempVec3.multiplyScalar(this.gravitationalCollapse * 0.01);
        particle.position.add(this._tempVec3);
      }

      // Subtle orbital rotation around cluster
      const angle = time * 0.0005;
      const dx = particle.position.x - particle.clusterPos.x;
      const dz = particle.position.z - particle.clusterPos.z;
      const rotatedX = dx * Math.cos(angle) - dz * Math.sin(angle);
      const rotatedZ = dx * Math.sin(angle) + dz * Math.cos(angle);

      particle.position.x = particle.clusterPos.x + rotatedX;
      particle.position.z = particle.clusterPos.z + rotatedZ;

      // Pulse scale
      const pulseScale = 1 + Math.sin(time * 2 + i * 0.5) * 0.1;
      const currentScale = particle.size * pulseScale;

      // Fade out
      const fadeStart = particle.lifetime * 0.6;
      if (particle.age > fadeStart) {
        const fadeProgress = (particle.age - fadeStart) / (particle.lifetime - fadeStart);
        particle.opacity = 1 - fadeProgress;
      }

      // Update instance matrix
      this._tempPosition.copy(particle.position);
      this._tempScale.setScalar(currentScale * particle.opacity);
      this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
      this.instancedMesh.setMatrixAt(particle.instanceIndex, this._tempMatrix);
      needsMatrixUpdate = true;

      // Remove old particles
      if (particle.age > particle.lifetime) {
        // Set scale to 0 to hide
        this._tempMatrix.makeScale(0, 0, 0);
        this.instancedMesh.setMatrixAt(particle.instanceIndex, this._tempMatrix);
        this.particleData.splice(i, 1);
      }
    }

    // Update shared light position to average of all particles
    if (this.particleData.length > 0) {
      let avgX = 0, avgY = 0, avgZ = 0;
      for (const p of this.particleData) {
        avgX += p.position.x;
        avgY += p.position.y;
        avgZ += p.position.z;
      }
      const count = this.particleData.length;
      this.sharedLight.position.set(avgX / count, avgY / count, avgZ / count);
    }

    // Decay gravitational collapse
    if (this.gravitationalCollapse > 0) {
      this.gravitationalCollapse *= 0.95;
    }

    // Update instance matrices if needed
    if (needsMatrixUpdate) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    }
    if (needsColorUpdate && this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }

    // Orbit camera around nebula
    this.cameraAngle += deltaTime * 0.0002;
    const radius = 50;
    this.camera.position.x = Math.cos(this.cameraAngle) * radius;
    this.camera.position.z = Math.sin(this.cameraAngle) * radius;
    this.camera.position.y = 30 + Math.sin(time * 0.2) * 10 + this.getCameraOffsetY();
    this.camera.lookAt(0, this.getCameraOffsetY() * 0.3, 0);
  }

  /**
   * Create a text sprite label that always faces the camera
   */
  private createTextSprite(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;

    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Draw text
    context.font = 'bold 32px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Get color as hex string
    const hexColor = '#' + color.toString(16).padStart(6, '0');

    // Text shadow for visibility
    context.shadowColor = 'rgba(0, 0, 0, 0.8)';
    context.shadowBlur = 4;
    context.shadowOffsetX = 2;
    context.shadowOffsetY = 2;

    context.fillStyle = hexColor;
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    // Create sprite
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Always visible
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(12, 3, 1);

    return sprite;
  }

  getLegend(): LegendItem[] {
    return [
      { label: 'Particle Size', color: 0xffffff, description: 'Trade volume (log scale)' },
      { label: 'Small Trade', color: 0x06ffa5, description: 'Under $1K volume' },
      { label: 'Medium Trade', color: 0xfbbf24, description: '$1K - $100K volume' },
      { label: 'Large Trade', color: 0xff006e, description: 'Over $100K volume' },
      { label: 'Cluster Label', color: 0x8b5cf6, description: 'Program (DEX) grouping' },
      { label: 'Collapse Effect', color: 0x00CED1, description: 'Block completion pulse' },
    ];
  }

  dispose(): void {
    this.instancedMesh.geometry.dispose();
    (this.instancedMesh.material as THREE.Material).dispose();
    this.scene.remove(this.instancedMesh);
    this.particleData = [];

    // Dispose cluster labels
    this.clusterLabels.forEach(label => {
      this.scene.remove(label);
      (label.material as THREE.SpriteMaterial).map?.dispose();
      (label.material as THREE.SpriteMaterial).dispose();
    });
    this.clusterLabels.clear();

    super.dispose();
  }
}

interface NebulaParticleData {
  instanceIndex: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  size: number;
  color: number;
  lifetime: number;
  age: number;
  program: string;
  clusterPos: THREE.Vector3;
  opacity: number;
}
