import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { tokenColors, hashColor } from '../utils/colors';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';
import type { LegendItem } from '../hud/Legend';

/**
 * NyanTrade - Bonk Dog style with continuous rainbow token stream tail
 *
 * CONCEPT: Animated "Bonk dog" flying through space leaving rainbow trail.
 * - "Dog" = Bonk-inspired sprite representing current trade activity
 * - RAINBOW TAIL = continuous flowing stacked area chart showing token distribution
 * - Each colored layer grows/shrinks based on token trading volume
 * - Updates on every websocket trade batch
 * - Tail flows smoothly behind dog (like Nyan Cat but with Bonk)
 * - Block change = DOG BOOST with sparkle effects
 * - Grid lines behind tail to emphasize it's a chart
 */
export class NyanTrade extends BaseVisualization {
  private dog: THREE.Group; // Changed from cat to dog
  private dogGlow: THREE.PointLight;
  private tailRibbon: THREE.Mesh | null = null;
  private tailGeometry: THREE.BufferGeometry | null = null;
  private tailSegments = 80; // Number of vertical slices in the ribbon
  private tailVerticesPerSegment = 12; // Vertices per vertical slice
  private dogBounce = 0;
  private sparkles: THREE.Points[] = [];
  private pulseIntensity = 0;
  private currentTokenVolumes: Map<string, number> = new Map();
  private volumeDecayRate = 0.97;
  private chartGrid: THREE.Group | null = null;
  private tokenLabels: THREE.Sprite[] = [];
  private lastLabelUpdateTime = 0;
  private labelUpdateInterval = 2000; // Update labels every 2 seconds

  // Block data for scaling (Volume focus)
  private blockVolume = 0;        // swapVolume + transferVolume
  private blockRevenue = 0;       // allFees + jitoTotal
  private tailHeightScale = 1.0;  // Scales tail height based on volume

  constructor() {
    super();

    this.camera.position.set(0, 5, 40);
    this.camera.lookAt(0, 0, 0);

    // Create the "Bonk Dog" (stylized Shiba sprite)
    this.dog = this.createBonkDog();
    this.dog.position.set(15, 0, 0); // Dog flies on right side
    this.scene.add(this.dog);

    // Dog glow (Bonk yellow/orange)
    this.dogGlow = new THREE.PointLight(0xf0a000, 3, 30);
    this.dogGlow.position.copy(this.dog.position);
    this.scene.add(this.dogGlow);

    // Create chart grid behind tail (makes it clear it's a chart)
    this.createChartGrid();

    // Create initial rainbow tail ribbon
    this.createTailRibbon();

    // Create Y-axis token labels (initially hidden, updated when data available)
    this.createTokenLabels();

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambientLight);

    // Stars in background
    this.createStarfield();
  }

  /**
   * Create a stylized Bonk Dog character
   */
  private createBonkDog(): THREE.Group {
    const group = new THREE.Group();

    // Bonk-colored body (shiba yellow/tan)
    const bodyGeometry = new THREE.CylinderGeometry(1.5, 1.8, 2.5, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0a000, // Bonk yellow
      emissive: 0xf0a000,
      emissiveIntensity: 0.8,
      metalness: 0.3,
      roughness: 0.5,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.rotation.z = Math.PI / 2;
    group.add(body);

    // Head (larger sphere)
    const headGeometry = new THREE.SphereGeometry(1.3, 16, 16);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0a000,
      emissive: 0xf0a000,
      emissiveIntensity: 0.8,
      metalness: 0.3,
      roughness: 0.5,
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.set(1.8, 0.3, 0);
    group.add(head);

    // Snout (lighter color)
    const snoutGeometry = new THREE.SphereGeometry(0.6, 8, 8);
    const snoutMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd080,
      emissive: 0xffd080,
      emissiveIntensity: 0.5,
    });
    const snout = new THREE.Mesh(snoutGeometry, snoutMaterial);
    snout.position.set(2.8, 0, 0);
    snout.scale.set(0.8, 0.6, 0.6);
    group.add(snout);

    // Ears (pointy triangles)
    const earGeometry = new THREE.ConeGeometry(0.4, 0.8, 3);
    const earMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0a000,
      emissive: 0xf0a000,
      emissiveIntensity: 0.8,
    });

    const leftEar = new THREE.Mesh(earGeometry, earMaterial);
    leftEar.position.set(1.4, 1.2, 0.6);
    leftEar.rotation.z = -0.3;
    group.add(leftEar);

    const rightEar = new THREE.Mesh(earGeometry, earMaterial);
    rightEar.position.set(1.4, 1.2, -0.6);
    rightEar.rotation.z = -0.3;
    group.add(rightEar);

    // Eyes (dark with white glint)
    const eyeGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const eyeMaterial = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0x000000,
    });

    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(2.4, 0.6, 0.5);
    group.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(2.4, 0.6, -0.5);
    group.add(rightEye);

    // Tail (stubby waggy)
    const tailGeometry = new THREE.CylinderGeometry(0.2, 0.4, 1.2, 6);
    const tail = new THREE.Mesh(tailGeometry, bodyMaterial);
    tail.position.set(-2, 0.5, 0);
    tail.rotation.z = Math.PI / 4;
    group.add(tail);

    return group;
  }

  /**
   * Create grid lines behind the tail to show it's a chart
   */
  private createChartGrid(): void {
    this.chartGrid = new THREE.Group();

    const gridMaterial = new THREE.LineBasicMaterial({
      color: 0x333366,
      transparent: true,
      opacity: 0.4,
    });

    // Horizontal grid lines
    for (let i = -5; i <= 5; i++) {
      const points = [
        new THREE.Vector3(-60, i * 2, -2),
        new THREE.Vector3(10, i * 2, -2),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, gridMaterial);
      this.chartGrid.add(line);
    }

    // Vertical grid lines
    for (let i = -12; i <= 2; i++) {
      const points = [
        new THREE.Vector3(i * 5, -10, -2),
        new THREE.Vector3(i * 5, 10, -2),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, gridMaterial);
      this.chartGrid.add(line);
    }

    this.scene.add(this.chartGrid);
  }

  /**
   * Create Y-axis token labels (updated dynamically as data arrives)
   */
  private createTokenLabels(): void {
    // Labels will be created/updated in updateTokenLabels() when data is available
  }

  /**
   * Create a text sprite for token label
   */
  private createTextSprite(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;

    // Draw text
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.font = 'Bold 32px monospace';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    context.fillText(text, 240, 32);

    // Create texture and sprite
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(6, 1.5, 1);

    return sprite;
  }

  /**
   * Update Y-axis token labels based on current top tokens
   */
  private updateTokenLabels(): void {
    if (!this.dataProcessor) return;

    const topTokens = this.dataProcessor.getTopTokens(6);
    if (topTokens.length === 0) return;

    // Remove old labels
    this.tokenLabels.forEach(label => {
      this.scene.remove(label);
      if (label.material.map) label.material.map.dispose();
      label.material.dispose();
    });
    this.tokenLabels = [];

    // Calculate Y positions for stacked tokens (evenly distributed)
    const maxHeight = 10 * this.tailHeightScale;
    const startY = -maxHeight / 2;
    const heightPerToken = maxHeight / topTokens.length;

    // Create new labels positioned on Y-axis (left side of chart)
    topTokens.forEach((token, index) => {
      const rawColor = tokenColors.get(token) || hashColor(token);
      const label = this.createTextSprite(token, rawColor);

      // Position on left edge of chart grid, at center of each token's band
      const yPos = startY + (index + 0.5) * heightPerToken;
      label.position.set(-58, yPos, 0);

      this.scene.add(label);
      this.tokenLabels.push(label);
    });
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
    if (this.dogGlow) {
      this.dogGlow.intensity = Math.min(8, 3 + this.blockRevenue * 50);
    }
  }

  private createSparkles(): void {
    // Create sparkle burst around cat
    const sparkleCount = 50;
    const positions = new Float32Array(sparkleCount * 3);
    const catPos = this.dog.position;

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
    const timeMs = time * 1000;

    // Decay all token volumes for smooth transitions
    this.currentTokenVolumes.forEach((volume, token) => {
      this.currentTokenVolumes.set(token, volume * this.volumeDecayRate);
    });

    // Update Y-axis token labels periodically (not every frame)
    if (timeMs - this.lastLabelUpdateTime > this.labelUpdateInterval) {
      this.updateTokenLabels();
      this.lastLabelUpdateTime = timeMs;
    }

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
    this.dogBounce += deltaTime * 0.003;
    const bounceY = Math.sin(this.dogBounce) * 2;
    this.dog.position.y = bounceY;
    this.dogGlow.position.copy(this.dog.position);

    // Update tail position to follow cat
    if (this.tailRibbon) {
      this.tailRibbon.position.y = bounceY;
    }

    // Rotate cat
    this.dog.rotation.y += deltaTime * 0.002;
    this.dog.rotation.z = Math.sin(this.dogBounce * 0.5) * 0.1;

    // Apply pulse effect
    if (this.pulseIntensity > 0) {
      this.pulseIntensity *= 0.95;
      const scale = 1 + this.pulseIntensity * 0.3;
      this.dog.scale.set(scale, scale, scale);
      // Pulse the dog's body glow (first child is body mesh)
      this.dog.children.forEach(child => {
        if ((child as THREE.Mesh).material) {
          ((child as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + this.pulseIntensity * 0.5;
        }
      });
      this.dogGlow.intensity = 3 + this.pulseIntensity * 5;
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

  getLegend(): LegendItem[] {
    return [
      { label: 'Bonk Dog', color: 0xf0a000, description: 'Current trading activity' },
      { label: 'Rainbow Tail', color: 0xff0000, description: 'Stacked area chart of token volumes' },
      { label: 'Layer Color', color: 0x00ff00, description: 'Token identity (SOL, USDC, etc.)' },
      { label: 'Layer Height', color: 0x00CED1, description: 'Relative token volume share' },
      { label: 'Boost Effect', color: 0xffffff, description: 'New block arrival' },
    ];
  }

  dispose(): void {
    if (this.tailRibbon) {
      this.scene.remove(this.tailRibbon);
      if (this.tailGeometry) this.tailGeometry.dispose();
      (this.tailRibbon.material as THREE.Material).dispose();
    }

    // Dispose dog
    this.dog.children.forEach(child => {
      if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
      if ((child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.Material).dispose();
    });
    this.scene.remove(this.dog);

    // Dispose chart grid
    if (this.chartGrid) {
      this.chartGrid.children.forEach(child => {
        if ((child as THREE.Line).geometry) (child as THREE.Line).geometry.dispose();
        if ((child as THREE.Line).material) ((child as THREE.Line).material as THREE.Material).dispose();
      });
      this.scene.remove(this.chartGrid);
    }

    this.sparkles.forEach(sparkle => {
      this.scene.remove(sparkle);
      sparkle.geometry.dispose();
      (sparkle.material as THREE.Material).dispose();
    });
    this.sparkles = [];

    // Dispose token labels
    this.tokenLabels.forEach(label => {
      this.scene.remove(label);
      if (label.material.map) label.material.map.dispose();
      label.material.dispose();
    });
    this.tokenLabels = [];

    this.currentTokenVolumes.clear();

    super.dispose();
  }
}
