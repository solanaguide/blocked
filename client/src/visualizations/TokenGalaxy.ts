import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { tokenColors, hashColor } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * TokenGalaxy - Orbital particle system with SOL at center
 *
 * CONCEPT: Solar system where SOL is the sun at center, major tokens orbit close,
 * and other top tokens orbit further out based on their trading volume.
 * - SOL = Central sun
 * - USDC/USDT = Inner planets (close orbit)
 * - Top 25 tokens = Planets at various orbital distances based on volume rank
 * - Each trade = particle orbiting that token's orbital path
 * - Particle SIZE = trade volume (log scale)
 * - Block complete = Nova burst from SOL sun
 */
export class TokenGalaxy extends BaseVisualization {
  private particles: Map<string, TradeParticle[]> = new Map();
  private tokenOrbits: Map<string, TokenOrbit> = new Map();
  private sun: THREE.Mesh;
  private sunGlow: THREE.PointLight;
  private cameraAngle: number = 0;
  private blockPulse: number = 0;
  private maxTokens = 25;

  // Major tokens get fixed orbital positions
  private majorTokens = new Map<string, number>([
    ['SOL', 0],      // Center (sun)
    ['USDC', 8],     // Close orbit
    ['USDT', 12],    // Close orbit
  ]);

  constructor() {
    super();

    // Zoom out camera to see more tokens
    this.camera.position.set(0, 40, 80);
    this.camera.lookAt(0, 0, 0);

    // Create central SOL sun (larger, more prominent)
    const sunGeometry = new THREE.SphereGeometry(6, 32, 32);
    const sunMaterial = new THREE.MeshStandardMaterial({
      color: 0x9945ff,  // SOL purple
      emissive: 0x9945ff,
      emissiveIntensity: 2.5,
    });
    this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
    this.scene.add(this.sun);

    // Sun glow
    this.sunGlow = new THREE.PointLight(0x9945ff, 5, 150);
    this.scene.add(this.sunGlow);

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.2);
    this.scene.add(ambientLight);

    // Stars
    this.createStarfield();
  }

  private createStarfield(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 800;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 300;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 300;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 300;
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      transparent: true,
      opacity: 0.6,
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(stars);
  }

  private updateTokenOrbits(): void {
    if (!this.dataProcessor) return;

    // Get top tokens from DataProcessor
    const topTokens = this.dataProcessor.getTopTokens(this.maxTokens);
    const tokenVolumes = this.dataProcessor.getTokenVolumes();

    // Update orbits for all top tokens
    topTokens.forEach((token, index) => {
      if (!this.tokenOrbits.has(token)) {
        // Calculate orbital radius
        let orbitRadius: number;

        if (this.majorTokens.has(token)) {
          // Major tokens get fixed positions
          orbitRadius = this.majorTokens.get(token)!;
        } else {
          // Other tokens orbit further out, spaced by rank
          const majorCount = Array.from(this.majorTokens.keys()).filter(t => topTokens.includes(t)).length;
          const nonMajorIndex = index - majorCount;
          orbitRadius = 16 + nonMajorIndex * 3; // Start at 16, space by 3 units
        }

        const color = tokenColors.get(token) || hashColor(token);

        this.tokenOrbits.set(token, {
          token,
          orbitRadius,
          color,
          volume: tokenVolumes.get(token) || 0,
        });
      }
    });

    // Remove orbits for tokens no longer in top list
    const topTokenSet = new Set(topTokens);
    this.tokenOrbits.forEach((orbit, token) => {
      if (!topTokenSet.has(token) && !this.majorTokens.has(token)) {
        this.tokenOrbits.delete(token);
      }
    });
  }

  getName(): string {
    return 'Token Galaxy';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const token = trade.ta || 'UNKNOWN'; // Use token_a as primary token
    const volume = trade.vu;

    // Update orbits periodically
    const time = this.clock.getElapsedTime();
    if (Math.floor(time * 2) % 10 === 0 && Math.floor(time * 20) % 20 === 0) {
      this.updateTokenOrbits();
    }

    // Only show particles for tokens we're tracking
    if (!this.tokenOrbits.has(token)) return;

    if (!this.particles.has(token)) {
      this.particles.set(token, []);
    }

    const orbit = this.tokenOrbits.get(token)!;
    const color = orbit.color;
    const size = Math.min(2, 0.5 + Math.log10(Math.max(1, volume)) * 0.2);

    const geometry = new THREE.SphereGeometry(size, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.8,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Calculate orbit parameters
    const orbitSpeed = 0.3 + Math.random() * 0.4;
    const orbitAngle = Math.random() * Math.PI * 2;
    const orbitTilt = (Math.random() - 0.5) * Math.PI * 0.4;

    // Position particle on orbit
    const x = Math.cos(orbitAngle) * orbit.orbitRadius;
    const y = Math.sin(orbitTilt) * orbit.orbitRadius * 0.2;
    const z = Math.sin(orbitAngle) * orbit.orbitRadius;

    mesh.position.set(x, y, z);

    // Add trail
    const trailGeometry = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(15 * 3);
    for (let i = 0; i < 15; i++) {
      trailPositions[i * 3] = x;
      trailPositions[i * 3 + 1] = y;
      trailPositions[i * 3 + 2] = z;
    }
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));

    const trailMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.3,
    });

    const trail = new THREE.Line(trailGeometry, trailMaterial);

    this.scene.add(mesh);
    this.scene.add(trail);

    this.particles.get(token)!.push({
      mesh,
      trail,
      orbitRadius: orbit.orbitRadius,
      orbitSpeed,
      orbitAngle,
      orbitTilt,
      trailPositions: [],
      lifetime: 8000,
      age: 0,
    });
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    console.log(`🌌 Block ${newSlot} complete - ${blockData.trades} trades`);

    // Nova burst from SOL sun
    this.blockPulse = 2.0;
    this.sunGlow.intensity = 15.0;
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Update all particles
    this.particles.forEach((particles, token) => {
      particles.forEach((particle, index) => {
        // Age particle
        particle.age += deltaTime;

        // Update orbit
        particle.orbitAngle += particle.orbitSpeed * deltaTime * 0.001;

        const x = Math.cos(particle.orbitAngle) * particle.orbitRadius;
        const y = Math.sin(particle.orbitTilt) * particle.orbitRadius * 0.2;
        const z = Math.sin(particle.orbitAngle) * particle.orbitRadius;

        particle.mesh.position.set(x, y, z);

        // Update trail
        particle.trailPositions.unshift({ x, y, z });
        if (particle.trailPositions.length > 15) {
          particle.trailPositions.pop();
        }

        const trailPositions = particle.trail.geometry.attributes.position.array as Float32Array;
        particle.trailPositions.forEach((pos, i) => {
          trailPositions[i * 3] = pos.x;
          trailPositions[i * 3 + 1] = pos.y;
          trailPositions[i * 3 + 2] = pos.z;
        });
        particle.trail.geometry.attributes.position.needsUpdate = true;

        // Fade out as particle ages
        const fadeStart = particle.lifetime * 0.7;
        if (particle.age > fadeStart) {
          const fadeProgress = (particle.age - fadeStart) / (particle.lifetime - fadeStart);
          (particle.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - fadeProgress;
          (particle.mesh.material as THREE.Material).transparent = true;
          (particle.trail.material as THREE.LineBasicMaterial).opacity = 0.3 * (1 - fadeProgress);
        }

        // Remove old particles
        if (particle.age > particle.lifetime) {
          this.scene.remove(particle.mesh);
          this.scene.remove(particle.trail);
          particle.mesh.geometry.dispose();
          (particle.mesh.material as THREE.Material).dispose();
          particle.trail.geometry.dispose();
          (particle.trail.material as THREE.Material).dispose();
          particles.splice(index, 1);
        }
      });
    });

    // Rotate sun
    this.sun.rotation.y += deltaTime * 0.0005;

    // Pulse effect from block change
    if (this.blockPulse > 0) {
      this.blockPulse *= 0.92;
      const scale = 1 + this.blockPulse * 0.4;
      this.sun.scale.set(scale, scale, scale);
      (this.sun.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.5 + this.blockPulse * 3;
    }

    // Decay sun glow
    if (this.sunGlow.intensity > 5) {
      this.sunGlow.intensity *= 0.95;
    }

    // Orbit camera around the galaxy
    this.cameraAngle += deltaTime * 0.0002;
    const cameraDistance = 80;
    this.camera.position.x = Math.cos(this.cameraAngle) * cameraDistance;
    this.camera.position.z = Math.sin(this.cameraAngle) * cameraDistance;
    this.camera.position.y = 40 + Math.sin(time * 0.1) * 8;
    this.camera.lookAt(0, 0, 0);
  }

  dispose(): void {
    this.particles.forEach(particles => {
      particles.forEach(particle => {
        this.scene.remove(particle.mesh);
        this.scene.remove(particle.trail);
        particle.mesh.geometry.dispose();
        (particle.mesh.material as THREE.Material).dispose();
        particle.trail.geometry.dispose();
        (particle.trail.material as THREE.Material).dispose();
      });
    });
    this.particles.clear();
    this.tokenOrbits.clear();

    super.dispose();
  }
}

interface TokenOrbit {
  token: string;
  orbitRadius: number;
  color: number;
  volume: number;
}

interface TradeParticle {
  mesh: THREE.Mesh;
  trail: THREE.Line;
  orbitRadius: number;
  orbitSpeed: number;
  orbitAngle: number;
  orbitTilt: number;
  trailPositions: Array<{ x: number; y: number; z: number }>;
  lifetime: number;
  age: number;
}
