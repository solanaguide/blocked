import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { tokenColors, hashColor } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * NyanTrade - Nyan Cat style with continuous rainbow token stream tail
 *
 * CONCEPT: Animated "trade cat" flying through space leaving rainbow trail.
 * - "Cat" = glowing cube representing current trade activity
 * - RAINBOW TAIL = continuous flowing stacked area chart
 * - Each colored layer grows/shrinks based on token trading volume
 * - Updates on every websocket trade batch
 * - Tail flows smoothly behind cat (like Nyan Cat)
 * - Block change = CAT BOOST with sparkle effects
 */
export class NyanTrade extends BaseVisualization {
  private cat: THREE.Mesh;
  private catGlow: THREE.PointLight;
  private tailRibbon: THREE.Mesh | null = null;
  private tailGeometry: THREE.BufferGeometry | null = null;
  private tailSegments = 80; // Number of vertical slices in the ribbon
  private tailVerticesPerSegment = 12; // Vertices per vertical slice
  private catBounce = 0;
  private sparkles: THREE.Points[] = [];
  private pulseIntensity = 0;
  private currentTokenVolumes: Map<string, number> = new Map();
  private volumeDecayRate = 0.97;

  // Block data for scaling (Volume focus)
  private blockVolume = 0;        // swapVolume + transferVolume
  private blockRevenue = 0;       // allFees + jitoTotal
  private tailHeightScale = 1.0;  // Scales tail height based on volume

  constructor() {
    super();

    this.camera.position.set(0, 5, 40);
    this.camera.lookAt(0, 0, 0);

    // Create the "cat" (glowing cube)
    const catGeometry = new THREE.BoxGeometry(3, 3, 3);
    const catMaterial = new THREE.MeshStandardMaterial({
      color: 0xff006e,
      emissive: 0xff006e,
      emissiveIntensity: 1.5,
      metalness: 0.8,
      roughness: 0.2,
    });

    this.cat = new THREE.Mesh(catGeometry, catMaterial);
    this.cat.position.set(15, 0, 0); // Cat flies on right side
    this.scene.add(this.cat);

    // Cat glow
    this.catGlow = new THREE.PointLight(0xff006e, 3, 30);
    this.catGlow.position.copy(this.cat.position);
    this.scene.add(this.catGlow);

    // Create initial rainbow tail ribbon
    this.createTailRibbon();

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambientLight);

    // Stars in background
    this.createStarfield();
  }

  private createStarfield(): void {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 400;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 50 - 20;
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.3,
      transparent: true,
      opacity: 0.6,
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(stars);
  }

  private createTailRibbon(): void {
    // Create a custom geometry for the ribbon
    const vertexCount = (this.tailSegments + 1) * this.tailVerticesPerSegment;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);

    // Initialize geometry
    this.updateTailGeometry(positions, colors);

    this.tailGeometry = new THREE.BufferGeometry();
    this.tailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.tailGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Create indices for triangles
    const indices: number[] = [];
    for (let i = 0; i < this.tailSegments; i++) {
      for (let j = 0; j < this.tailVerticesPerSegment - 1; j++) {
        const a = i * this.tailVerticesPerSegment + j;
        const b = a + this.tailVerticesPerSegment;
        const c = a + 1;
        const d = b + 1;

        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }
    this.tailGeometry.setIndex(indices);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });

    this.tailRibbon = new THREE.Mesh(this.tailGeometry, material);
    this.tailRibbon.position.set(-10, 0, 0); // Position behind cat
    this.scene.add(this.tailRibbon);

    // Make tail ribbon interactive
    this.interactiveObjects.push({
      mesh: this.tailRibbon,
      data: {
        // Will be updated dynamically in update()
      },
    });
  }

  private updateTailGeometry(positions: Float32Array, colors: Float32Array): void {
    if (!this.dataProcessor) return;

    // Get top 6 tokens for rainbow layers
    const topTokens = this.dataProcessor.getTopTokens(6);
    const tokenVolumes = this.dataProcessor.getTokenVolumes();

    // Calculate total volume
    let totalVolume = 0;
    topTokens.forEach(token => {
      const volume = tokenVolumes.get(token) || 0;
      this.currentTokenVolumes.set(token, volume);
      totalVolume += volume;
    });

    if (totalVolume === 0) totalVolume = 1;

    const tailLength = 50;
    const maxTailHeight = 10 * this.tailHeightScale; // Scale by block volume

    // Create stacked area chart
    for (let i = 0; i <= this.tailSegments; i++) {
      const xPos = -i * (tailLength / this.tailSegments);
      const fadeAmount = i / this.tailSegments;

      // Calculate heights for each token (stacked)
      let currentHeight = 0;
      const tokenHeights: { token: string; height: number; color: THREE.Color }[] = [];

      topTokens.forEach(token => {
        const volume = this.currentTokenVolumes.get(token) || 0;
        const volumeRatio = volume / totalVolume;
        const height = volumeRatio * maxTailHeight * (1 - fadeAmount * 0.3); // Fade height towards back

        const rawColor = tokenColors.get(token) || hashColor(token);
        const color = new THREE.Color(rawColor);
        color.multiplyScalar(1 - fadeAmount * 0.5); // Fade brightness towards back

        tokenHeights.push({ token, height, color });
      });

      // Create vertices for this vertical slice
      let accumulatedHeight = -maxTailHeight / 2; // Start at bottom center

      for (let j = 0; j < this.tailVerticesPerSegment; j++) {
        const vertexIndex = i * this.tailVerticesPerSegment + j;

        // Determine which token this vertex belongs to
        const normalizedJ = j / (this.tailVerticesPerSegment - 1);
        const targetHeight = normalizedJ * maxTailHeight - maxTailHeight / 2;

        // Find color based on stacked token heights
        let currentStackHeight = -maxTailHeight / 2;
        let vertexColor = new THREE.Color(0x000000);

        for (const { height, color } of tokenHeights) {
          if (targetHeight < currentStackHeight + height) {
            vertexColor = color;
            break;
          }
          currentStackHeight += height;
        }

        // Set position
        positions[vertexIndex * 3] = xPos;
        positions[vertexIndex * 3 + 1] = targetHeight;
        positions[vertexIndex * 3 + 2] = 0;

        // Set color
        colors[vertexIndex * 3] = vertexColor.r;
        colors[vertexIndex * 3 + 1] = vertexColor.g;
        colors[vertexIndex * 3 + 2] = vertexColor.b;
      }
    }
  }

  getName(): string {
    return 'Nyan Trade';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const token = trade.ta || 'UNKNOWN';
    const volume = trade.vu;

    // Accumulate volume for this token
    const currentVol = this.currentTokenVolumes.get(token) || 0;
    this.currentTokenVolumes.set(token, currentVol + volume);

    // Update tail geometry immediately on every trade
    if (this.tailGeometry) {
      const positions = this.tailGeometry.attributes.position.array as Float32Array;
      const colors = this.tailGeometry.attributes.color.array as Float32Array;
      this.updateTailGeometry(positions, colors);
      this.tailGeometry.attributes.position.needsUpdate = true;
      this.tailGeometry.attributes.color.needsUpdate = true;
    }
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // CAT BOOST effect - scaled by revenue
    const revenuePulse = Math.min(3.0, 1.5 + this.blockRevenue * 15);
    this.pulseIntensity = revenuePulse;
    this.createSparkles();
  }

  /**
   * Handle rich block data - scale Nyan by Volume
   */
  onBlockData(block: BlockMessage): void {
    // Volume (primary metric) - affects tail width
    this.blockVolume = block.swapVolumeUsd + block.transferVolumeUsd;

    // Revenue (secondary) - affects brightness/glow
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9;

    // Scale tail height based on volume (1M = normal, 10M = double)
    this.tailHeightScale = Math.min(2.0, 0.5 + Math.log10(Math.max(1, this.blockVolume)) * 0.2);

    // Update cat glow intensity based on revenue
    if (this.catGlow) {
      this.catGlow.intensity = Math.min(8, 3 + this.blockRevenue * 50);
    }
  }

  private createSparkles(): void {
    // Create sparkle burst around cat
    const sparkleCount = 50;
    const positions = new Float32Array(sparkleCount * 3);
    const catPos = this.cat.position;

    for (let i = 0; i < sparkleCount; i++) {
      positions[i * 3] = catPos.x + (Math.random() - 0.5) * 10;
      positions[i * 3 + 1] = catPos.y + (Math.random() - 0.5) * 10;
      positions[i * 3 + 2] = catPos.z + (Math.random() - 0.5) * 10;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      transparent: true,
      opacity: 1,
    });

    const sparkle = new THREE.Points(geometry, material);
    this.scene.add(sparkle);
    this.sparkles.push(sparkle);
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime();

    // Decay all token volumes for smooth transitions
    this.currentTokenVolumes.forEach((volume, token) => {
      this.currentTokenVolumes.set(token, volume * this.volumeDecayRate);
    });

    // Update tail geometry continuously
    if (this.tailGeometry) {
      const positions = this.tailGeometry.attributes.position.array as Float32Array;
      const colors = this.tailGeometry.attributes.color.array as Float32Array;
      this.updateTailGeometry(positions, colors);
      this.tailGeometry.attributes.position.needsUpdate = true;
      this.tailGeometry.attributes.color.needsUpdate = true;
    }

    // Update interactive data for tail ribbon tooltip
    if (this.tailRibbon && this.dataProcessor && this.interactiveObjects.length > 0) {
      const topTokens = this.dataProcessor.getTopTokens(6);
      const totalVolume = Array.from(this.currentTokenVolumes.values()).reduce((a, b) => a + b, 0);
      const obj = this.interactiveObjects.find(o => o.mesh === this.tailRibbon);
      if (obj) {
        obj.data = {
          token: topTokens.slice(0, 3).join(', '),
          volume: totalVolume,
          programs: topTokens.length,
        };
      }
    }

    // Bounce cat up and down
    this.catBounce += deltaTime * 0.003;
    const bounceY = Math.sin(this.catBounce) * 2;
    this.cat.position.y = bounceY;
    this.catGlow.position.copy(this.cat.position);

    // Update tail position to follow cat
    if (this.tailRibbon) {
      this.tailRibbon.position.y = bounceY;
    }

    // Rotate cat
    this.cat.rotation.y += deltaTime * 0.002;
    this.cat.rotation.z = Math.sin(this.catBounce * 0.5) * 0.1;

    // Apply pulse effect
    if (this.pulseIntensity > 0) {
      this.pulseIntensity *= 0.95;
      const scale = 1 + this.pulseIntensity * 0.3;
      this.cat.scale.set(scale, scale, scale);
      (this.cat.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 + this.pulseIntensity;
      this.catGlow.intensity = 3 + this.pulseIntensity * 5;
    }

    // Update sparkles
    this.sparkles.forEach((sparkle, index) => {
      (sparkle.material as THREE.PointsMaterial).opacity *= 0.95;
      sparkle.position.x -= 0.2; // Drift left

      if ((sparkle.material as THREE.PointsMaterial).opacity < 0.05) {
        this.scene.remove(sparkle);
        sparkle.geometry.dispose();
        (sparkle.material as THREE.Material).dispose();
        this.sparkles.splice(index, 1);
      }
    });

    // Gentle wave motion in tail
    if (this.tailGeometry) {
      const positions = this.tailGeometry.attributes.position.array as Float32Array;
      for (let i = 0; i <= this.tailSegments; i++) {
        for (let j = 0; j < this.tailVerticesPerSegment; j++) {
          const vertexIndex = (i * this.tailVerticesPerSegment + j) * 3;
          const waveOffset = Math.sin(time * 2 + i * 0.1) * 0.3;
          positions[vertexIndex + 2] = waveOffset; // Z offset for wave
        }
      }
      this.tailGeometry.attributes.position.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.tailRibbon) {
      this.scene.remove(this.tailRibbon);
      if (this.tailGeometry) this.tailGeometry.dispose();
      (this.tailRibbon.material as THREE.Material).dispose();
    }

    this.sparkles.forEach(sparkle => {
      this.scene.remove(sparkle);
      sparkle.geometry.dispose();
      (sparkle.material as THREE.Material).dispose();
    });
    this.sparkles = [];

    this.currentTokenVolumes.clear();

    super.dispose();
  }
}
