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
  private focusMode: FocusMode = 'program'; // Default to program for more color variety
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
      this.instanceCounts.set(shape, 0);

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
    particle.maxLifetime = 1000; // 1000ms - increased to allow particles time to fall
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
    let color: number;

    switch (this.focusMode) {
      case 'program':
        color = this.programColors.get(trade.p) || 0xffffff;
        if (Math.random() < 0.01) {
          console.log(`🎨 PROGRAM mode: ${trade.p} → 0x${color.toString(16)}`);
        }
        return color;

      case 'token':
        color = this.tokenColors.get(trade.ta) || this.hashColor(trade.ta);
        if (Math.random() < 0.01) {
          console.log(`🎨 TOKEN mode: ${trade.ta} → 0x${color.toString(16)}`);
        }
        return color;

      case 'volume':
        // Heat map: blue -> cyan -> purple -> pink -> red
        // Adjusted thresholds for better distribution
        if (trade.vu < 10) color = 0x00ffff;       // Cyan (micro trades)
        else if (trade.vu < 50) color = 0x0099ff;  // Blue
        else if (trade.vu < 200) color = 0x8b5cf6; // Purple
        else if (trade.vu < 1000) color = 0xff1493; // Deep Pink
        else if (trade.vu < 5000) color = 0xff006e; // Hot Pink
        else color = 0xff3333;                      // Red (whales)

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

        // Orphan cleanup: Remove unlocked particles after 1000ms (increased to allow time to fall)
        if (particle.lifetime > 1000) {
          if (Math.random() < 0.05) console.log(`♻️ Removing orphan particle ${particle.id.slice(0,6)} from slot ${particle.slot} (1000ms timeout)`);
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
        // Check if this particle's block is sweeping
        if (blockBuilder.isBlockSweeping(particle.slot)) {
          // Only force-lock if particle is INSIDE or NEAR the container
          // Otherwise just remove it (it never made it in time)
          const blockHalfSize = 15;
          const isNearBlock = Math.abs(particle.position.x) < blockHalfSize * 1.5 &&
                              Math.abs(particle.position.z) < blockHalfSize * 1.5 &&
                              particle.position.y < 10; // Must have fallen close to block

          if (isNearBlock) {
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
            // Particle never made it - remove it instead of orphaning
            if (Math.random() < 0.05) {
              console.log(`🚫 Removing particle ${particle.id.slice(0,6)} - didn't make it to block ${particle.slot} in time`);
            }
            this.particles.delete(particle.id);
            continue;
          }
        } else {
          // CONTAINER APPROACH: Particles rain down, maintaining their downward velocity
          // They DON'T recalculate toward center - they fall straight down

          // Update position - particles fall with their initial velocity
          particle.position.add(
            particle.velocity.clone().multiplyScalar(deltaTime * 0.05) // Slower fall for visibility
          );

          // PHYSICS-STYLE STACKING: Check if particle should land on other particles
          const blockHalfSize = 15;
          const isInsideXZ = Math.abs(particle.position.x) < blockHalfSize &&
                             Math.abs(particle.position.z) < blockHalfSize;

          if (isInsideXZ) {
            // Get height of stack at this X/Z position
            const cellSize = 4.0;
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
            this.particles.delete(particle.id);
            continue;
          }
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
