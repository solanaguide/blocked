import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { txTypeColors, volumeHeatmap } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * EconomicPulse - Network heartbeat visualization
 *
 * CONCEPT: Central pulsing orb representing Solana's economic activity
 * - Central orb SIZE = total volume (swap + transfer)
 * - Central orb BRIGHTNESS = total revenue (fees + jito)
 * - Three concentric rings:
 *   - Inner: Swap volume (cyan)
 *   - Middle: Transfer volume (teal)
 *   - Outer: Revenue glow (golden)
 * - Pulse animation on each block
 * - Shockwave particles emanating on block complete
 */
export class EconomicPulse extends BaseVisualization {
  // Central orb
  private orb: THREE.Mesh;
  private orbGlow: THREE.PointLight;
  private orbMaterial: THREE.MeshStandardMaterial;

  // Concentric rings
  private innerRing: THREE.Mesh;  // Swap volume
  private middleRing: THREE.Mesh; // Transfer volume
  private outerRing: THREE.Mesh;  // Revenue

  // Pulse effects
  private pulseScale = 1.0;
  private targetPulseScale = 1.0;
  private shockwaves: THREE.Mesh[] = [];

  // Trade particles orbiting
  private tradeParticles: {
    mesh: THREE.Mesh;
    angle: number;
    radius: number;
    speed: number;
    lifetime: number;
  }[] = [];
  private maxParticles = 100;

  // Block metrics (cached for smooth interpolation)
  private blockVolume = 0;
  private swapVolume = 0;
  private transferVolume = 0;
  private blockRevenue = 0;
  private completionRate = 1.0;
  private mevIntensity = 0;

  // Target values for smooth interpolation
  private targetOrbScale = 1.0;
  private currentOrbScale = 1.0;

  // Camera animation
  private cameraAngle = 0;

  constructor() {
    super();

    // Camera setup - looking at center from an angle
    this.camera.position.set(0, 15, 50);
    this.camera.lookAt(0, 0, 0);

    // Create central orb
    const orbGeometry = new THREE.SphereGeometry(5, 32, 32);
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

    // Orb glow light
    this.orbGlow = new THREE.PointLight(0x00CED1, 3, 60);
    this.orbGlow.position.set(0, 0, 0);
    this.scene.add(this.orbGlow);

    // Create concentric rings
    this.innerRing = this.createRing(10, 0.3, txTypeColors.completed); // Cyan - swaps
    this.middleRing = this.createRing(15, 0.25, 0x20B2AA); // Teal - transfers
    this.outerRing = this.createRing(20, 0.2, txTypeColors.vote); // Golden - revenue

    this.scene.add(this.innerRing);
    this.scene.add(this.middleRing);
    this.scene.add(this.outerRing);

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    this.scene.add(ambientLight);

    // Directional light for depth
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);

    // Starfield background
    this.createStarfield();

    // Grid helper for ground reference
    const gridHelper = new THREE.GridHelper(100, 50, 0x004444, 0x002222);
    gridHelper.position.y = -15;
    this.scene.add(gridHelper);
  }

  private createRing(radius: number, tubeRadius: number, color: number): THREE.Mesh {
    const geometry = new THREE.TorusGeometry(radius, tubeRadius, 16, 100);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.8,
      metalness: 0.5,
      roughness: 0.3,
      transparent: true,
      opacity: 0.7,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = Math.PI / 2; // Lay flat
    return ring;
  }

  private createStarfield(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 500;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 100 - 30;
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
    return 'Economic Pulse';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    // Spawn orbiting particle for trade
    if (this.tradeParticles.length < this.maxParticles) {
      this.spawnTradeParticle(trade);
    }
  }

  private spawnTradeParticle(trade: TradeMessage): void {
    const size = 0.2 + Math.log10(Math.max(1, trade.vu)) * 0.15;
    const geometry = new THREE.SphereGeometry(size, 8, 8);
    const color = volumeHeatmap(trade.vu);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.9,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Random orbit parameters
    const radius = 8 + Math.random() * 15;
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.0005 + Math.random() * 0.001;

    mesh.position.set(
      Math.cos(angle) * radius,
      (Math.random() - 0.5) * 6,
      Math.sin(angle) * radius
    );

    this.scene.add(mesh);
    this.tradeParticles.push({
      mesh,
      angle,
      radius,
      speed,
      lifetime: 8000 + Math.random() * 4000,
    });
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Trigger pulse effect
    this.targetPulseScale = 1.3 + this.blockRevenue * 2;
    this.pulseScale = this.targetPulseScale;

    // Create shockwave
    this.createShockwave();
  }

  onBlockData(block: BlockMessage): void {
    // Volume metrics
    this.swapVolume = block.swapVolumeUsd;
    this.transferVolume = block.transferVolumeUsd;
    this.blockVolume = this.swapVolume + this.transferVolume;

    // Revenue metrics
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9; // Convert to SOL

    // Derived metrics
    const nonVote = block.completed + block.reverted;
    this.completionRate = nonVote > 0 ? block.completed / nonVote : 1.0;
    this.mevIntensity = nonVote > 0 ? block.jitoTxns / nonVote : 0;

    // Calculate target orb scale based on volume (log scale)
    // $100k = scale 1.0, $1M = scale 1.5, $10M = scale 2.0
    const volumeLog = Math.log10(Math.max(1000, this.blockVolume));
    this.targetOrbScale = Math.min(2.5, 0.5 + volumeLog * 0.3);

    // Update ring scales based on volume proportions
    const totalVol = Math.max(1, this.swapVolume + this.transferVolume);
    const swapRatio = this.swapVolume / totalVol;
    const transferRatio = this.transferVolume / totalVol;

    // Inner ring (swaps) - scale by swap proportion
    const innerScale = 0.8 + swapRatio * 0.6;
    this.innerRing.scale.set(innerScale, innerScale, 1);

    // Middle ring (transfers) - scale by transfer proportion
    const middleScale = 0.8 + transferRatio * 0.6;
    this.middleRing.scale.set(middleScale, middleScale, 1);

    // Outer ring (revenue) - brightness based on revenue
    const outerMat = this.outerRing.material as THREE.MeshStandardMaterial;
    outerMat.emissiveIntensity = Math.min(2.5, 0.5 + this.blockRevenue * 20);

    // Update orb glow based on revenue
    this.orbGlow.intensity = Math.min(8, 3 + this.blockRevenue * 50);

    // Update orb color based on completion rate
    // High completion = cyan, low completion = amber tint
    const orbColor = new THREE.Color(txTypeColors.completed);
    const amberColor = new THREE.Color(txTypeColors.reverted);
    orbColor.lerp(amberColor, 1 - this.completionRate);
    this.orbMaterial.color.copy(orbColor);
    this.orbMaterial.emissive.copy(orbColor);

    // MEV intensity affects outer ring color
    if (this.mevIntensity > 0.1) {
      const outerColor = new THREE.Color(txTypeColors.vote);
      const jitoColor = new THREE.Color(txTypeColors.jito);
      outerColor.lerp(jitoColor, Math.min(1, this.mevIntensity * 2));
      outerMat.color.copy(outerColor);
      outerMat.emissive.copy(outerColor);
    }
  }

  private createShockwave(): void {
    const geometry = new THREE.RingGeometry(5, 5.5, 64);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00CED1,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });

    const shockwave = new THREE.Mesh(geometry, material);
    shockwave.rotation.x = -Math.PI / 2;
    this.scene.add(shockwave);
    this.shockwaves.push(shockwave);
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Smooth orb scale interpolation
    this.currentOrbScale += (this.targetOrbScale - this.currentOrbScale) * 0.05;

    // Apply pulse effect
    this.pulseScale += (1.0 - this.pulseScale) * 0.05;
    const finalScale = this.currentOrbScale * this.pulseScale;
    this.orb.scale.set(finalScale, finalScale, finalScale);

    // Orb breathing animation
    const breathe = 1 + Math.sin(time * 2) * 0.05;
    this.orb.scale.multiplyScalar(breathe);

    // Rotate rings at different speeds
    this.innerRing.rotation.z += deltaTime * 0.0003;
    this.middleRing.rotation.z -= deltaTime * 0.0002;
    this.outerRing.rotation.z += deltaTime * 0.0001;

    // Slight wobble on rings
    this.innerRing.rotation.x = Math.PI / 2 + Math.sin(time * 0.5) * 0.05;
    this.middleRing.rotation.x = Math.PI / 2 + Math.sin(time * 0.3 + 1) * 0.04;
    this.outerRing.rotation.x = Math.PI / 2 + Math.sin(time * 0.2 + 2) * 0.03;

    // Update trade particles
    for (let i = this.tradeParticles.length - 1; i >= 0; i--) {
      const particle = this.tradeParticles[i];
      particle.lifetime -= deltaTime;
      particle.angle += particle.speed * deltaTime;

      // Orbit around center
      particle.mesh.position.x = Math.cos(particle.angle) * particle.radius;
      particle.mesh.position.z = Math.sin(particle.angle) * particle.radius;

      // Gentle vertical oscillation
      particle.mesh.position.y += Math.sin(time * 2 + particle.angle) * 0.01;

      // Fade out as lifetime decreases
      if (particle.lifetime < 2000) {
        const opacity = particle.lifetime / 2000;
        (particle.mesh.material as THREE.MeshStandardMaterial).opacity = opacity;
      }

      // Remove dead particles
      if (particle.lifetime <= 0) {
        this.scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        (particle.mesh.material as THREE.Material).dispose();
        this.tradeParticles.splice(i, 1);
      }
    }

    // Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const shockwave = this.shockwaves[i];
      shockwave.scale.x += deltaTime * 0.03;
      shockwave.scale.y += deltaTime * 0.03;

      const mat = shockwave.material as THREE.MeshBasicMaterial;
      mat.opacity -= deltaTime * 0.001;

      if (mat.opacity <= 0) {
        this.scene.remove(shockwave);
        shockwave.geometry.dispose();
        mat.dispose();
        this.shockwaves.splice(i, 1);
      }
    }

    // Gentle camera orbit
    this.cameraAngle += deltaTime * 0.00005;
    const camRadius = 50;
    const camHeight = 15 + Math.sin(time * 0.1) * 5;
    this.camera.position.x = Math.cos(this.cameraAngle) * camRadius;
    this.camera.position.z = Math.sin(this.cameraAngle) * camRadius;
    this.camera.position.y = camHeight;
    this.camera.lookAt(0, 0, 0);
  }

  dispose(): void {
    // Clean up trade particles
    this.tradeParticles.forEach(particle => {
      this.scene.remove(particle.mesh);
      particle.mesh.geometry.dispose();
      (particle.mesh.material as THREE.Material).dispose();
    });
    this.tradeParticles = [];

    // Clean up shockwaves
    this.shockwaves.forEach(shockwave => {
      this.scene.remove(shockwave);
      shockwave.geometry.dispose();
      (shockwave.material as THREE.Material).dispose();
    });
    this.shockwaves = [];

    super.dispose();
  }
}
