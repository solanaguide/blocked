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

    // CONVEYOR BELT: Block spawns off-screen left, slides to center quickly
    // Then pauses at center to fill with particles (~300ms), then sweeps right
    mesh.position.set(-30, 0, 0);
    console.log(`📦 Block ${blockData.slot} spawned at x=-30 (conveyor entry)`);

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
      rotation: new THREE.Vector3(0, 0, 0),
      lockedParticles: new Set(),
      gridSize: blockSize,
      gridPositions: new Set(),
    };

    this.activeBlocks.set(blockData.slot, blockMesh);
  }

  private sweepBlockAway(blockMesh: BlockMesh) {
    blockMesh.phase = 'sweeping';
    // Ensure block is snapped to center before sweeping
    blockMesh.mesh.position.x = 0;

    console.log(`🌊 Block ${blockMesh.blockData.slot} sweeping with ${blockMesh.lockedParticles.size} locked particles`);

    this.flashBlockCompletion(blockMesh);
  }

  private flashBlockCompletion(blockMesh: BlockMesh) {
    const wireframeMat = blockMesh.wireframe.material as THREE.LineBasicMaterial;
    const originalOpacity = wireframeMat.opacity;

    wireframeMat.opacity = 1.0;
    wireframeMat.color.setHex(0x00ffff);

    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / 200, 1);

      if (progress < 1) {
        wireframeMat.opacity = 1.0 - (progress * (1.0 - originalOpacity));
        requestAnimationFrame(animate);
      } else {
        wireframeMat.opacity = originalOpacity;
      }
    };
    animate();
  }

  // Lock a particle into the forming block's grid
  // All grid positions are stored in BLOCK-LOCAL space
  lockParticle(particleId: string, particleSlot: number, particlePosition: THREE.Vector3): { locked: boolean; gridPosition?: THREE.Vector3 } {
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

    if (particleSlot !== formingBlock.blockData.slot) {
      return { locked: false };
    }

    // Calculate block-relative position
    const blockPos = formingBlock.mesh.position;
    const halfSize = formingBlock.gridSize / 2; // 15
    const relX = particlePosition.x - blockPos.x;
    const relY = particlePosition.y - blockPos.y;
    const relZ = particlePosition.z - blockPos.z;

    // AABB bounds check in block-local space
    if (Math.abs(relX) > halfSize || Math.abs(relY) > halfSize || Math.abs(relZ) > halfSize) {
      return { locked: false };
    }

    // Grid snap in BLOCK-LOCAL space (not world space)
    // Separate horizontal/vertical cell sizes for more vertical breathing room
    const cellXZ = 3.0;
    const cellY = 5.0;
    const gridX = Math.round(relX / cellXZ) * cellXZ;
    let gridY = Math.round(relY / cellY) * cellY;
    const gridZ = Math.round(relZ / cellXZ) * cellXZ;

    // Clamp gridY within block bounds (grid-aligned)
    const gridYMax = Math.floor((halfSize - 1) / cellY) * cellY;
    gridY = Math.max(-gridYMax, Math.min(gridYMax, gridY));

    const gridKey = `${gridX},${gridY},${gridZ}`;
    if (formingBlock.gridPositions.has(gridKey)) {
      // Try nearby positions
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nearX = gridX + dx * cellXZ;
            const nearY = gridY + dy * cellY;
            const nearZ = gridZ + dz * cellXZ;
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
      return { locked: false };
    }

    formingBlock.gridPositions.add(gridKey);
    formingBlock.lockedParticles.add(particleId);

    return {
      locked: true,
      gridPosition: new THREE.Vector3(gridX, gridY, gridZ)
    };
  }

  getBlockPosition(slot: number): THREE.Vector3 | null {
    const block = this.activeBlocks.get(slot);
    return block ? block.mesh.position.clone() : null;
  }

  // Get the current forming block's position (for particle spawn offset)
  getFormingBlockPosition(): THREE.Vector3 {
    for (const block of this.activeBlocks.values()) {
      if (block.phase === 'forming') {
        return block.mesh.position.clone();
      }
    }
    return new THREE.Vector3(0, 0, 0);
  }

  isParticleLocked(particleId: string): boolean {
    const currentBlock = Array.from(this.activeBlocks.values())[0];
    return currentBlock ? currentBlock.lockedParticles.has(particleId) : false;
  }

  hasFormingBlockForSlot(slot: number): boolean {
    const block = this.activeBlocks.get(slot);
    return block !== undefined && block.phase === 'forming';
  }

  isBlockSweeping(slot: number): boolean {
    const block = this.activeBlocks.get(slot);
    return block !== undefined && block.phase === 'sweeping';
  }

  // Force-lock a particle to a sweeping block
  // Clamps position within block bounds
  forceLockParticle(particleId: string, particleSlot: number, particlePosition: THREE.Vector3): { locked: boolean; gridPosition?: THREE.Vector3 } {
    const block = this.activeBlocks.get(particleSlot);
    if (!block) {
      return { locked: false };
    }

    const blockPos = block.mesh.position;
    const halfSize = block.gridSize / 2; // 15
    const relativePos = particlePosition.clone().sub(blockPos);
    relativePos.x = Math.max(-halfSize, Math.min(halfSize, relativePos.x));
    relativePos.y = Math.max(-halfSize, Math.min(halfSize, relativePos.y));
    relativePos.z = Math.max(-halfSize, Math.min(halfSize, relativePos.z));

    block.lockedParticles.add(particleId);

    return {
      locked: true,
      gridPosition: relativePos
    };
  }

  // Get stack height at a given BLOCK-LOCAL X/Z position
  getStackHeightAt(slot: number, relX: number, relZ: number, cellXZ: number, cellY: number): number {
    const block = this.activeBlocks.get(slot);
    if (!block) return -15;

    let maxY = -15;
    const gridX = Math.round(relX / cellXZ) * cellXZ;
    const gridZ = Math.round(relZ / cellXZ) * cellXZ;

    // Only check this exact column (Tetris-style per-column stacking)
    const halfSize = block.gridSize / 2;
    const gridYMax = Math.floor((halfSize - 1) / cellY) * cellY;
    const steps = Math.ceil(gridYMax / cellY);
    for (let dy = -steps; dy <= steps; dy++) {
      const checkY = dy * cellY;
      const key = `${gridX},${checkY},${gridZ}`;
      if (block.gridPositions.has(key)) {
        maxY = Math.max(maxY, checkY);
      }
    }

    return maxY;
  }

  update(deltaTime: number) {
    for (const [slot, block] of this.activeBlocks) {
      block.lifetime += deltaTime;

      if (block.phase === 'forming') {
        // CONVEYOR BELT: Slide quickly to center, then pause to fill
        if (block.mesh.position.x < -0.5) {
          block.mesh.position.x += deltaTime * 1.0; // Fast arrival (~30ms from x=-30)
          if (block.mesh.position.x > 0) block.mesh.position.x = 0;
        } else {
          block.mesh.position.x = 0; // Stationary at center while filling
        }
      }

      if (block.phase === 'sweeping') {
        block.mesh.position.x += deltaTime * 0.3;

        const solidOpacity = (block.mesh.material as THREE.MeshStandardMaterial).opacity;
        (block.mesh.material as THREE.MeshStandardMaterial).opacity = solidOpacity * 0.98;

        const wireframeMat = block.wireframe.material as THREE.LineBasicMaterial;
        wireframeMat.opacity *= 0.98;

        if (block.mesh.position.x > 120) {
          console.log(`🗑️ Removing block ${slot} at position ${block.mesh.position.x}`);
          this.scene.remove(block.mesh);
          block.mesh.geometry.dispose();
          (block.mesh.material as THREE.Material).dispose();
          wireframeMat.dispose();
          block.wireframe.geometry.dispose();

          this.activeBlocks.delete(slot);
          this.slotsToCleanup.add(slot);
        }
      }
    }
  }

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
  lockedParticles: Set<string>;
  gridSize: number;
  gridPositions: Set<string>;  // Occupied grid positions in BLOCK-LOCAL space
}
