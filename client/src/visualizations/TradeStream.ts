import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * TradeStream - Trades flying from left to right with block dividers
 *
 * CONCEPT: Horizontal stream of trade particles flying across the screen.
 * - Each PARTICLE = a trade
 * - Particle SIZE = trade volume (log scale)
 * - Particle COLOR = program color
 * - Particles fly LEFT → RIGHT at speed based on volume
 * - Block change = VERTICAL DIVIDER sweeps across screen (visual block boundary)
 * - Divider leaves trail that fades, showing block history
 * - Like watching trades flow through time horizontally
 */
export class TradeStream extends BaseVisualization {
  private tradeParticles: TradeParticle[] = [];
  private dividers: BlockDivider[] = [];
  private maxParticles = 300;
  private streamSpeed = 0.3; // Constant speed for all particles and dividers

  constructor() {
    super();

    this.camera.position.set(0, 0, 50);
    this.camera.lookAt(0, 0, 0);

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.4);
    this.scene.add(ambientLight);

    // Add some depth lighting
    const light1 = new THREE.PointLight(0xff006e, 1, 100);
    light1.position.set(-30, 10, 20);
    this.scene.add(light1);

    const light2 = new THREE.PointLight(0x06ffa5, 1, 100);
    light2.position.set(30, -10, 20);
    this.scene.add(light2);

    // Add horizontal guide lines
    this.createGuideLines();
  }

  private createGuideLines(): void {
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0.2,
    });

    for (let y = -20; y <= 20; y += 10) {
      const points = [
        new THREE.Vector3(-40, y, 0),
        new THREE.Vector3(40, y, 0),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, lineMaterial);
      this.scene.add(line);
    }
  }

  getName(): string {
    return 'Trade Stream';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const program = trade.p;
    const volume = trade.vu;

    // Create particle
    const size = Math.min(3, 0.5 + Math.log10(Math.max(1, volume)) * 0.3);
    const color = programColors.get(program) || 0x8b5cf6;

    const geometry = new THREE.SphereGeometry(size, 8, 8);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.8,
      metalness: 0.6,
      roughness: 0.3,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Start position (left side, random Y)
    const startX = -40;
    const y = (Math.random() - 0.5) * 30;
    const z = (Math.random() - 0.5) * 5;

    mesh.position.set(startX, y, z);

    // Add glow trail
    const glowGeometry = new THREE.SphereGeometry(size * 1.5, 8, 8);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.copy(mesh.position);

    this.scene.add(mesh);
    this.scene.add(glow);

    // All particles move at same speed to stay aligned with block dividers
    this.tradeParticles.push({
      mesh,
      glow,
      age: 0,
    });

    // Limit particles
    if (this.tradeParticles.length > this.maxParticles) {
      const old = this.tradeParticles.shift()!;
      this.scene.remove(old.mesh);
      this.scene.remove(old.glow);
      old.mesh.geometry.dispose();
      (old.mesh.material as THREE.Material).dispose();
      old.glow.geometry.dispose();
      (old.glow.material as THREE.Material).dispose();
    }
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    console.log(`💨 Block ${newSlot} complete - ${blockData.trades} trades`);

    // Create vertical divider that sweeps across screen
    this.createBlockDivider(newSlot);
  }

  private createBlockDivider(slot: number): void {
    const geometry = new THREE.PlaneGeometry(0.5, 60);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff006e,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(-40, 0, -2); // Start at left side, behind particles

    // Add glowing edges
    const edgeGeometry = new THREE.EdgesGeometry(geometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 3,
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    mesh.add(edges);

    this.scene.add(mesh);

    this.dividers.push({
      mesh,
      slot,
      opacity: 0.8,
    });
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Update trade particles
    this.tradeParticles.forEach((particle, index) => {
      particle.age += deltaTime;

      // Move particle left to right at constant speed
      particle.mesh.position.x += this.streamSpeed;
      particle.glow.position.copy(particle.mesh.position);

      // Subtle bobbing motion
      particle.mesh.position.y += Math.sin(time * 2 + index) * 0.01;

      // Rotate for visual interest
      particle.mesh.rotation.x += deltaTime * 0.001;
      particle.mesh.rotation.y += deltaTime * 0.002;

      // Remove particles that flew off right side
      if (particle.mesh.position.x > 45) {
        this.scene.remove(particle.mesh);
        this.scene.remove(particle.glow);
        particle.mesh.geometry.dispose();
        (particle.mesh.material as THREE.Material).dispose();
        particle.glow.geometry.dispose();
        (particle.glow.material as THREE.Material).dispose();
        this.tradeParticles.splice(index, 1);
      }
    });

    // Update dividers
    this.dividers.forEach((divider, index) => {
      // Move divider left to right at same speed as particles
      divider.mesh.position.x += this.streamSpeed;

      // Fade out as it moves
      divider.opacity *= 0.995;
      (divider.mesh.material as THREE.MeshBasicMaterial).opacity = divider.opacity;

      // Remove faded dividers
      if (divider.opacity < 0.05 || divider.mesh.position.x > 45) {
        this.scene.remove(divider.mesh);
        divider.mesh.geometry.dispose();
        (divider.mesh.material as THREE.Material).dispose();
        this.dividers.splice(index, 1);
      }
    });

    // Subtle camera movement
    this.camera.position.y = Math.sin(time * 0.3) * 3;
  }

  dispose(): void {
    this.tradeParticles.forEach(particle => {
      this.scene.remove(particle.mesh);
      this.scene.remove(particle.glow);
      particle.mesh.geometry.dispose();
      (particle.mesh.material as THREE.Material).dispose();
      particle.glow.geometry.dispose();
      (particle.glow.material as THREE.Material).dispose();
    });
    this.tradeParticles = [];

    this.dividers.forEach(divider => {
      this.scene.remove(divider.mesh);
      divider.mesh.geometry.dispose();
      (divider.mesh.material as THREE.Material).dispose();
    });
    this.dividers = [];

    super.dispose();
  }
}

interface TradeParticle {
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  age: number;
}

interface BlockDivider {
  mesh: THREE.Mesh;
  slot: number;
  opacity: number;
}
