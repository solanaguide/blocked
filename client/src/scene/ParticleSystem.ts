import * as THREE from 'three';
import type { TradeMessage } from '../../../shared/types';
import type { Particle, FocusMode } from '../types';
import vertexShader from './shaders/particle.vert';
import fragmentShader from './shaders/particle.frag';

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: Map<string, Particle> = new Map();

  private points!: THREE.Points;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;

  private positions!: Float32Array;
  private colors!: Float32Array;
  private sizes!: Float32Array;

  private maxParticles = 10000;
  private particleCount = 0;
  private particleIndex = 0;

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
    console.log('Initializing ParticleSystem...');
    this.scene = scene;

    this.init();
  }

  private init() {
    console.log('ParticleSystem init...');
    this.geometry = new THREE.BufferGeometry();

    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true,
      // vertexColors removed - we handle colors manually in shader
    });

    console.log('🎨 ShaderMaterial created, vertex shader length:', vertexShader.length, 'fragment shader length:', fragmentShader.length);

    this.points = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.points);

    console.log('🔵 Points object created and added to scene. Geometry has', this.maxParticles, 'max particles');
  }

  setFocusMode(mode: FocusMode) {
    this.focusMode = mode;
    this.updateAllParticles();
  }

  setSizeMultiplier(multiplier: number) {
    this.sizeMultiplier = Math.max(0.1, Math.min(5.0, multiplier));
    this.updateAllParticles();
  }

  addTrade(trade: TradeMessage, slot: number) {
    const blockSize = 30;
    const spawnHeight = 25 + Math.random() * 10;
    const spreadX = (Math.random() - 0.5) * blockSize * 1.0;
    const spreadZ = (Math.random() - 0.5) * blockSize * 1.0;

    const position = new THREE.Vector3(spreadX, spawnHeight, spreadZ);
    const speed = this.calculateSpeed(trade.vu);
    const velocity = new THREE.Vector3(-spreadX * 0.01, -speed, -spreadZ * 0.01);
    const size = this.calculateSize(trade.vu);
    const color = new THREE.Color(this.calculateColor(trade));

    const particle: Particle = {
      id: trade.sig,
      slot,
      position,
      velocity,
      size,
      color,
      lifetime: 0,
      maxLifetime: 500,
      trade,
      locked: false,
      lockedPosition: new THREE.Vector3(),
      index: this.particleIndex,
    };

    this.particles.set(particle.id, particle);

    this.positions[this.particleIndex * 3] = position.x;
    this.positions[this.particleIndex * 3 + 1] = position.y;
    this.positions[this.particleIndex * 3 + 2] = position.z;

    this.colors[this.particleIndex * 3] = color.r;
    this.colors[this.particleIndex * 3 + 1] = color.g;
    this.colors[this.particleIndex * 3 + 2] = color.b;

    this.sizes[this.particleIndex] = size;

    // Removed frequent logging - enable for debugging
    // if (Math.random() < 0.001) {
    //   console.log(`✨ Added particle ${this.particleIndex}: pos(${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}), size ${size.toFixed(1)}, color(${color.r.toFixed(2)}, ${color.g.toFixed(2)}, ${color.b.toFixed(2)}), count: ${this.particleCount}`);
    // }

    this.particleIndex = (this.particleIndex + 1) % this.maxParticles;
    if (this.particleCount < this.maxParticles) {
      this.particleCount++;
    }
  }

  update(deltaTime: number, blockBuilder: any) {
    for (const particle of this.particles.values()) {
      if (!particle.locked) {
        particle.lifetime += deltaTime;

        if (particle.lifetime > particle.maxLifetime) {
          this.particles.delete(particle.id);
          continue;
        }

        particle.position.add(particle.velocity.clone().multiplyScalar(deltaTime * 0.05));

        const blockHalfSize = 15;
        const isInsideXZ = Math.abs(particle.position.x) < blockHalfSize && Math.abs(particle.position.z) < blockHalfSize;

        if (isInsideXZ) {
          const cellSize = 4.0;
          const stackHeight = blockBuilder.getStackHeightAt(particle.slot, particle.position.x, particle.position.z, cellSize);
          const landingHeight = stackHeight + cellSize;

          if (particle.position.y <= landingHeight) {
            particle.position.y = landingHeight;
            const lockResult = blockBuilder.lockParticle(particle.id, particle.slot, particle.position);
            if (lockResult.locked && lockResult.gridPosition) {
              particle.locked = true;
              particle.lockedPosition.copy(lockResult.gridPosition);
              particle.velocity.set(0, 0, 0);
            }
          }
        }

        if (particle.position.y < -blockHalfSize) {
          particle.position.y = -blockHalfSize;
          particle.velocity.y = 0;
        }
      } else {
        const blockPosition = blockBuilder.getBlockPosition(particle.slot);
        if (blockPosition) {
          particle.position.copy(blockPosition).add(particle.lockedPosition);
        }
      }

      const index = particle.index;
      this.positions[index * 3] = particle.position.x;
      this.positions[index * 3 + 1] = particle.position.y;
      this.positions[index * 3 + 2] = particle.position.z;

      this.colors[index * 3] = particle.color.r;
      this.colors[index * 3 + 1] = particle.color.g;
      this.colors[index * 3 + 2] = particle.color.b;

      this.sizes[index] = particle.size;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.setDrawRange(0, this.particleCount);

    // Removed frequent logging - enable for debugging
    // if (Math.random() < 0.001) {
    //   console.log(`🔵 Points update: ${this.particles.size} particles in map, draw range: 0-${this.particleCount}, points visible: ${this.points.visible}`);
    // }
  }

  private calculateSpeed(volumeUsd: number): number {
    return 2.0 + Math.log10(Math.max(1, volumeUsd)) * 0.3;
  }

  private calculateSize(volumeUsd: number): number {
    const baseSize = 0.8 + Math.log10(Math.max(1, volumeUsd)) * 0.8;
    return Math.min(baseSize * this.sizeMultiplier, 12);
  }

  private calculateColor(trade: TradeMessage): number {
    let color: number;

    switch (this.focusMode) {
      case 'program':
        color = this.programColors.get(trade.p) || 0xffffff;
        return color;
      case 'token':
        color = this.tokenColors.get(trade.ta) || this.hashColor(trade.ta);
        return color;
      case 'volume':
        if (trade.vu < 10) color = 0x00ffff;
        else if (trade.vu < 50) color = 0x0099ff;
        else if (trade.vu < 200) color = 0x8b5cf6;
        else if (trade.vu < 1000) color = 0xff1493;
        else if (trade.vu < 5000) color = 0xff006e;
        else color = 0xff3333;
        return color;
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
    return (hash & 0x00FFFFFF) | 0x404040;
  }

  private updateAllParticles() {
    for (const particle of this.particles.values()) {
      particle.size = this.calculateSize(particle.trade.vu);
      particle.color.set(this.calculateColor(particle.trade));
    }
  }

  removeParticlesForSlot(slot: number) {
    const toRemove: string[] = [];
    for (const [id, particle] of this.particles) {
      if (particle.slot === slot) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.particles.delete(id);
    }
  }

  getParticlesForBlock(): Particle[] {
    return Array.from(this.particles.values());
  }

  clear() {
    this.particles.clear();
    this.particleCount = 0;
    this.particleIndex = 0;
  }
}
