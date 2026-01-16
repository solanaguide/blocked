import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { txTypeColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * VolumeFlow - Flowing river of economic activity
 *
 * CONCEPT: A river/stream that represents economic flow through the network.
 * - River WIDTH = total volume (wider = more activity)
 * - River BRIGHTNESS = revenue (brighter = more fees paid)
 * - Cyan water = completed transactions
 * - Amber tint = reverted transactions (market volatility)
 * - Waterfalls at block boundaries
 * - Trade particles float down the stream
 */
export class VolumeFlow extends BaseVisualization {
  // River mesh and geometry
  private riverMesh!: THREE.Mesh;
  private riverMaterial!: THREE.MeshStandardMaterial;
  private riverWidth = 10;
  private targetRiverWidth = 10;

  // Floating trade particles
  private particles: FlowParticle[] = [];
  private maxParticles = 150;

  // Waterfall effects on block change
  private waterfalls: WaterfallParticle[] = [];
  private maxWaterfalls = 50;

  // Block metrics
  private blockVolume = 0;
  private blockRevenue = 0;
  private completionRate = 1.0;
  private flowSpeed = 0.3;

  // Flow animation
  private flowOffset = 0;

  // Lighting
  private mainLight: THREE.PointLight;
  private ambientLight: THREE.AmbientLight;

  // Camera
  private cameraAngle = 0;

  constructor() {
    super();

    // Camera looking down at the river from above/side
    this.camera.position.set(0, 25, 35);
    this.camera.lookAt(0, 0, 0);

    // Create the river
    this.createRiver();

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0x00CED1, 0.3);
    this.scene.add(this.ambientLight);

    this.mainLight = new THREE.PointLight(0x00CED1, 3, 100);
    this.mainLight.position.set(0, 15, 0);
    this.scene.add(this.mainLight);

    // Secondary light for depth
    const backLight = new THREE.PointLight(0x8b5cf6, 1.5, 80);
    backLight.position.set(-20, 10, -20);
    this.scene.add(backLight);

    // Create riverbanks/terrain
    this.createTerrain();

    // Starfield
    this.createStarfield();
  }

  private createRiver(): void {
    // River is a long plane that we'll animate
    const geometry = new THREE.PlaneGeometry(this.riverWidth, 80, 32, 64);
    this.riverMaterial = new THREE.MeshStandardMaterial({
      color: 0x00CED1,
      emissive: 0x00CED1,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.2,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });

    this.riverMesh = new THREE.Mesh(geometry, this.riverMaterial);
    this.riverMesh.rotation.x = -Math.PI / 2;
    this.riverMesh.position.y = -2;
    this.scene.add(this.riverMesh);
  }

  private createTerrain(): void {
    // Left bank
    const bankGeometry = new THREE.BoxGeometry(15, 3, 80);
    const bankMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.9,
    });

    const leftBank = new THREE.Mesh(bankGeometry, bankMaterial);
    leftBank.position.set(-15, -3, 0);
    this.scene.add(leftBank);

    const rightBank = new THREE.Mesh(bankGeometry, bankMaterial);
    rightBank.position.set(15, -3, 0);
    this.scene.add(rightBank);

    // Grid helper beneath
    const gridHelper = new THREE.GridHelper(100, 50, 0x003333, 0x001111);
    gridHelper.position.y = -5;
    this.scene.add(gridHelper);
  }

  private createStarfield(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 500;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 150;
      positions[i * 3 + 1] = Math.random() * 50 + 10;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 150;
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
    return 'Volume Flow';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    if (this.particles.length >= this.maxParticles) return;

    const volume = trade.vu;
    const size = Math.min(1.5, 0.3 + Math.log10(Math.max(1, volume)) * 0.15);

    // Particle color based on trade type
    const color = 0x00CED1; // Cyan for trades

    const geometry = new THREE.SphereGeometry(size, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.9,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Start at the top of the river
    const x = (Math.random() - 0.5) * this.riverWidth * 0.8;
    mesh.position.set(x, -1.5, -35);

    this.scene.add(mesh);
    this.particles.push({
      mesh,
      speed: this.flowSpeed * (0.8 + Math.random() * 0.4),
      wobble: Math.random() * Math.PI * 2,
      lifetime: 15000,
      age: 0,
    });
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Create waterfall burst effect
    this.createWaterfall();
  }

  private createWaterfall(): void {
    const particleCount = Math.min(30, this.maxWaterfalls - this.waterfalls.length);

    for (let i = 0; i < particleCount; i++) {
      const size = 0.2 + Math.random() * 0.3;
      const geometry = new THREE.SphereGeometry(size, 6, 6);

      // Color based on completion rate
      const baseColor = new THREE.Color(0x00CED1);
      const amberColor = new THREE.Color(txTypeColors.reverted);
      baseColor.lerp(amberColor, (1 - this.completionRate) * 0.5);

      const material = new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: baseColor,
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 1.0,
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Start at a "waterfall" position
      const x = (Math.random() - 0.5) * this.riverWidth * 0.6;
      mesh.position.set(x, 2, -30 + Math.random() * 5);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.1,
        -0.1 - Math.random() * 0.1,
        this.flowSpeed * 0.5
      );

      this.scene.add(mesh);
      this.waterfalls.push({
        mesh,
        velocity,
        lifetime: 3000,
        age: 0,
      });
    }
  }

  onBlockData(block: BlockMessage): void {
    // Volume affects river width
    this.blockVolume = block.swapVolumeUsd + block.transferVolumeUsd;

    // Revenue affects brightness
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9;

    // Completion rate affects color
    const nonVote = block.completed + block.reverted;
    this.completionRate = nonVote > 0 ? block.completed / nonVote : 1.0;

    // Calculate target river width based on volume
    const volumeLog = Math.log10(Math.max(1000, this.blockVolume));
    this.targetRiverWidth = Math.min(25, 5 + volumeLog * 2);

    // Flow speed based on transaction count
    this.flowSpeed = Math.min(0.6, 0.2 + (block.txns / 2000) * 0.3);

    // Update river color based on completion rate
    const baseColor = new THREE.Color(0x00CED1);
    const amberColor = new THREE.Color(txTypeColors.reverted);
    baseColor.lerp(amberColor, (1 - this.completionRate) * 0.4);
    this.riverMaterial.color.copy(baseColor);
    this.riverMaterial.emissive.copy(baseColor);

    // Brightness from revenue
    const revenueIntensity = Math.min(1.5, 0.5 + this.blockRevenue * 15);
    this.riverMaterial.emissiveIntensity = revenueIntensity;

    // Update main light
    this.mainLight.intensity = Math.min(6, 3 + this.blockRevenue * 40);
    this.mainLight.color.copy(baseColor);

    // Ambient shifts with completion
    this.ambientLight.color.copy(baseColor);
    this.ambientLight.intensity = 0.3 + this.blockRevenue * 2;
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Smoothly interpolate river width
    this.riverWidth += (this.targetRiverWidth - this.riverWidth) * 0.02;

    // Update river geometry width (recreate if significant change)
    const currentWidth = (this.riverMesh.geometry as THREE.PlaneGeometry).parameters.width;
    if (Math.abs(currentWidth - this.riverWidth) > 1) {
      this.riverMesh.geometry.dispose();
      this.riverMesh.geometry = new THREE.PlaneGeometry(this.riverWidth, 80, 32, 64);
    }

    // Animate river flow with vertex displacement
    this.flowOffset += this.flowSpeed * deltaTime * 0.01;
    const positions = this.riverMesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      // Wave effect
      const wave = Math.sin(z * 0.1 + this.flowOffset * 5) * 0.3;
      const ripple = Math.sin(x * 0.3 + time * 2) * 0.1;
      positions.setY(i, wave + ripple);
    }
    positions.needsUpdate = true;

    // Update flow particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.age += deltaTime;

      // Move down river
      particle.mesh.position.z += particle.speed;

      // Gentle wobble
      particle.wobble += deltaTime * 0.003;
      particle.mesh.position.x += Math.sin(particle.wobble) * 0.02;

      // Bob on the water
      particle.mesh.position.y = -1.5 + Math.sin(time * 3 + particle.wobble) * 0.2;

      // Fade out
      if (particle.age > particle.lifetime * 0.7) {
        const fadeProgress = (particle.age - particle.lifetime * 0.7) / (particle.lifetime * 0.3);
        (particle.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - fadeProgress;
      }

      // Remove if off screen or expired
      if (particle.mesh.position.z > 40 || particle.age > particle.lifetime) {
        this.scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        (particle.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      }
    }

    // Update waterfall particles
    for (let i = this.waterfalls.length - 1; i >= 0; i--) {
      const wf = this.waterfalls[i];
      wf.age += deltaTime;

      // Apply velocity and gravity
      wf.mesh.position.add(wf.velocity);
      wf.velocity.y -= 0.005; // Gravity

      // Stop at river level
      if (wf.mesh.position.y < -1.5) {
        wf.mesh.position.y = -1.5;
        wf.velocity.y = 0;
        wf.velocity.x *= 0.95;
        wf.velocity.z = this.flowSpeed; // Join the flow
      }

      // Fade out
      const fadeProgress = wf.age / wf.lifetime;
      (wf.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - fadeProgress;

      if (wf.age > wf.lifetime) {
        this.scene.remove(wf.mesh);
        wf.mesh.geometry.dispose();
        (wf.mesh.material as THREE.Material).dispose();
        this.waterfalls.splice(i, 1);
      }
    }

    // Gentle camera orbit
    this.cameraAngle += deltaTime * 0.00005;
    const camRadius = 40;
    this.camera.position.x = Math.sin(this.cameraAngle) * 15;
    this.camera.position.z = 35 + Math.cos(this.cameraAngle) * 10;
    this.camera.position.y = 25 + Math.sin(time * 0.1) * 3;
    this.camera.lookAt(0, -2, 0);
  }

  dispose(): void {
    this.particles.forEach(p => {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    });
    this.particles = [];

    this.waterfalls.forEach(wf => {
      this.scene.remove(wf.mesh);
      wf.mesh.geometry.dispose();
      (wf.mesh.material as THREE.Material).dispose();
    });
    this.waterfalls = [];

    this.riverMesh.geometry.dispose();
    this.riverMaterial.dispose();

    super.dispose();
  }
}

interface FlowParticle {
  mesh: THREE.Mesh;
  speed: number;
  wobble: number;
  lifetime: number;
  age: number;
}

interface WaterfallParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  lifetime: number;
  age: number;
}
