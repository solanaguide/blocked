import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { programColors } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * LightningNetwork - Programs as nodes, trades as lightning bolts
 */
export class LightningNetwork extends BaseVisualization {
  private nodes: Map<string, ProgramNode> = new Map();
  private bolts: LightningBolt[] = [];
  private programs = ['JUP', 'RAYDIUM_CLMM', 'RAYDIUM_CP', 'ORCA', 'PHOENIX', 'LIFINITY', 'FLASH'];
  private cameraAngle: number = 0;
  private energyPulse: number = 0;

  constructor() {
    super();

    this.camera.position.set(0, 20, 40);
    this.camera.lookAt(0, 0, 0);

    // Create program nodes in a circle
    const radius = 20;
    this.programs.forEach((program, index) => {
      const angle = (index / this.programs.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = (Math.random() - 0.5) * 10;

      const color = programColors.get(program) || 0x8b5cf6;

      // Create sphere node
      const geometry = new THREE.SphereGeometry(2, 16, 16);
      const material = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.5,
        metalness: 0.8,
        roughness: 0.2,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);

      // Add glow
      const glow = new THREE.PointLight(color, 1, 30);
      glow.position.copy(mesh.position);

      // Add wireframe
      const wireGeometry = new THREE.SphereGeometry(2.2, 8, 8);
      const wireMaterial = new THREE.MeshBasicMaterial({
        color: color,
        wireframe: true,
        transparent: true,
        opacity: 0.3,
      });
      const wireframe = new THREE.Mesh(wireGeometry, wireMaterial);
      wireframe.position.copy(mesh.position);

      this.scene.add(mesh);
      this.scene.add(glow);
      this.scene.add(wireframe);

      this.nodes.set(program, {
        mesh,
        glow,
        wireframe,
        position: new THREE.Vector3(x, y, z),
        energy: 0,
      });
    });

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.2);
    this.scene.add(ambientLight);

    // Add connection lines between nodes
    this.createConnections();
  }

  private createConnections(): void {
    const nodeArray = Array.from(this.nodes.values());

    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const start = nodeArray[i].position;
        const end = nodeArray[j].position;

        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        const material = new THREE.LineBasicMaterial({
          color: 0x8b5cf6,
          transparent: true,
          opacity: 0.1,
        });

        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
      }
    }
  }

  getName(): string {
    return 'Lightning Network';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const program = trade.p;

    if (!this.nodes.has(program)) return;

    // Pick a random target node
    const nodeArray = Array.from(this.nodes.values());
    const targetNode = nodeArray[Math.floor(Math.random() * nodeArray.length)];

    const sourceNode = this.nodes.get(program)!;

    // Add energy to source node
    sourceNode.energy += trade.vu;

    // Create lightning bolt
    const volume = trade.vu;
    const thickness = Math.min(0.5, 0.05 + Math.log10(Math.max(1, volume)) * 0.05);

    this.createLightningBolt(sourceNode.position, targetNode.position, programColors.get(program) || 0xffffff, thickness);
  }

  private createLightningBolt(start: THREE.Vector3, end: THREE.Vector3, color: number, thickness: number): void {
    // Create jagged lightning path
    const points: THREE.Vector3[] = [start.clone()];
    const segments = 8;

    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const lerped = new THREE.Vector3().lerpVectors(start, end, t);

      // Add random jitter
      lerped.x += (Math.random() - 0.5) * 2;
      lerped.y += (Math.random() - 0.5) * 2;
      lerped.z += (Math.random() - 0.5) * 2;

      points.push(lerped);
    }

    points.push(end.clone());

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: color,
      linewidth: thickness,
      transparent: true,
      opacity: 1,
    });

    const bolt = new THREE.Line(geometry, material);
    this.scene.add(bolt);

    this.bolts.push({
      line: bolt,
      age: 0,
      lifetime: 300,
    });
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    console.log(`⚡ Block ${newSlot} complete - ${blockData.trades} trades`);

    // Pulse all nodes simultaneously
    this.energyPulse = 1.0;

    this.nodes.forEach(node => {
      node.glow.intensity = 5.0;
      (node.wireframe.material as THREE.MeshBasicMaterial).opacity = 0.8;
    });
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Update nodes
    this.nodes.forEach(node => {
      // Pulse based on energy
      const energyScale = 1 + Math.min(node.energy / 100000, 0.5);
      node.mesh.scale.set(energyScale, energyScale, energyScale);

      // Decay energy
      node.energy *= 0.95;

      // Gentle float
      node.mesh.position.y = node.position.y + Math.sin(time * 0.5 + node.position.x) * 0.5;
      node.glow.position.copy(node.mesh.position);
      node.wireframe.position.copy(node.mesh.position);

      // Decay glow
      if (node.glow.intensity > 1) {
        node.glow.intensity *= 0.95;
      }

      // Rotate wireframe
      node.wireframe.rotation.y += deltaTime * 0.001;
    });

    // Update bolts
    this.bolts.forEach((bolt, index) => {
      bolt.age += deltaTime;

      // Fade out
      const fadeProgress = bolt.age / bolt.lifetime;
      (bolt.line.material as THREE.LineBasicMaterial).opacity = 1 - fadeProgress;

      // Remove old bolts
      if (bolt.age > bolt.lifetime) {
        this.scene.remove(bolt.line);
        bolt.line.geometry.dispose();
        (bolt.line.material as THREE.Material).dispose();
        this.bolts.splice(index, 1);
      }
    });

    // Block pulse effect
    if (this.energyPulse > 0) {
      this.energyPulse *= 0.9;
      this.nodes.forEach(node => {
        (node.wireframe.material as THREE.MeshBasicMaterial).opacity = 0.3 + this.energyPulse * 0.5;
      });
    } else {
      this.nodes.forEach(node => {
        (node.wireframe.material as THREE.MeshBasicMaterial).opacity *= 0.98;
      });
    }

    // Orbit camera
    this.cameraAngle += deltaTime * 0.0003;
    const radius = 40;
    this.camera.position.x = Math.cos(this.cameraAngle) * radius;
    this.camera.position.z = Math.sin(this.cameraAngle) * radius;
    this.camera.position.y = 20 + Math.sin(time * 0.2) * 5;
    this.camera.lookAt(0, 0, 0);
  }

  dispose(): void {
    this.nodes.forEach(node => {
      this.scene.remove(node.mesh);
      this.scene.remove(node.glow);
      this.scene.remove(node.wireframe);
      node.mesh.geometry.dispose();
      (node.mesh.material as THREE.Material).dispose();
      (node.wireframe.material as THREE.Material).dispose();
    });
    this.nodes.clear();

    this.bolts.forEach(bolt => {
      this.scene.remove(bolt.line);
      bolt.line.geometry.dispose();
      (bolt.line.material as THREE.Material).dispose();
    });
    this.bolts = [];

    super.dispose();
  }
}

interface ProgramNode {
  mesh: THREE.Mesh;
  glow: THREE.PointLight;
  wireframe: THREE.Mesh;
  position: THREE.Vector3;
  energy: number;
}

interface LightningBolt {
  line: THREE.Line;
  age: number;
  lifetime: number;
}
