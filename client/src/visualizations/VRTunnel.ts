import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { volumeHeatmap } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * VRTunnel - Flying through a neon Tron-style tunnel
 * Each ring = a block, colored by volume/activity
 */
export class VRTunnel extends BaseVisualization {
  private rings: TunnelRing[] = [];
  private tunnelSpeed: number = 0;
  private targetSpeed: number = 0.5;
  private currentBlockVolume: number = 0;
  private currentBlockTrades: number = 0;
  private whooshEffect: number = 0;

  constructor() {
    super();

    // Camera looks down the tunnel
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, -100);

    // Initial tunnel rings
    for (let i = 0; i < 30; i++) {
      this.createRing(-i * 10, 0xff006e, 1);
    }

    // Add some ambient light
    const ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.3);
    this.scene.add(ambientLight);

    // Fog for depth
    this.scene.fog = new THREE.Fog(0x000000, 10, 200);

    // Add starfield in background
    this.createStarfield();
  }

  private createStarfield(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 300;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 100;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 300 - 50;
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

  private createRing(z: number, color: number, thickness: number): void {
    const segments = 32;
    const radius = 15;

    // Create ring geometry
    const shape = new THREE.Shape();
    shape.absarc(0, 0, radius, 0, Math.PI * 2, false);

    const holePath = new THREE.Path();
    holePath.absarc(0, 0, radius - thickness, 0, Math.PI * 2, true);
    shape.holes.push(holePath);

    const geometry = new THREE.ShapeGeometry(shape, segments);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = z;

    // Add glow lines
    const edgeGeometry = new THREE.RingGeometry(radius - thickness, radius, segments);
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
    });
    const edgeMesh = new THREE.Mesh(edgeGeometry, edgeMaterial);
    edgeMesh.position.z = z;

    this.scene.add(mesh);
    this.scene.add(edgeMesh);

    this.rings.push({
      mesh,
      edgeMesh,
      baseZ: z,
    });
  }

  getName(): string {
    return 'VR Tunnel';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    this.currentBlockVolume += trade.vu;
    this.currentBlockTrades++;

    // Speed up tunnel based on trade activity
    this.targetSpeed = 0.5 + Math.min(this.currentBlockTrades / 100, 2);
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    console.log(`🚇 Block ${newSlot} complete - ${blockData.trades} trades, $${blockData.volume.toFixed(2)}`);

    // WHOOSH effect - speed burst
    this.whooshEffect = 3.0;
    this.tunnelSpeed += 5;

    // Create new ring with volume-based color
    const color = volumeHeatmap(this.currentBlockVolume);
    const thickness = Math.min(3, 1 + this.currentBlockTrades / 50);

    // Find furthest ring
    const furthestZ = Math.min(...this.rings.map(r => r.mesh.position.z));
    this.createRing(furthestZ - 10, color, thickness);

    // Reset counters
    this.currentBlockVolume = 0;
    this.currentBlockTrades = 0;
  }

  update(deltaTime: number): void {
    // Smooth speed transitions
    this.tunnelSpeed += (this.targetSpeed - this.tunnelSpeed) * 0.05;

    // Apply whoosh decay
    if (this.whooshEffect > 0) {
      this.whooshEffect *= 0.92;
      this.tunnelSpeed *= 0.95; // Slow down after burst
    }

    // Move all rings toward camera
    this.rings.forEach((ring, index) => {
      ring.mesh.position.z += this.tunnelSpeed;
      ring.edgeMesh.position.z += this.tunnelSpeed;

      // Pulse opacity based on whoosh
      const pulseFactor = 1 + this.whooshEffect * 0.3;
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * pulseFactor;

      // Rotate rings for effect
      ring.mesh.rotation.z += deltaTime * 0.0005;
      ring.edgeMesh.rotation.z += deltaTime * 0.0005;

      // Remove rings that passed the camera
      if (ring.mesh.position.z > 20) {
        this.scene.remove(ring.mesh);
        this.scene.remove(ring.edgeMesh);
        ring.mesh.geometry.dispose();
        (ring.mesh.material as THREE.Material).dispose();
        ring.edgeMesh.geometry.dispose();
        (ring.edgeMesh.material as THREE.Material).dispose();
        this.rings.splice(index, 1);
      }
    });

    // Camera shake during whoosh
    if (this.whooshEffect > 0) {
      this.camera.position.x = (Math.random() - 0.5) * this.whooshEffect * 0.5;
      this.camera.position.y = (Math.random() - 0.5) * this.whooshEffect * 0.5;
    } else {
      // Smooth camera back to center
      this.camera.position.x *= 0.9;
      this.camera.position.y *= 0.9;
    }

    // Subtle camera roll
    const time = this.clock.getElapsedTime();
    this.camera.rotation.z = Math.sin(time * 0.2) * 0.05;
  }

  dispose(): void {
    this.rings.forEach(ring => {
      this.scene.remove(ring.mesh);
      this.scene.remove(ring.edgeMesh);
      ring.mesh.geometry.dispose();
      (ring.mesh.material as THREE.Material).dispose();
      ring.edgeMesh.geometry.dispose();
      (ring.edgeMesh.material as THREE.Material).dispose();
    });
    this.rings = [];

    super.dispose();
  }
}

interface TunnelRing {
  mesh: THREE.Mesh;
  edgeMesh: THREE.Mesh;
  baseZ: number;
}
