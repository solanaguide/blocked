import * as THREE from 'three';
import type { BlockData, Particle } from '../types';

export class BlockBuilder {
  private scene: THREE.Scene;
  private activeBlocks: Map<number, BlockMesh> = new Map();
  private slotsToCleanup: Set<number> = new Set(); // Slots whose blocks exited screen

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  startBlock(blockData: BlockData, oldSlot?: number) {
    console.log(`🎯 Starting NEW block for slot ${blockData.slot}`);

    // Sweep away the old forming block if it exists
    if (oldSlot !== undefined) {
      const oldBlock = this.activeBlocks.get(oldSlot);
      if (oldBlock && oldBlock.phase === 'forming') {
        console.log(`📦 Sweeping away old block ${oldSlot} with ${oldBlock.lockedParticles.size} particles`);
        this.sweepBlockAway(oldBlock);
      }
    }

    // Create block mesh - FIXED SIZE since we don't know volume yet (container approach)
    // Larger size for better visibility
    const blockSize = 30; // Fixed size container
    const geometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);

    // Transparent material so you can see trades inside
    const material = new THREE.MeshStandardMaterial({
      color: 0x8b5cf6,
      emissive: 0x8b5cf6,
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.2,
      transparent: true,
      opacity: 0.15,  // Very transparent
      wireframe: false,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // NEW APPROACH: Block spawns at CENTER and stays there while forming
    mesh.position.set(0, 0, 0);
    console.log(`📦 Block ${blockData.slot} spawned at CENTER (0, 0, 0) - stationary while forming`);

    // Add bright edges for visibility
    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,  // Bright cyan
      linewidth: 4,
      transparent: true,
      opacity: 1.0,
    });
    const wireframe = new THREE.LineSegments(edges, lineMaterial);
    mesh.add(wireframe);

    // Add to scene
    this.scene.add(mesh);

    const blockMesh: BlockMesh = {
      mesh,
      wireframe,
      blockData,
      phase: 'forming',
      lifetime: 0,
      rotation: new THREE.Vector3(0, 0, 0),  // No rotation
      lockedParticles: new Set(),
      gridSize: blockSize,
      gridPositions: new Set(),
    };

    this.activeBlocks.set(blockData.slot, blockMesh);
  }

  private sweepBlockAway(blockMesh: BlockMesh) {
    // Block is about to sweep away
    // Signal to instantly lock ALL unlocked particles for this slot
    blockMesh.phase = 'sweeping';

    console.log(`🌊 Block ${blockMesh.blockData.slot} sweeping with ${blockMesh.lockedParticles.size} locked particles (will force-lock remaining)`);

    // Create shockwave effect when block completes
    this.createShockwave();
  }

  private createShockwave() {
    const geometry = new THREE.RingGeometry(0.1, 0.5, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
    });

    const shockwave = new THREE.Mesh(geometry, material);
    shockwave.rotation.x = Math.PI / 2;
    this.scene.add(shockwave);

    // Remove after animation
    setTimeout(() => {
      this.scene.remove(shockwave);
      geometry.dispose();
      material.dispose();
    }, 500);

    // Animate shockwave
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / 500;

      if (progress < 1) {
        shockwave.scale.set(1 + progress * 30, 1 + progress * 30, 1);
        (shockwave.material as THREE.MeshBasicMaterial).opacity = 1 - progress;
        requestAnimationFrame(animate);
      }
    };
    animate();
  }

  // Lock a particle into the forming block's grid - only if particle slot matches block slot
  lockParticle(particleId: string, particleSlot: number, particlePosition: THREE.Vector3): { locked: boolean; gridPosition?: THREE.Vector3 } {
    // Find the forming block
    let formingBlock: BlockMesh | undefined;
    for (const block of this.activeBlocks.values()) {
      if (block.phase === 'forming') {
        formingBlock = block;
        break;
      }
    }

    if (!formingBlock) {
      return { locked: false };
    }

    // Particles can ONLY lock to blocks with matching slot numbers
    if (particleSlot !== formingBlock.blockData.slot) {
      return { locked: false };
    }

    // Block is at center (0, 0, 0), so distance check is simple
    const blockPos = formingBlock.mesh.position;
    const distance = particlePosition.distanceTo(blockPos);
    const lockRadius = formingBlock.gridSize * 0.8; // Larger radius for container filling

    if (distance > lockRadius) {
      return { locked: false };
    }

    // Only log occasionally to avoid spam
    if (Math.random() < 0.02) {
      console.log(`🔒 Locking particle ${particleId.slice(0,6)} (slot ${particleSlot}) to block at distance ${distance.toFixed(1)}`);
    }

    // Calculate grid position (snap to grid) - LARGER cells to spread particles out
    const cellSize = 4.0; // Larger cells = more spread
    const gridX = Math.round(particlePosition.x / cellSize) * cellSize;
    const gridY = Math.round(particlePosition.y / cellSize) * cellSize;
    const gridZ = Math.round(particlePosition.z / cellSize) * cellSize;

    // Check if this grid position is already occupied
    const gridKey = `${gridX},${gridY},${gridZ}`;
    if (formingBlock.gridPositions.has(gridKey)) {
      // Try nearby positions
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nearX = gridX + dx * cellSize;
            const nearY = gridY + dy * cellSize;
            const nearZ = gridZ + dz * cellSize;
            const nearKey = `${nearX},${nearY},${nearZ}`;

            if (!formingBlock.gridPositions.has(nearKey)) {
              formingBlock.gridPositions.add(nearKey);
              formingBlock.lockedParticles.add(particleId);
              return {
                locked: true,
                gridPosition: new THREE.Vector3(nearX, nearY, nearZ)
              };
            }
          }
        }
      }
      return { locked: false }; // No space found
    }

    // Lock particle to this grid position
    formingBlock.gridPositions.add(gridKey);
    formingBlock.lockedParticles.add(particleId);

    return {
      locked: true,
      gridPosition: new THREE.Vector3(gridX, gridY, gridZ)
    };
  }

  // Get the block position for a given slot (so locked particles can move with their block)
  getBlockPosition(slot: number): THREE.Vector3 | null {
    const block = this.activeBlocks.get(slot);
    return block ? block.mesh.position.clone() : null;
  }

  // Check if a particle is locked
  isParticleLocked(particleId: string): boolean {
    const currentBlock = Array.from(this.activeBlocks.values())[0];
    return currentBlock ? currentBlock.lockedParticles.has(particleId) : false;
  }

  // Check if we have a forming block for a given slot
  hasFormingBlockForSlot(slot: number): boolean {
    const block = this.activeBlocks.get(slot);
    return block !== undefined && block.phase === 'forming';
  }

  // Check if a block is sweeping
  isBlockSweeping(slot: number): boolean {
    const block = this.activeBlocks.get(slot);
    return block !== undefined && block.phase === 'sweeping';
  }

  // Force-lock a particle to a sweeping block (no distance check)
  forceLockParticle(particleId: string, particleSlot: number, particlePosition: THREE.Vector3): { locked: boolean; gridPosition?: THREE.Vector3 } {
    const block = this.activeBlocks.get(particleSlot);
    if (!block) {
      return { locked: false };
    }

    const blockPos = block.mesh.position;
    // Calculate relative position to block
    const relativePos = particlePosition.clone().sub(blockPos);

    block.lockedParticles.add(particleId);

    return {
      locked: true,
      gridPosition: relativePos
    };
  }

  // Get height of stacked particles at a given X/Z position (for collision)
  getStackHeightAt(slot: number, x: number, z: number, cellSize: number): number {
    const block = this.activeBlocks.get(slot);
    if (!block) return -15; // Bottom of empty block

    // Find highest particle in this X/Z grid cell
    let maxY = -15; // Start at bottom of block
    const gridX = Math.round(x / cellSize) * cellSize;
    const gridZ = Math.round(z / cellSize) * cellSize;

    // Check this cell and adjacent cells for stack height
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const checkX = gridX + dx * cellSize;
        const checkZ = gridZ + dz * cellSize;

        // Search through occupied grid positions
        for (let dy = -3; dy <= 3; dy++) { // Check vertical range
          const checkY = dy * cellSize;
          const key = `${checkX},${checkY},${checkZ}`;
          if (block.gridPositions.has(key)) {
            maxY = Math.max(maxY, checkY);
          }
        }
      }
    }

    return maxY;
  }

  update(deltaTime: number) {
    // Update blocks
    for (const [slot, block] of this.activeBlocks) {
      block.lifetime += deltaTime;

      if (block.phase === 'forming') {
        // NEW APPROACH: Forming blocks are STATIONARY at center (0, 0, 0)
        // They don't move until they transition to 'sweeping'
        // No movement, no rotation - just stable block accepting particles
      }

      if (block.phase === 'sweeping') {
        // Sweep block off to the right with its locked particles
        block.mesh.position.x += deltaTime * 0.3;

        // Fade both the solid material and wireframe
        const solidOpacity = (block.mesh.material as THREE.MeshStandardMaterial).opacity;
        (block.mesh.material as THREE.MeshStandardMaterial).opacity = solidOpacity * 0.98;

        const wireframeMat = block.wireframe.material as THREE.LineBasicMaterial;
        wireframeMat.opacity *= 0.98;

        // No rotation - keep it stable

        // Remove block after it's off screen
        if (block.mesh.position.x > 120) {
          console.log(`🗑️ Removing block ${slot} at position ${block.mesh.position.x}`);
          this.scene.remove(block.mesh);
          block.mesh.geometry.dispose();
          (block.mesh.material as THREE.Material).dispose();
          wireframeMat.dispose();
          block.wireframe.geometry.dispose();

          this.activeBlocks.delete(slot);

          // Signal to remove ALL particles for this slot
          this.slotsToCleanup.add(slot);
        }
      }
    }

  }

  // Get slots that need particle cleanup (block exited screen)
  getSlotsToCleanup(): Set<number> {
    const slots = this.slotsToCleanup;
    this.slotsToCleanup = new Set();
    return slots;
  }
}

interface BlockMesh {
  mesh: THREE.Mesh;
  wireframe: THREE.LineSegments;
  blockData: BlockData;
  phase: 'forming' | 'sweeping';
  lifetime: number;
  rotation: THREE.Vector3;
  lockedParticles: Set<string>;  // IDs of particles locked into this block
  gridSize: number;  // Size of the block for grid calculations
  gridPositions: Set<string>;  // Occupied grid positions (x,y,z keys)
}

