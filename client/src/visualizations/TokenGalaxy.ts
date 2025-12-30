import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { tokenColors, hashColor } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * TokenGalaxy - Orbital particle system
 * SOL at center, other tokens orbit around it
 */
export class TokenGalaxy extends BaseVisualization {
  private particles: Map<string, TradeParticle[]> = new Map();
  private sun: THREE.Mesh;
  private sunGlow: THREE.PointLight;
  private cameraAngle: number = 0;
  private blockPulse: number = 0;

  constructor() {
    super();

    // Dynamic camera orbit
    this.camera.position.set(0, 30, 50);
    this.camera.lookAt(0, 0, 0);

    // Create central SOL sun
    const sunGeometry = new THREE.SphereGeometry(5, 32, 32);
    const sunMaterial = new THREE.MeshStandardMaterial({
      color: 0x9945ff,
      emissive: 0x9945ff,
      emissiveIntensity: 2.0,
    });
    this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
    this.scene.add(this.sun);

    // Sun glow
    this.sunGlow = new THREE.PointLight(0x9945ff, 3, 100);
    this.scene.add(this.sunGlow);

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.2);
    this.scene.add(ambientLight);

    // Add some stars in the background
    this.createStarfield();
  }

  private createStarfield(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 500;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
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

  getName(): string {
    return 'Token Galaxy';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const token = trade.ti || 'UNKNOWN';
    const volume = trade.vu;

    if (!this.particles.has(token)) {
      this.particles.set(token, []);
    }

    // Create particle
    const color = tokenColors.get(token) || hashColor(token);
    const size = Math.min(2, 0.5 + Math.log10(Math.max(1, volume)) * 0.2);

    const geometry = new THREE.SphereGeometry(size, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.8,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Calculate orbit parameters
    const tokenList = Array.from(this.particles.keys());
    const tokenIndex = tokenList.indexOf(token);
    const orbitRadius = 15 + tokenIndex * 5;
    const orbitSpeed = 0.5 + Math.random() * 0.5;
    const orbitAngle = Math.random() * Math.PI * 2;
    const orbitTilt = (Math.random() - 0.5) * Math.PI * 0.5;

    // Position particle on orbit
    const x = Math.cos(orbitAngle) * orbitRadius;
    const y = Math.sin(orbitTilt) * orbitRadius * 0.3;
    const z = Math.sin(orbitAngle) * orbitRadius;

    mesh.position.set(x, y, z);

    // Add trail effect
    const trailGeometry = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(20 * 3);
    for (let i = 0; i < 20; i++) {
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
      orbitRadius,
      orbitSpeed,
      orbitAngle,
      orbitTilt,
      trailPositions: [],
      lifetime: 10000,
      age: 0,
    });
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    console.log(`🌌 Block ${newSlot} complete - ${blockData.trades} trades`);

    // Nova burst from sun
    this.blockPulse = 1.5;
    this.sunGlow.intensity = 10.0;
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
        const y = Math.sin(particle.orbitTilt) * particle.orbitRadius * 0.3;
        const z = Math.sin(particle.orbitAngle) * particle.orbitRadius;

        particle.mesh.position.set(x, y, z);

        // Update trail
        particle.trailPositions.unshift({ x, y, z });
        if (particle.trailPositions.length > 20) {
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
      const scale = 1 + this.blockPulse * 0.3;
      this.sun.scale.set(scale, scale, scale);
      (this.sun.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.0 + this.blockPulse * 2;
    }

    // Decay sun glow
    if (this.sunGlow.intensity > 3) {
      this.sunGlow.intensity *= 0.95;
    }

    // Orbit camera around the galaxy
    this.cameraAngle += deltaTime * 0.0002;
    const cameraDistance = 50;
    this.camera.position.x = Math.cos(this.cameraAngle) * cameraDistance;
    this.camera.position.z = Math.sin(this.cameraAngle) * cameraDistance;
    this.camera.position.y = 30 + Math.sin(time * 0.1) * 5;
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

    super.dispose();
  }
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
