import * as THREE from 'three';
import type { TradeMessage } from '../../../shared/types';
import type { Particle, ParticleShape, FocusMode } from '../types';

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: Map<string, Particle> = new Map();
  private particlePool: Particle[] = [];

  // Instanced meshes for each geometry type
  private instancedMeshes: Map<ParticleShape, THREE.InstancedMesh> = new Map();
  private geometries: Map<ParticleShape, THREE.BufferGeometry> = new Map();
  private material: THREE.MeshStandardMaterial;

  // Instance tracking
  private instanceCounts: Map<ParticleShape, number> = new Map();
  private maxInstances = 3000;

  private currentShape: ParticleShape = 'cube';
  private focusMode: FocusMode = 'volume';
  private sizeMultiplier = 1.0;

  // Program colors (vaporwave palette)
  private programColors: Map<string, number> = new Map([
    ['JUP', 0xb026ff],          // Jupiter - Electric Purple
    ['RAYDIUM_CLMM', 0x00f0ff], // Raydium CLMM - Neon Blue
    ['RAYDIUM_CP', 0xff006e],   // Raydium CP - Hot Pink
    ['RAYDIUM_CPMM', 0xff1493], // Raydium CPMM - Deep Pink
    ['ORCA', 0x00ffd4],         // Orca - Cyan
    ['PHOENIX', 0xff6b35],      // Phoenix - Orange
    ['LIFINITY', 0x00ff88],     // Lifinity - Green
    ['FLASH', 0xffff00],        // Flash - Yellow
  ]);

  // Token colors
  private tokenColors: Map<string, number> = new Map([
    ['SOL', 0xffd700],    // Gold
    ['USDC', 0x00ffd4],   // Cyan
    ['USDT', 0x26a17b],   // Green
  ]);

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.createGeometries();
    this.createMaterial();
    this.createInstancedMeshes();
  }

  private createGeometries() {
    this.geometries.set('cube', new THREE.BoxGeometry(1, 1, 1));
    this.geometries.set('octahedron', new THREE.OctahedronGeometry(0.7));
    this.geometries.set('tetrahedron', new THREE.TetrahedronGeometry(0.8));
    this.geometries.set('sphere', new THREE.SphereGeometry(0.6, 16, 16));
    this.geometries.set('torus', new THREE.TorusGeometry(0.5, 0.2, 8, 16));
  }

  private createMaterial() {
    this.material = new THREE.MeshStandardMaterial({
      metalness: 0.8,
      roughness: 0.2,
      emissive: 0xffffff,
      emissiveIntensity: 0.5,
    });
  }

  private createInstancedMeshes() {
    for (const [shape, geometry] of this.geometries) {
      const mesh = new THREE.InstancedMesh(
        geometry,
        this.material,
        this.maxInstances
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0; // Start with no instances
      this.scene.add(mesh);
      this.instancedMeshes.set(shape, mesh);
      this.instanceCounts.set(shape, 0);
    }
  }

  setShape(shape: ParticleShape) {
    this.currentShape = shape;

    // Show only current shape
    for (const [shapeKey, mesh] of this.instancedMeshes) {
      mesh.visible = shapeKey === shape;
    }
  }

  setFocusMode(mode: FocusMode) {
    this.focusMode = mode;
    // Recompute all particle colors and sizes
    this.updateAllParticles();
  }

  setSizeMultiplier(multiplier: number) {
    this.sizeMultiplier = Math.max(0.1, Math.min(5.0, multiplier));
    this.updateAllParticles();
  }

  addTrade(trade: TradeMessage) {
    // Calculate spawn position (random point on cylinder perimeter)
    const angle = Math.random() * Math.PI * 2;
    const radius = 40 + Math.random() * 10;
    const height = (Math.random() - 0.5) * 20;

    const position = new THREE.Vector3(
      Math.cos(angle) * radius,
      height,
      Math.sin(angle) * radius
    );

    // Calculate velocity towards center
    const direction = new THREE.Vector3(0, 0, 0).sub(position).normalize();
    const speed = this.calculateSpeed(trade.vu);
    const velocity = direction.multiplyScalar(speed);

    // Calculate size
    const size = this.calculateSize(trade.vu);

    // Calculate color
    const color = this.calculateColor(trade);

    // Create or reuse particle
    const particle: Particle = this.getParticle();
    particle.id = trade.sig;
    particle.position.copy(position);
    particle.velocity.copy(velocity);
    particle.size = size;
    particle.color.set(color);
    particle.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );
    particle.rotationSpeed.set(
      (Math.random() - 0.5) * 0.05,
      (Math.random() - 0.5) * 0.05,
      (Math.random() - 0.5) * 0.05
    );
    particle.lifetime = 0;
    particle.maxLifetime = 3000; // 3 seconds - faster turnover
    particle.trade = trade;

    this.particles.set(particle.id, particle);
  }

  private getParticle(): Particle {
    const mesh = this.instancedMeshes.get(this.currentShape)!;
    let instanceId = this.instanceCounts.get(this.currentShape)!;

    if (instanceId >= this.maxInstances) {
      // Reuse oldest particle
      const oldest = Array.from(this.particles.values())[0];
      this.particles.delete(oldest.id);
      return oldest;
    }

    // Create new particle instance
    const particle: Particle = {
      id: '',
      mesh,
      instanceId,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      size: 1,
      color: new THREE.Color(),
      rotation: new THREE.Euler(),
      rotationSpeed: new THREE.Vector3(),
      lifetime: 0,
      maxLifetime: 5000,
      trade: {} as TradeMessage,
    };

    this.instanceCounts.set(this.currentShape, instanceId + 1);
    mesh.count = instanceId + 1;

    return particle;
  }

  private calculateSpeed(volumeUsd: number): number {
    // Much faster - particles need to reach center quickly
    return 0.8 + Math.log10(Math.max(1, volumeUsd)) * 0.1;
  }

  private calculateSize(volumeUsd: number): number {
    let baseSize: number;

    if (this.focusMode === 'volume') {
      // Logarithmic scale based on volume - larger base size
      baseSize = 1.0 + Math.log10(Math.max(1, volumeUsd)) * 0.4;
    } else {
      // Uniform size in other modes
      baseSize = 1.5;
    }

    return baseSize * this.sizeMultiplier;
  }

  private calculateColor(trade: TradeMessage): number {
    switch (this.focusMode) {
      case 'program':
        return this.programColors.get(trade.p) || 0xffffff;

      case 'token':
        return this.tokenColors.get(trade.ta) || this.hashColor(trade.ta);

      case 'volume':
        // Heat map: blue -> purple -> pink -> red
        if (trade.vu < 100) return 0x0099ff;      // Blue
        if (trade.vu < 1000) return 0x8b5cf6;     // Purple
        if (trade.vu < 10000) return 0xff006e;    // Pink
        return 0xff3333;                           // Red

      case 'free':
      default:
        return 0xffffff;
    }
  }

  private hashColor(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Convert to vibrant color
    return (hash & 0x00FFFFFF) | 0x404040; // Ensure minimum brightness
  }

  private updateAllParticles() {
    for (const particle of this.particles.values()) {
      particle.size = this.calculateSize(particle.trade.vu);
      particle.color.set(this.calculateColor(particle.trade));
    }
  }

  update(deltaTime: number) {
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (const particle of this.particles.values()) {
      // Update lifetime
      particle.lifetime += deltaTime;

      // Remove if too old
      if (particle.lifetime > particle.maxLifetime) {
        this.particles.delete(particle.id);
        continue;
      }

      // Update position
      particle.position.add(
        particle.velocity.clone().multiplyScalar(deltaTime * 0.1)
      );

      // Update rotation
      particle.rotation.x += particle.rotationSpeed.x * deltaTime * 0.01;
      particle.rotation.y += particle.rotationSpeed.y * deltaTime * 0.01;
      particle.rotation.z += particle.rotationSpeed.z * deltaTime * 0.01;

      // Fade out near end of life
      const lifeFactor = 1.0 - (particle.lifetime / particle.maxLifetime);

      // Update instance matrix
      matrix.makeRotationFromEuler(particle.rotation);
      matrix.scale(new THREE.Vector3(
        particle.size * lifeFactor,
        particle.size * lifeFactor,
        particle.size * lifeFactor
      ));
      matrix.setPosition(particle.position);

      particle.mesh.setMatrixAt(particle.instanceId, matrix);
      particle.mesh.setColorAt(particle.instanceId, particle.color);
    }

    // Update all meshes
    for (const mesh of this.instancedMeshes.values()) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  getParticlesForBlock(): Particle[] {
    return Array.from(this.particles.values());
  }

  clear() {
    this.particles.clear();
  }
}
