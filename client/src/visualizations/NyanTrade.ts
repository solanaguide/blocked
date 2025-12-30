import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { tokenColors, hashColor } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * NyanTrade - Nyan Cat style with rainbow token area chart tail
 *
 * CONCEPT: Animated "trade cat" flying through space leaving rainbow trail.
 * - "Cat" = glowing cube representing current trade activity
 * - RAINBOW TAIL = stacked area chart of top tokens over time
 * - Each color band = a different token's volume
 * - Tail scrolls from RIGHT to LEFT (like Nyan Cat)
 * - Block change = CAT BOOST with sparkle effects
 * - More trading volume = longer, more colorful tail
 */
export class NyanTrade extends BaseVisualization {
  private cat: THREE.Mesh;
  private catGlow: THREE.PointLight;
  private tailSegments: TailSegment[] = [];
  private maxTailLength = 80;
  private tokenHistory: Map<string, number[]> = new Map();
  private updateInterval = 200; // Sample every 200ms
  private lastUpdateTime = 0;
  private catBounce = 0;
  private sparkles: THREE.Points[] = [];
  private pulseIntensity = 0;

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

  getName(): string {
    return 'Nyan Trade';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    const token = trade.ta || 'UNKNOWN';
    const volume = trade.vu;

    // Accumulate token volumes
    if (!this.tokenHistory.has(token)) {
      this.tokenHistory.set(token, []);
    }

    const history = this.tokenHistory.get(token)!;
    if (history.length === 0) {
      history.push(volume);
    } else {
      history[history.length - 1] += volume;
    }
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
    const time = this.clock.getElapsedTime() * 1000;

    // Sample data periodically and create tail segment
    if (time - this.lastUpdateTime > this.updateInterval) {
      this.createTailSegment();
      this.lastUpdateTime = time;

      // Add new entry to all token histories
      this.tokenHistory.forEach(history => {
        history.push(0);
        if (history.length > this.maxTailLength) {
          history.shift();
        }
      });
    }

    // Bounce cat up and down
    this.catBounce += deltaTime * 0.003;
    const bounceY = Math.sin(this.catBounce) * 2;
    this.cat.position.y = bounceY;
    this.catGlow.position.copy(this.cat.position);

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

    // Update tail segments (scroll left)
    this.tailSegments.forEach((segment, index) => {
      segment.mesh.position.x -= 0.1;

      // Fade out tail as it gets further from cat
      const distanceFromCat = this.cat.position.x - segment.mesh.position.x;
      const opacity = Math.max(0, 1 - distanceFromCat / 40);
      (segment.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

      // Remove segments that scrolled off screen
      if (segment.mesh.position.x < -50) {
        this.scene.remove(segment.mesh);
        segment.mesh.geometry.dispose();
        (segment.mesh.material as THREE.Material).dispose();
        this.tailSegments.splice(index, 1);
      }
    });

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
  }

  private createTailSegment(): void {
    if (!this.dataProcessor) return;

    // Get top 6 tokens for rainbow layers
    const topTokens = this.dataProcessor.getTopTokens(6);
    if (topTokens.length === 0) return;

    const segmentWidth = 0.5;
    const maxHeight = 8;

    // Calculate total volume for this time slice
    let totalVolume = 0;
    topTokens.forEach(token => {
      const history = this.tokenHistory.get(token);
      if (history && history.length > 0) {
        totalVolume += history[history.length - 1];
      }
    });

    if (totalVolume === 0) return;

    // Create stacked colored segments (area chart style)
    let currentY = 0;
    topTokens.forEach((token, index) => {
      const history = this.tokenHistory.get(token);
      if (!history || history.length === 0) return;

      const volume = history[history.length - 1];
      const volumeRatio = volume / totalVolume;
      const layerHeight = volumeRatio * maxHeight;

      if (layerHeight < 0.1) return;

      const color = tokenColors.get(token) || hashColor(token);

      const geometry = new THREE.PlaneGeometry(segmentWidth, layerHeight);
      const material = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        this.cat.position.x - 2, // Start just behind cat
        currentY + layerHeight / 2,
        0
      );

      this.scene.add(mesh);

      this.tailSegments.push({
        mesh,
        token,
      });

      currentY += layerHeight;
    });
  }

  dispose(): void {
    this.tailSegments.forEach(segment => {
      this.scene.remove(segment.mesh);
      segment.mesh.geometry.dispose();
      (segment.mesh.material as THREE.Material).dispose();
    });
    this.tailSegments = [];

    this.sparkles.forEach(sparkle => {
      this.scene.remove(sparkle);
      sparkle.geometry.dispose();
      (sparkle.material as THREE.Material).dispose();
    });
    this.sparkles = [];

    this.tokenHistory.clear();

    super.dispose();
  }
}

interface TailSegment {
  mesh: THREE.Mesh;
  token: string;
}
