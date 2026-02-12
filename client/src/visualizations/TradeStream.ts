import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors, txTypeColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';

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

  // Block metrics for visual scaling
  private blockVolume = 0;
  private blockRevenue = 0;  // SOL
  private completionRate = 1.0;
  private mevIntensity = 0;

  // Lighting references for dynamic adjustment
  private light1: THREE.PointLight;
  private light2: THREE.PointLight;
  private ambientLight: THREE.AmbientLight;

  constructor() {
    super();

    this.camera.position.set(0, 0, 50);
    this.camera.lookAt(0, 0, 0);

    // Ambient light
    this.ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.4);
    this.scene.add(this.ambientLight);

    // Add some depth lighting
    this.light1 = new THREE.PointLight(0xff006e, 1, 100);
    this.light1.position.set(-30, 10, 20);
    this.scene.add(this.light1);

    this.light2 = new THREE.PointLight(0x06ffa5, 1, 100);
    this.light2.position.set(30, -10, 20);
    this.scene.add(this.light2);

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
    const token = trade.ta || 'UNKNOWN';
    const signature = `${trade.s}/${trade.idx}`;

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

    // Add to interactive objects for tooltips
    this.interactiveObjects.push({
      mesh,
      data: {
        program,
        token,
        volume,
        signature,
        slot,
      },
    });

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

      // Remove from interactive objects
      const index = this.interactiveObjects.findIndex(obj => obj.mesh === old.mesh);
      if (index !== -1) {
        this.interactiveObjects.splice(index, 1);
      }
    }
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Create vertical divider that sweeps across screen
    this.createBlockDivider(newSlot);
  }

  /**
   * Handle rich block data - scale TradeStream by Volume/Revenue
   */
  onBlockData(block: BlockMessage): void {
    // Volume (affects stream speed)
    this.blockVolume = block.swapVolumeUsd + block.transferVolumeUsd;

    // Revenue (affects brightness/glow)
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9;

    // Completion rate (affects color temperature)
    const nonVote = block.completed + block.reverted;
    this.completionRate = nonVote > 0 ? block.completed / nonVote : 1.0;

    // MEV intensity
    this.mevIntensity = nonVote > 0 ? block.jitoTxns / nonVote : 0;

    // Adjust stream speed based on TPS (txns per ~400ms block)
    this.streamSpeed = Math.min(0.6, 0.2 + (block.txns / 2000) * 0.2);

    // Adjust lighting based on revenue (brightness = PMF/urgency)
    const revenueIntensity = Math.min(3, 1 + this.blockRevenue * 20);
    this.light1.intensity = revenueIntensity;
    this.light2.intensity = revenueIntensity;

    // Ambient light shifts color based on completion rate
    // High completion = purple/cyan, low completion = warmer amber tint
    const ambientColor = new THREE.Color(0x8b5cf6);
    const amberColor = new THREE.Color(txTypeColors.reverted);
    ambientColor.lerp(amberColor, (1 - this.completionRate) * 0.5);
    this.ambientLight.color.copy(ambientColor);

    // MEV intensity affects light2 color (green → orange)
    if (this.mevIntensity > 0.1) {
      const mevColor = new THREE.Color(0x06ffa5);
      const jitoColor = new THREE.Color(txTypeColors.jito);
      mevColor.lerp(jitoColor, Math.min(1, this.mevIntensity * 3));
      this.light2.color.copy(mevColor);
    }
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

    // Add slot number label above the divider
    const label = this.createSlotLabel(slot);
    label.position.set(0, 35, 1);
    mesh.add(label);

    this.scene.add(mesh);

    this.dividers.push({
      mesh,
      slot,
      opacity: 0.8,
      label,
    });
  }

  /**
   * Create a slot number label sprite
   */
  private createSlotLabel(slot: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 128;
    canvas.height = 32;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = 'bold 16px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Show abbreviated slot number (last 6 digits)
    const slotStr = slot.toString().slice(-6);

    // Text shadow
    context.shadowColor = 'rgba(0, 0, 0, 0.8)';
    context.shadowBlur = 3;

    context.fillStyle = '#ff006e';
    context.fillText(`#${slotStr}`, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(8, 2, 1);

    return sprite;
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

        // Remove from interactive objects
        const objIndex = this.interactiveObjects.findIndex(obj => obj.mesh === particle.mesh);
        if (objIndex !== -1) {
          this.interactiveObjects.splice(objIndex, 1);
        }
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
        // Dispose label if present
        if (divider.label) {
          (divider.label.material as THREE.SpriteMaterial).map?.dispose();
          (divider.label.material as THREE.SpriteMaterial).dispose();
        }
        this.dividers.splice(index, 1);
      }
    });

    // Subtle camera movement
    this.camera.position.y = Math.sin(time * 0.3) * 3 + this.getCameraOffsetY();
  }

  getLegend(): LegendItem[] {
    return [
      { label: 'Particle', color: 0x8b5cf6, description: 'Individual trade' },
      { label: 'Particle Size', color: 0x00CED1, description: 'Trade volume (log scale)' },
      { label: 'Particle Color', color: 0xff006e, description: 'Program identity (DEX)' },
      { label: 'Vertical Line', color: 0xff006e, description: 'Block boundary with slot number' },
      { label: 'Flow Speed', color: 0xffffff, description: 'Network transaction rate' },
    ];
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
      if (divider.label) {
        (divider.label.material as THREE.SpriteMaterial).map?.dispose();
        (divider.label.material as THREE.SpriteMaterial).dispose();
      }
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
  label?: THREE.Sprite;
}
