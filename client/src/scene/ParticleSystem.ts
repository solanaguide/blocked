import * as THREE from 'three';
import type { TradeMessage } from '../../../shared/types';
import type { Particle, ParticleShape, FocusMode } from '../types';
import { programColors, tokenColors, hashColor, volumeHeatmap } from '../utils/colors';

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: Map<string, Particle> = new Map();
  private particlePool: Particle[] = [];

  // Instanced meshes for each geometry type
  private instancedMeshes: Map<ParticleShape, THREE.InstancedMesh> = new Map();
  private geometries: Map<ParticleShape, THREE.BufferGeometry> = new Map();
  private material: THREE.MeshStandardMaterial;

  // Instance tracking
  private maxInstances = 10000; // Increased for high-throughput scenarios

  private currentShape: ParticleShape = 'cube';
  private focusMode: FocusMode = 'program'; // Default to program for more color variety
  private sizeMultiplier = 1.0;

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
    // Custom shader for per-instance colors on InstancedMesh
    const vertexShader = `
      varying vec3 vColor;

      void main() {
        vColor = instanceColor; // Use instance color
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      varying vec3 vColor;

      void main() {
        gl_FragColor = vec4(vColor, 1.0);
      }
    `;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      toneMapped: false,
    }) as any;

    console.log('🎨 ShaderMaterial created for InstancedMesh with per-instance colors');
  }

  private createInstancedMeshes() {
    for (const [shape, geometry] of this.geometries) {
      const mesh = new THREE.InstancedMesh(
        geometry,
        this.material,
        this.maxInstances
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      // CRITICAL: Initialize instance colors buffer
      // Without this, setColorAt() calls are ignored!
      const colors = new Float32Array(this.maxInstances * 3);
      // Initialize all to white
      for (let i = 0; i < this.maxInstances; i++) {
        colors[i * 3] = 1.0;     // R
        colors[i * 3 + 1] = 1.0; // G
        colors[i * 3 + 2] = 1.0; // B
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

      mesh.count = 0; // Start with no instances
      this.scene.add(mesh);
      this.instancedMeshes.set(shape, mesh);

      console.log(`🎨 Created ${shape} mesh with instanceColor buffer:`, mesh.instanceColor !== null);
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
    particle.maxLifetime = 5000; // 5000ms - plenty of time for particles to fall and sweep offscreen
    particle.trade = trade;
    particle.locked = false;
    particle.lockedPosition.set(0, 0, 0);

    this.particles.set(particle.id, particle);
  }

  private createNewParticle(slot: number): Particle {
    const mesh = this.instancedMeshes.get(this.currentShape)!;

    // SIMPLE APPROACH: Just count active particles to get next instance ID
    // This ensures instance IDs are packed at the beginning (0, 1, 2, ...)
    // which matches mesh.count perfectly
    let instanceId = 0;
    for (const p of this.particles.values()) {
      if (p.mesh === mesh) {
        instanceId++;
      }
    }

    if (instanceId >= this.maxInstances) {
      console.warn(`⚠️ Hit max instances (${this.maxInstances})!`);
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

    // Update mesh.count to include this new particle
    mesh.count = instanceId + 1;

    return particle;
  }

  private calculateSpeed(volumeUsd: number): number {
    // CONTAINER APPROACH: Fall speed (downward velocity)
    // Bigger trades fall faster (like heavier objects)
    // Doubled for faster particle descent
    return 4.0 + Math.log10(Math.max(1, volumeUsd)) * 0.6;
  }

  private calculateSize(volumeUsd: number): number {
    // ALWAYS proportional to trade volume - LARGER for visibility
    const baseSize = 0.8 + Math.log10(Math.max(1, volumeUsd)) * 0.8;
    return Math.min(baseSize * this.sizeMultiplier, 12); // Cap at 12 units
  }

  private calculateColor(trade: TradeMessage): number {
    let color: number;

    switch (this.focusMode) {
      case 'program':
        color = programColors.get(trade.p) || 0xffffff;
        if (Math.random() < 0.01) {
          console.log(`🎨 PROGRAM mode: ${trade.p} → 0x${color.toString(16)}`);
        }
        return color;

      case 'token':
        color = tokenColors.get(trade.ta) || hashColor(trade.ta);
        if (Math.random() < 0.01) {
          console.log(`🎨 TOKEN mode: ${trade.ta} → 0x${color.toString(16)}`);
        }
        return color;

      case 'volume':
        // Smooth gradient heatmap based on trade volume
        color = volumeHeatmap(trade.vu);

        if (Math.random() < 0.01) {
          console.log(`🎨 VOLUME mode: $${trade.vu.toFixed(2)} → 0x${color.toString(16)}`);
        }
        return color;

      case 'free':
      default:
        if (Math.random() < 0.01) {
          console.log(`🎨 FREE mode: white (0xffffff)`);
        }
        return 0xffffff;
    }
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

        // Orphan cleanup: Remove unlocked particles after 5000ms (plenty of time to fall and sweep)
        if (particle.lifetime > 5000) {
          if (Math.random() < 0.05) console.log(`♻️ Removing orphan particle ${particle.id.slice(0,6)} from slot ${particle.slot} (5000ms timeout)`);
          this.deleteParticle(particle.id);
          continue;
        }
      }

      // Safety: Remove particles that fell way below the floor
      if (particle.position.y < -50) {
        if (Math.random() < 0.01) console.log(`🗑️ Removing fallen particle from slot ${particle.slot}`);
        this.deleteParticle(particle.id);
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
            particle.velocity.clone().multiplyScalar(deltaTime * 0.1) // Doubled fall speed
          );

          // PHYSICS-STYLE STACKING: Check if particle should land on other particles
          const blockHalfSize = 15;
          const isInsideXZ = Math.abs(particle.position.x) < blockHalfSize &&
                             Math.abs(particle.position.z) < blockHalfSize;

          if (isInsideXZ) {
            // Get height of stack at this X/Z position
            const cellSize = 3.0; // Reduced for tighter stacking that reaches block top
            const stackHeight = blockBuilder.getStackHeightAt(particle.slot, particle.position.x, particle.position.z, cellSize);
            const landingHeight = stackHeight + cellSize; // Land on top of stack

            // Check if particle has reached landing height
            if (particle.position.y <= landingHeight) {
              // Particle should lock here - either on floor or on top of other particles
              particle.position.y = landingHeight; // Snap to landing height

              const lockResult = blockBuilder.lockParticle(particle.id, particle.slot, particle.position);
              if (lockResult.locked && lockResult.gridPosition) {
                particle.locked = true;
                particle.lockedPosition.copy(lockResult.gridPosition);
                particle.velocity.set(0, 0, 0);
              } else {
                // Failed to lock - log occasionally for debugging
                if (Math.random() < 0.01) {
                  console.warn(`⚠️ Particle ${particle.id.slice(0,6)} (slot ${particle.slot}) failed to lock at landing height`);
                }
              }
            }
          }

          // Stop particles from falling through the bottom
          if (particle.position.y < -blockHalfSize) {
            particle.position.y = -blockHalfSize;
            particle.velocity.y = 0;
          }
        }
      } else {
        // Locked particles move WITH their block
        const blockPosition = blockBuilder.getBlockPosition(particle.slot);
        if (blockPosition) {
          // Particle world position = block position + relative offset
          particle.position.copy(blockPosition).add(particle.lockedPosition);

          // Clean up particles that swept too far off screen
          if (particle.position.x > 130) {
            if (Math.random() < 0.05) {
              console.log(`🗑️ Removing particle ${particle.id.slice(0,6)} - swept off screen at x=${particle.position.x.toFixed(1)}`);
            }
            this.deleteParticle(particle.id);
            continue;
          }
        } else {
          // BUG FIX: Block doesn't exist anymore - this is an orphaned locked particle!
          // This happens if a block was removed before cleanup triggered
          console.warn(`⚠️ Orphan locked particle ${particle.id.slice(0,6)} for slot ${particle.slot} - block missing, removing`);
          this.deleteParticle(particle.id);
          continue;
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

      // Set color - pure vibrant colors (no multiplier needed with MeshBasicMaterial)
      particle.mesh.setColorAt(particle.instanceId, particle.color);

      // Debug: log color setting occasionally
      if (Math.random() < 0.001) {
        console.log(`🎨 Setting color on instance ${particle.instanceId}:`, particle.color.getHexString(), 'focus:', this.focusMode);
      }
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
      this.deleteParticle(id);
    }

    // CRITICAL: After bulk delete, recalculate mesh.count
    if (toRemove.length > 0) {
      this.recalculateMeshCounts();
    }
  }

  // SIMPLE CLEANUP: Remove all particles older than a given slot
  removeParticlesOlderThan(minSlot: number) {
    const toRemove: string[] = [];
    for (const [id, particle] of this.particles) {
      if (particle.slot < minSlot) {
        toRemove.push(id);
      }
    }

    if (toRemove.length > 0) {
      console.log(`🧹 Cleaning up ${toRemove.length} old particles (slots < ${minSlot})`);
      for (const id of toRemove) {
        this.deleteParticle(id);
      }

      // CRITICAL: After bulk delete, recalculate mesh.count for all meshes
      this.recalculateMeshCounts();
    }
  }

  private getShapeForMesh(mesh: THREE.InstancedMesh): ParticleShape | undefined {
    for (const [shape, shapeMesh] of this.instancedMeshes) {
      if (shapeMesh === mesh) {
        return shape;
      }
    }
    return undefined;
  }

  private deleteParticle(particleId: string) {
    const particle = this.particles.get(particleId);
    if (particle) {
      // CRITICAL: Move instance FAR away offscreen (scaling to 0 doesn't work reliably)
      const matrix = new THREE.Matrix4();
      matrix.setPosition(new THREE.Vector3(10000, 10000, 10000)); // Far offscreen
      matrix.scale(new THREE.Vector3(0.001, 0.001, 0.001)); // Tiny just in case
      particle.mesh.setMatrixAt(particle.instanceId, matrix);
      particle.mesh.instanceMatrix.needsUpdate = true;

      // Also set color to transparent/black
      const transparent = new THREE.Color(0x000000);
      particle.mesh.setColorAt(particle.instanceId, transparent);
      if (particle.mesh.instanceColor) {
        particle.mesh.instanceColor.needsUpdate = true;
      }

      // Log occasionally to verify this is being called
      if (Math.random() < 0.01) {
        console.log(`🗑️ Hiding instance ${particle.instanceId} for particle ${particleId.slice(0,6)}`);
      }

      this.particles.delete(particleId);

      // NOTE: mesh.count is NOT updated here - that's done in bulk via recalculateMeshCounts()
    }
  }

  // Recalculate mesh.count for all meshes based on active particles
  // This tells Three.js how many instances to actually render
  private recalculateMeshCounts() {
    // Count active particles per shape
    const countsPerShape = new Map<ParticleShape, number>();
    for (const shape of this.instancedMeshes.keys()) {
      countsPerShape.set(shape, 0);
    }

    for (const particle of this.particles.values()) {
      const shape = this.getShapeForMesh(particle.mesh);
      if (shape) {
        countsPerShape.set(shape, (countsPerShape.get(shape) || 0) + 1);
      }
    }

    // Update mesh.count to match actual particle count
    for (const [shape, mesh] of this.instancedMeshes) {
      const oldCount = mesh.count;
      const newCount = countsPerShape.get(shape) || 0;
      mesh.count = newCount;

      if (oldCount !== newCount) {
        console.log(`📉 Updated ${shape} mesh.count: ${oldCount} → ${newCount}`);
      }
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

    // Report mesh.count for current shape
    const mesh = this.instancedMeshes.get(this.currentShape);
    const meshCount = mesh?.count || 0;

    return {
      total: this.particles.size,
      locked,
      unlocked,
      slots: Array.from(bySlot.entries()).slice(0, 5), // Show top 5 slots
      meshCount: meshCount
    };
  }

  getParticlesForBlock(): Particle[] {
    return Array.from(this.particles.values());
  }

  // Debug a specific particle instance when clicked
  debugParticleInstance(mesh: THREE.InstancedMesh, instanceId: number) {
    // Find which shape this mesh belongs to
    const shape = this.getShapeForMesh(mesh);
    if (!shape) {
      console.error('❌ Unknown mesh - not tracked by particle system');
      return;
    }

    console.log('Shape:', shape);

    // Find the particle with this instance ID
    let foundParticle: Particle | null = null;
    for (const particle of this.particles.values()) {
      if (particle.instanceId === instanceId && particle.mesh === mesh) {
        foundParticle = particle;
        break;
      }
    }

    if (foundParticle) {
      console.log('✅ Found active particle:');
      console.log('  ID:', foundParticle.id);
      console.log('  Slot:', foundParticle.slot);
      console.log('  Current slot:', this.particles.values().next().value?.slot, '(for comparison)');
      console.log('  Position:', foundParticle.position);
      console.log('  Locked:', foundParticle.locked);
      console.log('  Locked position:', foundParticle.lockedPosition);
      console.log('  Lifetime:', foundParticle.lifetime, '/', foundParticle.maxLifetime);
      console.log('  Velocity:', foundParticle.velocity);
      console.log('  Size:', foundParticle.size);
      console.log('  Color:', foundParticle.color.getHexString());
      console.log('  Trade volume:', foundParticle.trade?.vu);
    } else {
      console.error('❓ MYSTERY: Instance not in active particles map');
      console.log('This instance is being rendered but has no particle data');
    }

    // Show overall stats
    const stats = this.getStats();
    console.log('Overall stats:', stats);
  }

  clear() {
    this.particles.clear();
  }
}
