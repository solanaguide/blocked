import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { tokenColors, hashColor } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * NyanTrade - Nyan Cat style with continuous rainbow token stream tail
 *
 * CONCEPT: Animated "trade cat" flying through space leaving rainbow trail.
 * - "Cat" = glowing cube representing current trade activity
 * - RAINBOW TAIL = continuous flowing ribbon showing token distribution
 * - Each colored layer = a different token's volume proportion
 * - Tail flows smoothly behind cat (like Nyan Cat)
 * - Block change = CAT BOOST with sparkle effects
 * - More trading volume = more colorful tail
 */
export class NyanTrade extends BaseVisualization {
  private cat: THREE.Mesh;
  private catGlow: THREE.PointLight;
  private tailRibbon: THREE.Mesh | null = null;
  private tailGeometry: THREE.PlaneGeometry | null = null;
  private tailSegments = 100; // Number of segments in the ribbon
  private tailWidth = 8;
  private catBounce = 0;
  private sparkles: THREE.Points[] = [];
  private pulseIntensity = 0;
  private lastTailUpdateTime = 0;
  private tailUpdateInterval = 100; // Update tail every 100ms

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
    // Create a ribbon mesh that extends behind the cat
    this.tailGeometry = new THREE.PlaneGeometry(50, this.tailWidth, this.tailSegments, 10);

    // Create vertex colors for rainbow effect
    const colors = new Float32Array((this.tailSegments + 1) * 11 * 3); // segments+1 x 11 vertices per row
    this.updateTailColors(colors);

    this.tailGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });

    this.tailRibbon = new THREE.Mesh(this.tailGeometry, material);
    this.tailRibbon.position.set(-10, 0, 0); // Position behind cat
    this.scene.add(this.tailRibbon);
  }

  private updateTailColors(colors: Float32Array): void {
    if (!this.dataProcessor) return;

    // Get top 6 tokens for rainbow layers
    const topTokens = this.dataProcessor.getTopTokens(6);
    const tokenVolumes = this.dataProcessor.getTokenVolumes();

    if (topTokens.length === 0) {
      // Default rainbow if no data
      for (let i = 0; i < colors.length / 3; i++) {
        const rainbowColors = [0xff0000, 0xff7f00, 0xffff00, 0x00ff00, 0x0000ff, 0x9400d3];
        const colorIndex = Math.floor((i % (this.tailSegments + 1)) / (this.tailSegments + 1) * rainbowColors.length);
        const color = new THREE.Color(rainbowColors[colorIndex]);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      return;
    }

    // Calculate total volume
    let totalVolume = 0;
    topTokens.forEach(token => {
      totalVolume += tokenVolumes.get(token) || 0;
    });

    if (totalVolume === 0) totalVolume = 1;

    // Assign colors based on token volumes
    // Each vertical band gets colors from token distribution
    for (let i = 0; i <= this.tailSegments; i++) {
      // Calculate which tokens are visible at this position
      // Closer to cat = current data, further away = fades
      const fadeAmount = i / this.tailSegments;

      let currentHeight = 0;
      const heightStep = this.tailWidth / 10; // 11 vertices vertically (0-10)

      for (let j = 0; j <= 10; j++) {
        const vertexIndex = i * 11 + j;
        const normalizedHeight = j / 10; // 0 to 1

        // Find which token this height corresponds to
        let accumulatedRatio = 0;
        let tokenColor = new THREE.Color(0x8b5cf6); // Default purple

        for (const token of topTokens) {
          const volume = tokenVolumes.get(token) || 0;
          const ratio = volume / totalVolume;
          accumulatedRatio += ratio;

          if (normalizedHeight <= accumulatedRatio) {
            const rawColor = tokenColors.get(token) || hashColor(token);
            tokenColor = new THREE.Color(rawColor);
            break;
          }
        }

        // Apply fade based on distance from cat
        const opacity = 1 - fadeAmount * 0.5;
        tokenColor.multiplyScalar(opacity);

        colors[vertexIndex * 3] = tokenColor.r;
        colors[vertexIndex * 3 + 1] = tokenColor.g;
        colors[vertexIndex * 3 + 2] = tokenColor.b;
      }
    }
  }

  getName(): string {
    return 'Nyan Trade';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    // Trades automatically update dataProcessor's token volumes
    // We just need to periodically update the tail colors
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    console.log(`🌈 Block ${newSlot} complete - ${blockData.trades} trades`);

    // CAT BOOST effect
    this.pulseIntensity = 2.0;
    this.createSparkles();
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

    // Update tail colors periodically
    if (time * 1000 - this.lastTailUpdateTime > this.tailUpdateInterval) {
      if (this.tailGeometry) {
        const colors = this.tailGeometry.attributes.color.array as Float32Array;
        this.updateTailColors(colors);
        this.tailGeometry.attributes.color.needsUpdate = true;
      }
      this.lastTailUpdateTime = time * 1000;
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
        for (let j = 0; j <= 10; j++) {
          const vertexIndex = (i * 11 + j) * 3;
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

    super.dispose();
  }
}
