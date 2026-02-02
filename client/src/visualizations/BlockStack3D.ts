import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { txTypeColors, volumeHeatmap } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';

/**
 * BlockStack3D - 3D blocks scrolling through time
 *
 * CONCEPT: Physical block structures moving through space, each representing a Solana block.
 * - Block SIZE = total volume (swap + transfer)
 * - Block GLOW = total revenue (fees + jito)
 * - Block HEIGHT = compute units used
 * - Block COLOR = completion rate (cyan → amber gradient)
 * - Internal particles = transaction types (votes golden, completed cyan, reverted amber)
 * - Blocks scroll from right to left as new blocks arrive
 */
export class BlockStack3D extends BaseVisualization {
  private blocks: BlockMesh[] = [];
  private maxBlocks = 15;
  private blockSpacing = 12;

  // Current block being built
  private currentBlockData: BlockMessage | null = null;

  // Shadow-casting light reference
  private shadowLight: THREE.DirectionalLight;

  constructor() {
    super();

    // Enable shadow maps on renderer
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Camera setup - isometric-ish view
    this.camera.position.set(30, 25, 50);
    this.camera.lookAt(0, 0, 0);

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambientLight);

    // Key light (warm) - with shadow casting
    this.shadowLight = new THREE.DirectionalLight(0xffeedd, 0.8);
    this.shadowLight.position.set(20, 40, 20);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.width = 1024;
    this.shadowLight.shadow.mapSize.height = 1024;
    this.shadowLight.shadow.camera.near = 1;
    this.shadowLight.shadow.camera.far = 100;
    this.shadowLight.shadow.camera.left = -60;
    this.shadowLight.shadow.camera.right = 60;
    this.shadowLight.shadow.camera.top = 40;
    this.shadowLight.shadow.camera.bottom = -40;
    this.shadowLight.shadow.bias = -0.001;
    this.scene.add(this.shadowLight);

    // Fill light (cool)
    const fillLight = new THREE.DirectionalLight(0x88ccff, 0.4);
    fillLight.position.set(-20, 10, -10);
    this.scene.add(fillLight);

    // Grid floor that receives shadows
    const gridFloorGeometry = new THREE.PlaneGeometry(120, 120);
    const gridFloorMaterial = new THREE.MeshStandardMaterial({
      color: 0x001122,
      roughness: 0.9,
      metalness: 0.1,
      transparent: true,
      opacity: 0.5,
    });
    const gridFloor = new THREE.Mesh(gridFloorGeometry, gridFloorMaterial);
    gridFloor.rotation.x = -Math.PI / 2;
    gridFloor.position.y = -10;
    gridFloor.receiveShadow = true;
    this.scene.add(gridFloor);

    // Grid lines overlay
    const gridHelper = new THREE.GridHelper(120, 40, 0x004444, 0x002222);
    gridHelper.position.y = -9.99;
    this.scene.add(gridHelper);

    // Starfield
    this.createStarfield();

    // Fog for depth
    this.scene.fog = new THREE.Fog(0x000011, 50, 150);
  }

  private createStarfield(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 400;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = Math.random() * 80 + 10;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.4,
      transparent: true,
      opacity: 0.5,
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(stars);
  }

  getName(): string {
    return 'Block Stack 3D';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    // Add trade particle to current block if it exists
    const currentBlock = this.blocks.find(b => b.slot === slot);
    if (currentBlock) {
      this.addTradeParticle(currentBlock, trade);
    }
  }

  private addTradeParticle(block: BlockMesh, trade: TradeMessage): void {
    if (block.particles.length >= 50) return; // Limit particles per block

    const size = 0.15 + Math.log10(Math.max(1, trade.vu)) * 0.1;
    const geometry = new THREE.SphereGeometry(size, 6, 6);
    const color = volumeHeatmap(trade.vu);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.9,
    });

    const particle = new THREE.Mesh(geometry, material);

    // Position inside the block
    const blockSize = block.mesh.scale;
    particle.position.set(
      (Math.random() - 0.5) * blockSize.x * 0.8,
      (Math.random() - 0.5) * blockSize.y * 0.8,
      (Math.random() - 0.5) * blockSize.z * 0.8
    );

    block.group.add(particle);
    block.particles.push({
      mesh: particle,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02
      ),
    });
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Block transition handled in onBlockData when we have full metrics
  }

  onBlockData(block: BlockMessage): void {
    this.currentBlockData = block;

    // Create new block mesh
    this.createBlockMesh(block);

    // Shift existing blocks left
    this.blocks.forEach((b, index) => {
      b.targetX = -index * this.blockSpacing;
    });

    // Remove old blocks
    while (this.blocks.length > this.maxBlocks) {
      const old = this.blocks.pop()!;
      this.scene.remove(old.group);
      old.mesh.geometry.dispose();
      (old.mesh.material as THREE.Material).dispose();
      old.edges.geometry.dispose();
      (old.edges.material as THREE.Material).dispose();
      old.particles.forEach(p => {
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
      });
    }
  }

  private createBlockMesh(block: BlockMessage): void {
    const group = new THREE.Group();

    // Calculate dimensions based on block metrics
    // Volume → width/depth (log scale, 100k = 5, 1M = 7, 10M = 9)
    const volume = block.swapVolumeUsd + block.transferVolumeUsd;
    const volumeLog = Math.log10(Math.max(1000, volume));
    const sizeBase = Math.min(10, 3 + volumeLog * 0.8);

    // CU → height (30M CU = 10 height)
    const cuNormalized = block.cu / 30000000;
    const height = Math.min(15, 4 + cuNormalized * 10);

    // Create main block geometry
    const geometry = new THREE.BoxGeometry(sizeBase, height, sizeBase);

    // Color based on completion rate
    const nonVote = block.completed + block.reverted;
    const completionRate = nonVote > 0 ? block.completed / nonVote : 1.0;

    const baseColor = new THREE.Color(txTypeColors.completed);
    const amberColor = new THREE.Color(txTypeColors.reverted);
    baseColor.lerp(amberColor, 1 - completionRate);

    // Revenue → emissive intensity (glow)
    const revenue = (block.allFees + block.jitoTotal) / 1e9;
    const glowIntensity = Math.min(2.5, 0.5 + revenue * 25);

    const material = new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: baseColor,
      emissiveIntensity: glowIntensity,
      metalness: 0.4,
      roughness: 0.5,
      transparent: true,
      opacity: 0.85,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = height / 2 - 10; // Sit on grid
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Add glowing edges
    const edgesGeometry = new THREE.EdgesGeometry(geometry);
    const edgesMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
    });
    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
    edges.position.copy(mesh.position);
    group.add(edges);

    // Add transaction type indicators (small spheres at top)
    this.addTransactionIndicators(group, block, height);

    // Add point light for glow effect
    const glow = new THREE.PointLight(baseColor.getHex(), glowIntensity * 2, sizeBase * 3);
    glow.position.set(0, height / 2 - 10, 0);
    group.add(glow);

    // Position at right side (will animate left)
    group.position.x = this.blockSpacing;
    group.position.z = 0;

    this.scene.add(group);

    // Add to blocks array at front
    this.blocks.unshift({
      group,
      mesh,
      edges,
      glow,
      slot: block.slot,
      targetX: 0,
      particles: [],
      volume,
      revenue,
      completionRate,
    });
  }

  private addTransactionIndicators(group: THREE.Group, block: BlockMessage, blockHeight: number): void {
    const indicatorY = blockHeight / 2 - 10 + blockHeight / 2 + 1;

    // Vote indicator (golden) - proportional to vote count
    const voteSize = Math.min(1.5, 0.3 + (block.votes / 1500) * 0.8);
    const voteGeom = new THREE.SphereGeometry(voteSize, 8, 8);
    const voteMat = new THREE.MeshStandardMaterial({
      color: txTypeColors.vote,
      emissive: txTypeColors.vote,
      emissiveIntensity: 1.5,
    });
    const voteIndicator = new THREE.Mesh(voteGeom, voteMat);
    voteIndicator.position.set(-2, indicatorY, 0);
    group.add(voteIndicator);

    // Completed indicator (cyan)
    const completedSize = Math.min(1.2, 0.2 + (block.completed / 300) * 0.6);
    const completedGeom = new THREE.SphereGeometry(completedSize, 8, 8);
    const completedMat = new THREE.MeshStandardMaterial({
      color: txTypeColors.completed,
      emissive: txTypeColors.completed,
      emissiveIntensity: 1.2,
    });
    const completedIndicator = new THREE.Mesh(completedGeom, completedMat);
    completedIndicator.position.set(0, indicatorY, 0);
    group.add(completedIndicator);

    // Reverted indicator (amber) - only if significant
    if (block.reverted > 10) {
      const revertedSize = Math.min(1.0, 0.2 + (block.reverted / 150) * 0.5);
      const revertedGeom = new THREE.SphereGeometry(revertedSize, 8, 8);
      const revertedMat = new THREE.MeshStandardMaterial({
        color: txTypeColors.reverted,
        emissive: txTypeColors.reverted,
        emissiveIntensity: 1.2,
      });
      const revertedIndicator = new THREE.Mesh(revertedGeom, revertedMat);
      revertedIndicator.position.set(2, indicatorY, 0);
      group.add(revertedIndicator);
    }

    // Jito indicator (orange) - only if significant MEV
    if (block.jitoTxns > 20) {
      const jitoSize = Math.min(0.8, 0.2 + (block.jitoTxns / 100) * 0.4);
      const jitoGeom = new THREE.OctahedronGeometry(jitoSize);
      const jitoMat = new THREE.MeshStandardMaterial({
        color: txTypeColors.jito,
        emissive: txTypeColors.jito,
        emissiveIntensity: 1.5,
      });
      const jitoIndicator = new THREE.Mesh(jitoGeom, jitoMat);
      jitoIndicator.position.set(0, indicatorY + 2, 0);
      group.add(jitoIndicator);
    }
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Animate blocks to their target positions
    this.blocks.forEach((block, index) => {
      // Smooth movement to target X
      block.group.position.x += (block.targetX - block.group.position.x) * 0.05;

      // Gentle floating animation
      block.group.position.y = Math.sin(time * 0.5 + index * 0.5) * 0.3;

      // Subtle rotation
      block.group.rotation.y = Math.sin(time * 0.2 + index * 0.3) * 0.05;

      // Update internal particles
      block.particles.forEach(particle => {
        particle.mesh.position.add(particle.velocity);

        // Bounce off walls
        const bounds = block.mesh.scale.x * 0.4;
        if (Math.abs(particle.mesh.position.x) > bounds) particle.velocity.x *= -1;
        if (Math.abs(particle.mesh.position.y) > bounds) particle.velocity.y *= -1;
        if (Math.abs(particle.mesh.position.z) > bounds) particle.velocity.z *= -1;
      });

      // Pulse glow on recent blocks
      if (index === 0) {
        const pulse = 1 + Math.sin(time * 4) * 0.2;
        block.glow.intensity = block.revenue * 25 * pulse;
      }
    });

    // Fixed isometric camera with subtle vertical float (no orbiting)
    // Blocks march LEFT toward negative X (into the past)
    const camHeight = 25 + Math.sin(time * 0.1) * 3 + this.getCameraOffsetY();
    this.camera.position.set(50, camHeight, 40);
    this.camera.lookAt(-20, this.getCameraOffsetY() * 0.3, 0);
  }

  getLegend(): LegendItem[] {
    return [
      { label: 'Block Size', color: 0x00CED1, description: 'Total volume (swap + transfer)' },
      { label: 'Block Glow', color: 0xffffff, description: 'Revenue (fees + jito)' },
      { label: 'Block Height', color: 0x8b5cf6, description: 'Compute units used' },
      { label: 'Gold Sphere', color: txTypeColors.vote, description: 'Vote transactions' },
      { label: 'Cyan Sphere', color: txTypeColors.completed, description: 'Completed transactions' },
      { label: 'Amber Sphere', color: txTypeColors.reverted, description: 'Reverted transactions' },
      { label: 'Orange Diamond', color: txTypeColors.jito, description: 'MEV (Jito) transactions' },
    ];
  }

  dispose(): void {
    this.blocks.forEach(block => {
      this.scene.remove(block.group);
      block.mesh.geometry.dispose();
      (block.mesh.material as THREE.Material).dispose();
      block.edges.geometry.dispose();
      (block.edges.material as THREE.Material).dispose();
      block.particles.forEach(p => {
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
      });
    });
    this.blocks = [];

    super.dispose();
  }
}

interface BlockMesh {
  group: THREE.Group;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  glow: THREE.PointLight;
  slot: number;
  targetX: number;
  particles: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[];
  volume: number;
  revenue: number;
  completionRate: number;
}
