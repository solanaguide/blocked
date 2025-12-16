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
  private maxInstances = 10000; // Increased for high-throughput scenarios

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
      metalness: 0.3,
      roughness: 0.3,
      emissive: 0xffffff, // White emissive - colors will tint this
      emissiveIntensity: 0.8, // High intensity for glow
      vertexColors: true, // Per-instance colors
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

  addTrade(trade: TradeMessage, slot: number) {
    // CONTAINER APPROACH: Spawn particles ABOVE block, they "rain down" and settle inside
    // Block is at (0, 0, 0) with size 30 units (fixed size)
    // Spawn in a cone/funnel above it

    const blockSize = 30; // Block size (must match BlockBuilder)
    const spawnHeight = 25 + Math.random() * 10; // 25-35 units above center

    // Random position within block's X/Z footprint - FULL spread to fill entire volume
    const spreadX = (Math.random() - 0.5) * blockSize * 1.0; // Full width
    const spreadZ = (Math.random() - 0.5) * blockSize * 1.0; // Full depth

    const position = new THREE.Vector3(
      spreadX,
      spawnHeight,
      spreadZ
    );

    // Velocity: primarily downward (gravity-like), minimal drift to preserve spread
    const speed = this.calculateSpeed(trade.vu);
    const velocity = new THREE.Vector3(
      -spreadX * 0.01, // Very slight drift toward center X - keep spread!
      -speed,          // Downward (rain down)
      -spreadZ * 0.01  // Very slight drift toward center Z - keep spread!
    );

    // Calculate size
    const size = this.calculateSize(trade.vu);

    // Calculate color
    const color = this.calculateColor(trade);

    // Create NEW particle (no recycling!)
    const particle: Particle = this.createNewParticle(slot);
    particle.id = trade.sig;
    particle.slot = slot;
    particle.position.copy(position);
    particle.velocity.copy(velocity);
    particle.size = size;
    particle.color.set(color);
    particle.rotation.set(0, 0, 0);
    particle.rotationSpeed.set(0, 0, 0);
    particle.lifetime = 0;
    particle.maxLifetime = 500; // 500ms - orphan cleanup
    particle.trade = trade;
    particle.locked = false;
    particle.lockedPosition.set(0, 0, 0);

    this.particles.set(particle.id, particle);
  }

  private createNewParticle(slot: number): Particle {
    const mesh = this.instancedMeshes.get(this.currentShape)!;
    let instanceId = this.instanceCounts.get(this.currentShape)!;

    if (instanceId >= this.maxInstances) {
      // We've hit the instance limit - increase it or warn
      console.warn(`⚠️ Hit max instances (${this.maxInstances}), particle may not render`);
      instanceId = this.maxInstances - 1;
    }

    // Create new particle instance
    const particle: Particle = {
      id: '',
      slot,
      mesh,
      instanceId,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      size: 1,
      color: new THREE.Color(),
      rotation: new THREE.Euler(),
      rotationSpeed: new THREE.Vector3(),
      lifetime: 0,
      maxLifetime: 10000,
      trade: {} as TradeMessage,
      locked: false,
      lockedPosition: new THREE.Vector3(),
    };

    this.instanceCounts.set(this.currentShape, instanceId + 1);
    mesh.count = Math.min(instanceId + 1, this.maxInstances);

    return particle;
  }

  private calculateSpeed(volumeUsd: number): number {
    // CONTAINER APPROACH: Fall speed (downward velocity)
    // Bigger trades fall faster (like heavier objects)
    return 2.0 + Math.log10(Math.max(1, volumeUsd)) * 0.3;
  }

  private calculateSize(volumeUsd: number): number {
    // ALWAYS proportional to trade volume - LARGER for visibility
    const baseSize = 0.8 + Math.log10(Math.max(1, volumeUsd)) * 0.8;
    return Math.min(baseSize * this.sizeMultiplier, 12); // Cap at 12 units
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

  update(deltaTime: number, blockBuilder: any) {
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (const particle of this.particles.values()) {
      // Update lifetime (only for unlocked particles - locked ones are safe)
      if (!particle.locked) {
        particle.lifetime += deltaTime;

        // Orphan cleanup: Remove unlocked particles after 500ms
        if (particle.lifetime > particle.maxLifetime) {
          if (Math.random() < 0.05) console.log(`♻️ Removing orphan particle ${particle.id.slice(0,6)} from slot ${particle.slot} (500ms timeout)`);
          this.particles.delete(particle.id);
          continue;
        }
      }

      // Safety: Remove particles that fell way below the floor
      if (particle.position.y < -50) {
        if (Math.random() < 0.01) console.log(`🗑️ Removing fallen particle from slot ${particle.slot}`);
        this.particles.delete(particle.id);
        continue;
      }

      if (!particle.locked) {
        // Check if this particle's block is sweeping - if so, FORCE LOCK immediately
        if (blockBuilder.isBlockSweeping(particle.slot)) {
          const forceLockResult = blockBuilder.forceLockParticle(particle.id, particle.slot, particle.position);
          if (forceLockResult.locked && forceLockResult.gridPosition) {
            particle.locked = true;
            particle.lockedPosition.copy(forceLockResult.gridPosition);
            particle.velocity.set(0, 0, 0);
            if (Math.random() < 0.05) {
              console.log(`⚡ Force-locked particle ${particle.id.slice(0,6)} to sweeping block ${particle.slot}`);
            }
          }
        } else {
          // CONTAINER APPROACH: Particles rain down, maintaining their downward velocity
          // They DON'T recalculate toward center - they fall straight down

          // Update position - particles fall with their initial velocity
          particle.position.add(
            particle.velocity.clone().multiplyScalar(deltaTime * 0.05) // Slower fall for visibility
          );

          // CONTAINER LOGIC: Lock when particle has fallen deep into the block
          // Block is at (0,0,0) with size 30, so ranges from -15 to +15 in all directions
          // Lock when: particle is INSIDE the block's X/Z footprint AND has fallen far enough

          const blockHalfSize = 15;
          const isInsideXZ = Math.abs(particle.position.x) < blockHalfSize &&
                             Math.abs(particle.position.z) < blockHalfSize;
          // Lock when particle has fallen into lower portion - but higher than before for fuller look
          const hasFallenInside = particle.position.y < 5; // Lock once fallen to middle/lower area

          // Stop particles from falling through the bottom
          if (particle.position.y < -blockHalfSize) {
            particle.position.y = -blockHalfSize;
            particle.velocity.y = 0; // Stop falling
          }

          if (isInsideXZ && hasFallenInside) {
            // Particle is inside container and has settled to bottom - lock it
            const lockResult = blockBuilder.lockParticle(particle.id, particle.slot, particle.position);
            if (lockResult.locked && lockResult.gridPosition) {
              particle.locked = true;
              particle.lockedPosition.copy(lockResult.gridPosition);
              particle.velocity.set(0, 0, 0);
            }
          }
        }
      } else {
        // Locked particles move WITH their block
        const blockPosition = blockBuilder.getBlockPosition(particle.slot);
        if (blockPosition) {
          // Particle world position = block position + relative offset
          particle.position.copy(blockPosition).add(particle.lockedPosition);
        }
      }

      // No rotation - keep particles stable

      // Fade out near end of life (only for unlocked particles)
      const lifeFactor = particle.locked ? 1.0 : (1.0 - (particle.lifetime / particle.maxLifetime));

      // Update instance matrix
      matrix.makeRotationFromEuler(particle.rotation);
      matrix.scale(new THREE.Vector3(
        particle.size * lifeFactor,
        particle.size * lifeFactor,
        particle.size * lifeFactor
      ));
      matrix.setPosition(particle.position);

      particle.mesh.setMatrixAt(particle.instanceId, matrix);

      // Set color - VERY BRIGHT for vibrant vaporwave look
      const brightColor = particle.color.clone().multiplyScalar(3.0); // 3x brightness!
      particle.mesh.setColorAt(particle.instanceId, brightColor);
    }

    // Update all meshes
    for (const mesh of this.instancedMeshes.values()) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  // Remove ALL particles belonging to a specific slot
  removeParticlesForSlot(slot: number) {
    const toRemove: string[] = [];
    for (const [id, particle] of this.particles) {
      if (particle.slot === slot) {
        toRemove.push(id);
      }
    }

    console.log(`🗑️ Removing ${toRemove.length} particles for slot ${slot}`);
    for (const id of toRemove) {
      this.particles.delete(id);
    }
  }

  // Debug: Get particle stats by slot
  getStats() {
    let locked = 0;
    let unlocked = 0;
    const bySlot = new Map<number, number>();

    for (const p of this.particles.values()) {
      if (p.locked) locked++;
      else unlocked++;
      bySlot.set(p.slot, (bySlot.get(p.slot) || 0) + 1);
    }

    return {
      total: this.particles.size,
      locked,
      unlocked,
      slots: Array.from(bySlot.entries()).slice(0, 5) // Show top 5 slots
    };
  }

  getParticlesForBlock(): Particle[] {
    return Array.from(this.particles.values());
  }

  clear() {
    this.particles.clear();
  }
}
