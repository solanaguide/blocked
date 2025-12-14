import * as THREE from 'three';
import type { BlockData, Particle } from '../types';

export class BlockBuilder {
  private scene: THREE.Scene;
  private activeBlocks: Map<number, BlockMesh> = new Map();
  private impactEffects: ImpactEffect[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  startBlock(blockData: BlockData) {
    console.log(`🎯 Starting block formation for slot ${blockData.slot}`);

    // Create block mesh - much larger and more prominent
    const blockSize = Math.min(25, 10 + Math.log10(Math.max(1, blockData.volume)) * 2);
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
    mesh.position.set(0, 0, 0);

    // Add bright edges for visibility
    const edges = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x06ffa5,
      linewidth: 3,
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
      rotation: new THREE.Vector3(
        (Math.random() - 0.5) * 0.005,  // Much slower rotation
        (Math.random() - 0.5) * 0.005,
        (Math.random() - 0.5) * 0.005
      ),
    };

    // Remove any old blocks first - only one block at a time!
    for (const [oldSlot, oldBlock] of this.activeBlocks) {
      if (oldSlot !== blockData.slot) {
        this.sweepBlockAway(oldBlock);
      }
    }

    this.activeBlocks.set(blockData.slot, blockMesh);
  }

  private sweepBlockAway(blockMesh: BlockMesh) {
    blockMesh.phase = 'sweeping';

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

  createImpactEffect(position: THREE.Vector3) {
    // Small flash at impact point
    const geometry = new THREE.SphereGeometry(0.3, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0x06ffa5,
      transparent: true,
      opacity: 1.0,
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
    this.scene.add(sphere);

    this.impactEffects.push({
      mesh: sphere,
      lifetime: 0,
      maxLifetime: 200,
    });
  }

  update(deltaTime: number) {
    // Update blocks
    for (const [slot, block] of this.activeBlocks) {
      block.lifetime += deltaTime;

      if (block.phase === 'forming') {
        // Rotate while forming
        block.mesh.rotation.x += block.rotation.x * deltaTime;
        block.mesh.rotation.y += block.rotation.y * deltaTime;
        block.mesh.rotation.z += block.rotation.z * deltaTime;

        // Gentle pulse effect
        const pulse = Math.sin(block.lifetime * 0.002) * 0.05 + 1;
        block.mesh.scale.set(pulse, pulse, pulse);
      }

      if (block.phase === 'sweeping') {
        // Sweep block off to the right and fade
        block.mesh.position.x += deltaTime * 0.3;
        block.mesh.position.y += deltaTime * 0.05;

        // Fade both the solid material and wireframe
        const solidOpacity = (block.mesh.material as THREE.MeshStandardMaterial).opacity;
        (block.mesh.material as THREE.MeshStandardMaterial).opacity = solidOpacity * 0.95;

        const wireframeMat = block.wireframe.material as THREE.LineBasicMaterial;
        wireframeMat.opacity *= 0.95;

        // Keep rotating slowly
        block.mesh.rotation.x += block.rotation.x * deltaTime * 2;
        block.mesh.rotation.y += block.rotation.y * deltaTime * 2;
        block.mesh.rotation.z += block.rotation.z * deltaTime * 2;

        // Remove block after it's off screen or faded
        if (block.mesh.position.x > 100 || wireframeMat.opacity < 0.1) {
          this.scene.remove(block.mesh);
          block.mesh.geometry.dispose();
          (block.mesh.material as THREE.Material).dispose();
          wireframeMat.dispose();
          this.activeBlocks.delete(slot);
        }
      }
    }

    // Update impact effects
    for (let i = this.impactEffects.length - 1; i >= 0; i--) {
      const effect = this.impactEffects[i];
      effect.lifetime += deltaTime;

      // Scale up and fade
      const progress = effect.lifetime / effect.maxLifetime;
      const scale = 1 + progress * 2;
      effect.mesh.scale.set(scale, scale, scale);
      (effect.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - progress;

      if (effect.lifetime > effect.maxLifetime) {
        this.scene.remove(effect.mesh);
        effect.mesh.geometry.dispose();
        (effect.mesh.material as THREE.Material).dispose();
        this.impactEffects.splice(i, 1);
      }
    }
  }
}

interface BlockMesh {
  mesh: THREE.Mesh;
  wireframe: THREE.LineSegments;
  blockData: BlockData;
  phase: 'forming' | 'sweeping';
  lifetime: number;
  rotation: THREE.Vector3;
}

interface ImpactEffect {
  mesh: THREE.Mesh;
  lifetime: number;
  maxLifetime: number;
}

