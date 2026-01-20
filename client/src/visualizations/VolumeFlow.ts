import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { txTypeColors } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';

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
 *
 * PERFORMANCE: Uses InstancedMesh for particles → 2 draw calls (flow + waterfall)
 */
export class VolumeFlow extends BaseVisualization {
  // River mesh and geometry
  private riverMesh!: THREE.Mesh;
  private riverMaterial!: THREE.MeshStandardMaterial;
  private riverWidth = 10;
  private targetRiverWidth = 10;

  // Floating trade particles using InstancedMesh
  private maxFlowParticles = 150;
  private flowParticleData: FlowParticleData[] = [];
  private flowInstancedMesh: THREE.InstancedMesh;

  // Waterfall effects using InstancedMesh
  private maxWaterfallParticles = 50;
  private waterfallData: WaterfallData[] = [];
  private waterfallInstancedMesh: THREE.InstancedMesh;

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

  // Reusable objects to avoid GC pressure
  private readonly _tempMatrix = new THREE.Matrix4();
  private readonly _tempPosition = new THREE.Vector3();
  private readonly _tempQuaternion = new THREE.Quaternion();
  private readonly _tempScale = new THREE.Vector3();
  private readonly _tempColor = new THREE.Color();

  constructor() {
    super();

    // Side-on camera for clear left-to-right flow viewing
    this.camera.position.set(0, 20, 60);
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

    // Create InstancedMesh for flow particles
    const flowGeometry = new THREE.SphereGeometry(1, 8, 8);
    const flowMaterial = new THREE.MeshStandardMaterial({
      color: 0x00CED1,
      emissive: 0x00CED1,
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.9,
    });
    this.flowInstancedMesh = new THREE.InstancedMesh(flowGeometry, flowMaterial, this.maxFlowParticles);
    this.flowInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Initialize all flow instances as invisible
    for (let i = 0; i < this.maxFlowParticles; i++) {
      this._tempMatrix.makeScale(0, 0, 0);
      this.flowInstancedMesh.setMatrixAt(i, this._tempMatrix);
    }
    this.flowInstancedMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.flowInstancedMesh);

    // Create InstancedMesh for waterfall particles
    const waterfallGeometry = new THREE.SphereGeometry(1, 6, 6);
    const waterfallMaterial = new THREE.MeshStandardMaterial({
      color: 0x00CED1,
      emissive: 0x00CED1,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 1.0,
    });
    this.waterfallInstancedMesh = new THREE.InstancedMesh(waterfallGeometry, waterfallMaterial, this.maxWaterfallParticles);
    this.waterfallInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Enable per-instance colors for waterfall
    this.waterfallInstancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxWaterfallParticles * 3),
      3
    );
    this.waterfallInstancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // Initialize all waterfall instances as invisible
    for (let i = 0; i < this.maxWaterfallParticles; i++) {
      this._tempMatrix.makeScale(0, 0, 0);
      this.waterfallInstancedMesh.setMatrixAt(i, this._tempMatrix);
    }
    this.waterfallInstancedMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.waterfallInstancedMesh);
  }

  private createRiver(): void {
    // River flows LEFT to RIGHT along X-axis (80 units long, width varies with volume)
    const geometry = new THREE.PlaneGeometry(80, this.riverWidth, 64, 32);
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
    // Banks run parallel to river (along X-axis), positioned on Z-axis
    const bankGeometry = new THREE.BoxGeometry(100, 3, 12);
    const bankMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.9,
    });

    // Near bank (closer to camera)
    const nearBank = new THREE.Mesh(bankGeometry, bankMaterial);
    nearBank.position.set(0, -3, 18);
    this.scene.add(nearBank);

    // Far bank (away from camera)
    const farBank = new THREE.Mesh(bankGeometry, bankMaterial);
    farBank.position.set(0, -3, -18);
    this.scene.add(farBank);

    // Grid helper beneath
    const gridHelper = new THREE.GridHelper(120, 60, 0x003333, 0x001111);
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
    if (this.flowParticleData.length >= this.maxFlowParticles) return;

    const volume = trade.vu;
    const size = Math.min(1.5, 0.3 + Math.log10(Math.max(1, volume)) * 0.15);

    // Start at LEFT of river (-X), flow toward RIGHT (+X)
    // Z position is random within river width
    const z = (Math.random() - 0.5) * this.riverWidth * 0.8;
    const position = new THREE.Vector3(-40, -1.5, z);

    let instanceIndex: number;
    if (this.flowParticleData.length < this.maxFlowParticles) {
      instanceIndex = this.flowParticleData.length;
      this.flowParticleData.push({
        instanceIndex,
        position,
        speed: this.flowSpeed * (0.8 + Math.random() * 0.4),
        wobble: Math.random() * Math.PI * 2,
        lifetime: 15000,
        age: 0,
        size,
        opacity: 0.9,
      });
    } else {
      return; // Already at max
    }

    // Update instance
    this._tempPosition.copy(position);
    this._tempScale.setScalar(size);
    this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
    this.flowInstancedMesh.setMatrixAt(instanceIndex, this._tempMatrix);
    this.flowInstancedMesh.instanceMatrix.needsUpdate = true;
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Create waterfall burst effect
    this.createWaterfall();
  }

  private createWaterfall(): void {
    const particleCount = Math.min(30, this.maxWaterfallParticles - this.waterfallData.length);

    for (let i = 0; i < particleCount; i++) {
      const size = 0.2 + Math.random() * 0.3;

      // Color based on completion rate
      const baseColor = new THREE.Color(0x00CED1);
      const amberColor = new THREE.Color(txTypeColors.reverted);
      baseColor.lerp(amberColor, (1 - this.completionRate) * 0.5);

      // Waterfall spawns at left side, cascades down and flows right
      const z = (Math.random() - 0.5) * this.riverWidth * 0.6;
      const position = new THREE.Vector3(-35 + Math.random() * 5, 2, z);

      const velocity = new THREE.Vector3(
        this.flowSpeed * 0.5, // Flow right (+X)
        -0.1 - Math.random() * 0.1,
        (Math.random() - 0.5) * 0.1
      );

      let instanceIndex: number;
      if (this.waterfallData.length < this.maxWaterfallParticles) {
        instanceIndex = this.waterfallData.length;
        this.waterfallData.push({
          instanceIndex,
          position,
          velocity,
          lifetime: 3000,
          age: 0,
          size,
          opacity: 1.0,
          color: baseColor.getHex(),
        });
      } else {
        // Replace oldest
        const oldest = this.waterfallData.shift()!;
        instanceIndex = oldest.instanceIndex;
        this.waterfallData.push({
          instanceIndex,
          position,
          velocity,
          lifetime: 3000,
          age: 0,
          size,
          opacity: 1.0,
          color: baseColor.getHex(),
        });
      }

      // Update instance
      this._tempPosition.copy(position);
      this._tempScale.setScalar(size);
      this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
      this.waterfallInstancedMesh.setMatrixAt(instanceIndex, this._tempMatrix);

      this._tempColor.setHex(baseColor.getHex());
      this.waterfallInstancedMesh.setColorAt(instanceIndex, this._tempColor);
    }

    this.waterfallInstancedMesh.instanceMatrix.needsUpdate = true;
    if (this.waterfallInstancedMesh.instanceColor) {
      this.waterfallInstancedMesh.instanceColor.needsUpdate = true;
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
    // River is PlaneGeometry(80, width) - length is fixed, width varies
    const currentWidth = (this.riverMesh.geometry as THREE.PlaneGeometry).parameters.height;
    if (Math.abs(currentWidth - this.riverWidth) > 1) {
      this.riverMesh.geometry.dispose();
      this.riverMesh.geometry = new THREE.PlaneGeometry(80, this.riverWidth, 64, 32);
    }

    // Animate river flow with vertex displacement
    this.flowOffset += this.flowSpeed * deltaTime * 0.01;
    const positions = this.riverMesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      // Wave effect along X (flow direction)
      const wave = Math.sin(x * 0.1 + this.flowOffset * 5) * 0.3;
      const ripple = Math.sin(z * 0.3 + time * 2) * 0.1;
      positions.setY(i, wave + ripple);
    }
    positions.needsUpdate = true;

    // Update flow particles
    let flowNeedsUpdate = false;
    for (let i = this.flowParticleData.length - 1; i >= 0; i--) {
      const particle = this.flowParticleData[i];
      particle.age += deltaTime;

      // Move right along X-axis (LEFT to RIGHT flow)
      particle.position.x += particle.speed;

      // Gentle wobble in Z direction
      particle.wobble += deltaTime * 0.003;
      particle.position.z += Math.sin(particle.wobble) * 0.02;

      // Bob on the water
      particle.position.y = -1.5 + Math.sin(time * 3 + particle.wobble) * 0.2;

      // Fade out
      if (particle.age > particle.lifetime * 0.7) {
        const fadeProgress = (particle.age - particle.lifetime * 0.7) / (particle.lifetime * 0.3);
        particle.opacity = 1 - fadeProgress;
      }

      // Update instance matrix
      this._tempPosition.copy(particle.position);
      this._tempScale.setScalar(particle.size * Math.max(0.01, particle.opacity));
      this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
      this.flowInstancedMesh.setMatrixAt(particle.instanceIndex, this._tempMatrix);
      flowNeedsUpdate = true;

      // Remove if off screen (right side) or expired
      if (particle.position.x > 45 || particle.age > particle.lifetime) {
        this._tempMatrix.makeScale(0, 0, 0);
        this.flowInstancedMesh.setMatrixAt(particle.instanceIndex, this._tempMatrix);
        this.flowParticleData.splice(i, 1);
      }
    }

    if (flowNeedsUpdate) {
      this.flowInstancedMesh.instanceMatrix.needsUpdate = true;
    }

    // Update waterfall particles
    let waterfallNeedsUpdate = false;
    for (let i = this.waterfallData.length - 1; i >= 0; i--) {
      const wf = this.waterfallData[i];
      wf.age += deltaTime;

      // Apply velocity and gravity
      wf.position.add(wf.velocity);
      wf.velocity.y -= 0.005; // Gravity

      // Stop at river level
      if (wf.position.y < -1.5) {
        wf.position.y = -1.5;
        wf.velocity.y = 0;
        wf.velocity.z *= 0.95;
        wf.velocity.x = this.flowSpeed; // Join the rightward flow
      }

      // Fade out
      const fadeProgress = wf.age / wf.lifetime;
      wf.opacity = 1 - fadeProgress;

      // Update instance matrix
      this._tempPosition.copy(wf.position);
      this._tempScale.setScalar(wf.size * Math.max(0.01, wf.opacity));
      this._tempMatrix.compose(this._tempPosition, this._tempQuaternion, this._tempScale);
      this.waterfallInstancedMesh.setMatrixAt(wf.instanceIndex, this._tempMatrix);
      waterfallNeedsUpdate = true;

      if (wf.age > wf.lifetime) {
        this._tempMatrix.makeScale(0, 0, 0);
        this.waterfallInstancedMesh.setMatrixAt(wf.instanceIndex, this._tempMatrix);
        this.waterfallData.splice(i, 1);
      }
    }

    if (waterfallNeedsUpdate) {
      this.waterfallInstancedMesh.instanceMatrix.needsUpdate = true;
    }

    // Fixed side-on camera with subtle vertical bob (no orbiting)
    const camHeight = 20 + Math.sin(time * 0.1) * 2;
    this.camera.position.set(0, camHeight, 60);
    this.camera.lookAt(0, -2, 0);
  }

  getLegend(): LegendItem[] {
    return [
      { label: 'River Width', color: 0x00CED1, description: 'Total volume (wider = more activity)' },
      { label: 'River Brightness', color: 0xffffff, description: 'Revenue (brighter = more fees)' },
      { label: 'Cyan Water', color: 0x00CED1, description: 'Completed transactions' },
      { label: 'Amber Tint', color: txTypeColors.reverted, description: 'Reverted txs (volatility)' },
      { label: 'Flow Particles', color: 0x00CED1, description: 'Individual trades floating' },
      { label: 'Waterfall', color: 0x00CED1, description: 'Block boundary burst' },
    ];
  }

  dispose(): void {
    // Clean up flow instanced mesh
    this.flowInstancedMesh.geometry.dispose();
    (this.flowInstancedMesh.material as THREE.Material).dispose();
    this.scene.remove(this.flowInstancedMesh);
    this.flowParticleData = [];

    // Clean up waterfall instanced mesh
    this.waterfallInstancedMesh.geometry.dispose();
    (this.waterfallInstancedMesh.material as THREE.Material).dispose();
    this.scene.remove(this.waterfallInstancedMesh);
    this.waterfallData = [];

    this.riverMesh.geometry.dispose();
    this.riverMaterial.dispose();

    super.dispose();
  }
}

interface FlowParticleData {
  instanceIndex: number;
  position: THREE.Vector3;
  speed: number;
  wobble: number;
  lifetime: number;
  age: number;
  size: number;
  opacity: number;
}

interface WaterfallData {
  instanceIndex: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  lifetime: number;
  age: number;
  size: number;
  opacity: number;
  color: number;
}
