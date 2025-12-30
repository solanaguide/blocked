import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { volumeHeatmap, programColors, hashColor } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * ParticleNebula - Cloud of glowing particles
 * Position based on program/token clustering, size based on volume
 */
export class ParticleNebula extends BaseVisualization {
  private particles: NebulaParticle[] = [];
  private programClusters: Map<string, THREE.Vector3> = new Map();
  private gravitationalCollapse: number = 0;
  private cameraAngle: number = 0;
  private maxParticles = 500;

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

      this.programClusters.set(program, new THREE.Vector3(x, y, z));
    });

    // Ambient lighting
    const ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.2);
    this.scene.add(ambientLight);

    // Background stars
    this.createStarfield();
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

    // Create glowing particle
    const geometry = new THREE.SphereGeometry(size, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);

    // Add point light for glow
    const light = new THREE.PointLight(color, volume / 10000, 20);
    light.position.copy(position);

    this.scene.add(mesh);
    this.scene.add(light);

    // Random drift velocity
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.05,
      (Math.random() - 0.5) * 0.05,
      (Math.random() - 0.5) * 0.05
    );

    this.particles.push({
      mesh,
      light,
      velocity,
      lifetime: 8000,
      age: 0,
      program,
      clusterPos,
    });

    // Limit particle count
    while (this.particles.length > this.maxParticles) {
      const oldest = this.particles.shift()!;
      this.scene.remove(oldest.mesh);
      this.scene.remove(oldest.light);
      oldest.mesh.geometry.dispose();
      (oldest.mesh.material as THREE.Material).dispose();
    }
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    console.log(`☁️ Block ${newSlot} complete - ${blockData.trades} trades`);

    // Gravitational collapse effect
    this.gravitationalCollapse = 1.0;
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Update particles
    this.particles.forEach((particle, index) => {
      particle.age += deltaTime;

      // Drift movement
      particle.mesh.position.add(particle.velocity);
      particle.light.position.copy(particle.mesh.position);

      // Gravitational attraction to cluster during collapse
      if (this.gravitationalCollapse > 0) {
        const toCluster = new THREE.Vector3().subVectors(particle.clusterPos, particle.mesh.position);
        toCluster.multiplyScalar(this.gravitationalCollapse * 0.01);
        particle.mesh.position.add(toCluster);
        particle.light.position.copy(particle.mesh.position);
      }

      // Subtle orbital rotation around cluster
      const angle = time * 0.0005;
      const dx = particle.mesh.position.x - particle.clusterPos.x;
      const dz = particle.mesh.position.z - particle.clusterPos.z;
      const rotatedX = dx * Math.cos(angle) - dz * Math.sin(angle);
      const rotatedZ = dx * Math.sin(angle) + dz * Math.cos(angle);

      particle.mesh.position.x = particle.clusterPos.x + rotatedX;
      particle.mesh.position.z = particle.clusterPos.z + rotatedZ;
      particle.light.position.copy(particle.mesh.position);

      // Pulse
      const pulseScale = 1 + Math.sin(time * 2 + index * 0.5) * 0.1;
      particle.mesh.scale.set(pulseScale, pulseScale, pulseScale);

      // Fade out
      const fadeStart = particle.lifetime * 0.6;
      if (particle.age > fadeStart) {
        const fadeProgress = (particle.age - fadeStart) / (particle.lifetime - fadeStart);
        (particle.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - fadeProgress;
        particle.light.intensity *= 0.98;
      }

      // Remove old particles
      if (particle.age > particle.lifetime) {
        this.scene.remove(particle.mesh);
        this.scene.remove(particle.light);
        particle.mesh.geometry.dispose();
        (particle.mesh.material as THREE.Material).dispose();
        this.particles.splice(index, 1);
      }
    });

    // Decay gravitational collapse
    if (this.gravitationalCollapse > 0) {
      this.gravitationalCollapse *= 0.95;
    }

    // Orbit camera around nebula
    this.cameraAngle += deltaTime * 0.0002;
    const radius = 50;
    this.camera.position.x = Math.cos(this.cameraAngle) * radius;
    this.camera.position.z = Math.sin(this.cameraAngle) * radius;
    this.camera.position.y = 30 + Math.sin(time * 0.2) * 10;
    this.camera.lookAt(0, 0, 0);
  }

  dispose(): void {
    this.particles.forEach(particle => {
      this.scene.remove(particle.mesh);
      this.scene.remove(particle.light);
      particle.mesh.geometry.dispose();
      (particle.mesh.material as THREE.Material).dispose();
    });
    this.particles = [];

    super.dispose();
  }
}

interface NebulaParticle {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  velocity: THREE.Vector3;
  lifetime: number;
  age: number;
  program: string;
  clusterPos: THREE.Vector3;
}
