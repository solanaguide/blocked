import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { txTypeColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';

/**
 * RevenueTracker - Network revenue/PMF visualization
 *
 * CONCEPT: Focus on network revenue as indicator of product-market fit.
 * - Central orb sized by total revenue (allFees + jitoTotal)
 * - Three orbiting rings representing fee sources:
 *   - Blue: baseFees
 *   - Cyan: priorityFees
 *   - Orange: jitoTotal (MEV tips)
 * - Explosions on whale activity (priorityMax > 10 SOL)
 * - Running total counter showing session earnings
 */
export class RevenueTracker extends BaseVisualization {
  // Central revenue orb
  private orb: THREE.Mesh;
  private orbGlow: THREE.PointLight;
  private orbMaterial: THREE.MeshStandardMaterial;

  // Orbiting fee rings
  private baseFeeRing: THREE.Mesh;
  private priorityFeeRing: THREE.Mesh;
  private jitoRing: THREE.Mesh;

  // Ring orbit angles
  private baseFeeAngle = 0;
  private priorityAngle = Math.PI * 0.66;
  private jitoAngle = Math.PI * 1.33;

  // Whale explosion particles
  private explosions: ExplosionParticle[] = [];

  // Orbiting fee particles
  private feeParticles: FeeParticle[] = [];
  private maxParticles = 60;

  // Block metrics
  private totalRevenue = 0;      // Session cumulative (SOL)
  private blockRevenue = 0;      // Current block (SOL)
  private baseFees = 0;
  private priorityFees = 0;
  private jitoTotal = 0;
  private priorityMax = 0;

  // Pulse effects
  private pulseScale = 1.0;

  // Camera animation
  private cameraAngle = 0;

  constructor() {
    super();

    // Camera setup
    this.camera.position.set(0, 20, 45);
    this.camera.lookAt(0, 0, 0);

    // Create central orb (revenue)
    const orbGeometry = new THREE.SphereGeometry(4, 32, 32);
    this.orbMaterial = new THREE.MeshStandardMaterial({
      color: 0x00CED1,
      emissive: 0x00CED1,
      emissiveIntensity: 1.5,
      metalness: 0.3,
      roughness: 0.4,
      transparent: true,
      opacity: 0.9,
    });
    this.orb = new THREE.Mesh(orbGeometry, this.orbMaterial);
    this.scene.add(this.orb);

    // Orb glow
    this.orbGlow = new THREE.PointLight(0x00CED1, 4, 50);
    this.scene.add(this.orbGlow);

    // Create orbiting fee rings
    this.baseFeeRing = this.createFeeRing(0x4444ff, 'base'); // Blue - base fees
    this.priorityFeeRing = this.createFeeRing(0x00CED1, 'priority'); // Cyan - priority
    this.jitoRing = this.createFeeRing(txTypeColors.jito, 'jito'); // Orange - MEV

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    this.scene.add(ambientLight);

    // Directional lights
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    keyLight.position.set(10, 20, 10);
    this.scene.add(keyLight);

    // Starfield
    this.createStarfield();

    // Grid floor
    const gridHelper = new THREE.GridHelper(80, 40, 0x003333, 0x001111);
    gridHelper.position.y = -15;
    this.scene.add(gridHelper);
  }

  private createFeeRing(color: number, type: string): THREE.Mesh {
    const geometry = new THREE.TorusGeometry(1.5, 0.3, 8, 32);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 1.2,
      metalness: 0.5,
      roughness: 0.3,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.userData.type = type;
    this.scene.add(ring);
    return ring;
  }

  private createStarfield(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 400;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 150;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 100 - 20;
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.3,
      transparent: true,
      opacity: 0.5,
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(stars);
  }

  getName(): string {
    return 'Revenue Tracker';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    // Spawn fee particle based on trade volume
    if (this.feeParticles.length < this.maxParticles && trade.vu > 100) {
      this.spawnFeeParticle(trade);
    }
  }

  private spawnFeeParticle(trade: TradeMessage): void {
    // Determine particle type based on randomness (simulating fee distribution)
    const rand = Math.random();
    let color: number;
    let orbitRadius: number;
    let type: string;

    if (rand < 0.3) {
      color = 0x4444ff; // Base fee
      orbitRadius = 12;
      type = 'base';
    } else if (rand < 0.7) {
      color = 0x00CED1; // Priority fee
      orbitRadius = 16;
      type = 'priority';
    } else {
      color = txTypeColors.jito; // Jito
      orbitRadius = 20;
      type = 'jito';
    }

    const size = 0.15 + Math.log10(Math.max(1, trade.vu)) * 0.08;
    const geometry = new THREE.SphereGeometry(size, 6, 6);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.9,
    });

    const mesh = new THREE.Mesh(geometry, material);

    const angle = Math.random() * Math.PI * 2;
    mesh.position.set(
      Math.cos(angle) * orbitRadius,
      (Math.random() - 0.5) * 4,
      Math.sin(angle) * orbitRadius
    );

    this.scene.add(mesh);
    this.feeParticles.push({
      mesh,
      angle,
      radius: orbitRadius,
      speed: 0.0003 + Math.random() * 0.0003,
      lifetime: 6000 + Math.random() * 4000,
      type,
    });
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Pulse effect based on revenue
    this.pulseScale = Math.min(1.5, 1.0 + this.blockRevenue * 5);

    // Check for whale activity
    if (this.priorityMax > 10e9) { // > 10 SOL
      this.createWhaleExplosion();
    }
  }

  onBlockData(block: BlockMessage): void {
    // Fee breakdown (lamports → SOL)
    this.baseFees = block.baseFees / 1e9;
    this.priorityFees = block.priorityFees / 1e9;
    this.jitoTotal = block.jitoTotal / 1e9;
    this.priorityMax = block.priorityMax;

    // Block revenue
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9;

    // Accumulate session total
    this.totalRevenue += this.blockRevenue;

    // Calculate proportions for ring scaling
    const totalFees = Math.max(0.0001, this.baseFees + this.priorityFees + this.jitoTotal);
    const baseRatio = this.baseFees / totalFees;
    const priorityRatio = this.priorityFees / totalFees;
    const jitoRatio = this.jitoTotal / totalFees;

    // Scale rings based on proportion
    const baseScale = 0.5 + baseRatio * 1.5;
    this.baseFeeRing.scale.set(baseScale, baseScale, baseScale);

    const priorityScale = 0.5 + priorityRatio * 1.5;
    this.priorityFeeRing.scale.set(priorityScale, priorityScale, priorityScale);

    const jitoScale = 0.5 + jitoRatio * 1.5;
    this.jitoRing.scale.set(jitoScale, jitoScale, jitoScale);

    // Update ring emissive intensity
    (this.baseFeeRing.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.8 + baseRatio * 1.5;
    (this.priorityFeeRing.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.8 + priorityRatio * 1.5;
    (this.jitoRing.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.8 + jitoRatio * 1.5;

    // Update central orb size based on total revenue
    // Scale: 0.01 SOL = 4, 0.1 SOL = 6, 1 SOL = 8
    const revenueScale = Math.min(2.5, 1.0 + Math.log10(Math.max(0.001, this.blockRevenue) * 100) * 0.3);
    this.orb.scale.set(revenueScale, revenueScale, revenueScale);

    // Orb glow intensity
    this.orbGlow.intensity = Math.min(8, 4 + this.blockRevenue * 50);
  }

  private createWhaleExplosion(): void {
    // Create burst of particles
    const particleCount = 30;

    for (let i = 0; i < particleCount; i++) {
      const geometry = new THREE.SphereGeometry(0.3, 6, 6);
      const material = new THREE.MeshStandardMaterial({
        color: 0xffd700, // Gold
        emissive: 0xffd700,
        emissiveIntensity: 2.0,
        transparent: true,
        opacity: 1.0,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, 0, 0);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5
      );

      this.scene.add(mesh);
      this.explosions.push({
        mesh,
        velocity,
        lifetime: 2000 + Math.random() * 1000,
      });
    }
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Pulse effect decay
    this.pulseScale += (1.0 - this.pulseScale) * 0.05;

    // Orb breathing
    const breathe = this.pulseScale * (1 + Math.sin(time * 2) * 0.05);
    this.orb.scale.multiplyScalar(breathe / this.orb.scale.x || 1);

    // Animate orbiting rings
    const baseOrbitRadius = 12;
    const priorityOrbitRadius = 16;
    const jitoOrbitRadius = 20;

    this.baseFeeAngle += deltaTime * 0.0004;
    this.baseFeeRing.position.x = Math.cos(this.baseFeeAngle) * baseOrbitRadius;
    this.baseFeeRing.position.z = Math.sin(this.baseFeeAngle) * baseOrbitRadius;
    this.baseFeeRing.position.y = Math.sin(time * 0.5) * 2;
    this.baseFeeRing.rotation.x = time * 0.3;
    this.baseFeeRing.rotation.y = time * 0.2;

    this.priorityAngle += deltaTime * 0.0003;
    this.priorityFeeRing.position.x = Math.cos(this.priorityAngle) * priorityOrbitRadius;
    this.priorityFeeRing.position.z = Math.sin(this.priorityAngle) * priorityOrbitRadius;
    this.priorityFeeRing.position.y = Math.sin(time * 0.4 + 1) * 2.5;
    this.priorityFeeRing.rotation.x = time * 0.25;
    this.priorityFeeRing.rotation.z = time * 0.15;

    this.jitoAngle += deltaTime * 0.00025;
    this.jitoRing.position.x = Math.cos(this.jitoAngle) * jitoOrbitRadius;
    this.jitoRing.position.z = Math.sin(this.jitoAngle) * jitoOrbitRadius;
    this.jitoRing.position.y = Math.sin(time * 0.3 + 2) * 3;
    this.jitoRing.rotation.y = time * 0.2;
    this.jitoRing.rotation.z = time * 0.1;

    // Update fee particles
    for (let i = this.feeParticles.length - 1; i >= 0; i--) {
      const particle = this.feeParticles[i];
      particle.lifetime -= deltaTime;
      particle.angle += particle.speed * deltaTime;

      particle.mesh.position.x = Math.cos(particle.angle) * particle.radius;
      particle.mesh.position.z = Math.sin(particle.angle) * particle.radius;
      particle.mesh.position.y += Math.sin(time * 2 + particle.angle) * 0.01;

      // Fade out
      if (particle.lifetime < 2000) {
        (particle.mesh.material as THREE.MeshStandardMaterial).opacity = particle.lifetime / 2000;
      }

      // Remove dead particles
      if (particle.lifetime <= 0) {
        this.scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        (particle.mesh.material as THREE.Material).dispose();
        this.feeParticles.splice(i, 1);
      }
    }

    // Update explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const exp = this.explosions[i];
      exp.lifetime -= deltaTime;
      exp.mesh.position.add(exp.velocity);
      exp.velocity.multiplyScalar(0.98); // Drag

      const opacity = exp.lifetime / 3000;
      (exp.mesh.material as THREE.MeshStandardMaterial).opacity = opacity;

      if (exp.lifetime <= 0) {
        this.scene.remove(exp.mesh);
        exp.mesh.geometry.dispose();
        (exp.mesh.material as THREE.Material).dispose();
        this.explosions.splice(i, 1);
      }
    }

    // Camera orbit
    this.cameraAngle += deltaTime * 0.00004;
    const camRadius = 45;
    this.camera.position.x = Math.cos(this.cameraAngle) * camRadius;
    this.camera.position.z = Math.sin(this.cameraAngle) * camRadius;
    this.camera.position.y = 20 + Math.sin(time * 0.1) * 5;
    this.camera.lookAt(0, 0, 0);
  }

  getLegend(): LegendItem[] {
    return [
      { label: 'Central Orb', color: 0x00CED1, description: 'Total revenue (size = SOL)' },
      { label: 'Blue Ring', color: 0x4444ff, description: 'Base fees' },
      { label: 'Cyan Ring', color: 0x00CED1, description: 'Priority fees' },
      { label: 'Orange Ring', color: txTypeColors.jito, description: 'MEV tips (Jito)' },
      { label: 'Ring Size', color: 0xffffff, description: 'Fee proportion' },
      { label: 'Gold Explosion', color: 0xffd700, description: 'Whale activity (>10 SOL)' },
    ];
  }

  dispose(): void {
    this.feeParticles.forEach(p => {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    });
    this.feeParticles = [];

    this.explosions.forEach(e => {
      this.scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      (e.mesh.material as THREE.Material).dispose();
    });
    this.explosions = [];

    super.dispose();
  }
}

interface FeeParticle {
  mesh: THREE.Mesh;
  angle: number;
  radius: number;
  speed: number;
  lifetime: number;
  type: string;
}

interface ExplosionParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  lifetime: number;
}
