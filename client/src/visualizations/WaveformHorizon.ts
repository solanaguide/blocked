import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { volumeHeatmap } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * WaveformHorizon - Synthwave oscilloscope visualization
 * Horizontal waveform with gradient coloring based on volume
 */
export class WaveformHorizon extends BaseVisualization {
  private waveformPoints: number[] = [];
  private waveformLine: THREE.Line | null = null;
  private waveformGeometry: THREE.BufferGeometry;
  private maxPoints = 200;
  private gridFloor: THREE.GridHelper;
  private screenFlash: number = 0;
  private currentVolume: number = 0;
  private volumeDecay: number = 0.95;

  // Synthwave sun
  private sun: THREE.Mesh;
  private sunGlow: THREE.PointLight;

  constructor() {
    super();

    // Position camera for horizon view
    this.camera.position.set(0, 5, 20);
    this.camera.lookAt(0, 0, -20);

    // Create synthwave grid floor
    this.gridFloor = new THREE.GridHelper(200, 100, 0xff006e, 0x8b5cf6);
    this.gridFloor.position.y = -5;
    this.gridFloor.rotation.x = Math.PI / 2;
    this.gridFloor.position.z = -50;
    this.gridFloor.material.opacity = 0.4;
    this.gridFloor.material.transparent = true;
    this.scene.add(this.gridFloor);

    // Create sun
    const sunGeometry = new THREE.SphereGeometry(8, 32, 32);
    const sunMaterial = new THREE.MeshStandardMaterial({
      color: 0xff006e,
      emissive: 0xff006e,
      emissiveIntensity: 1.5,
    });
    this.sun = new THREE.Mesh(sunGeometry, sunMaterial);
    this.sun.position.set(0, -2, -80);
    this.scene.add(this.sun);

    // Sun glow
    this.sunGlow = new THREE.PointLight(0xff006e, 2, 100);
    this.sunGlow.position.copy(this.sun.position);
    this.scene.add(this.sunGlow);

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0x8b5cf6, 0.3);
    this.scene.add(ambientLight);

    // Add purple rim light
    const rimLight = new THREE.DirectionalLight(0x8b5cf6, 0.5);
    rimLight.position.set(0, 10, 10);
    this.scene.add(rimLight);

    // Initialize waveform with zeros
    for (let i = 0; i < this.maxPoints; i++) {
      this.waveformPoints.push(0);
    }

    // Create waveform geometry
    this.waveformGeometry = new THREE.BufferGeometry();
    this.createWaveform();

    // Fog for depth
    this.scene.fog = new THREE.Fog(0x000000, 20, 100);
  }

  private createWaveform(): void {
    // Create line geometry from points
    const positions = new Float32Array(this.maxPoints * 3);
    const colors = new Float32Array(this.maxPoints * 3);

    for (let i = 0; i < this.maxPoints; i++) {
      const x = (i / this.maxPoints) * 60 - 30; // Spread across screen
      const y = this.waveformPoints[i];
      const z = 0;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Color based on amplitude
      const intensity = Math.abs(y) / 10;
      const color = new THREE.Color();

      if (intensity < 0.3) {
        color.setHex(0x00ddff); // Cyan
      } else if (intensity < 0.6) {
        color.setHex(0x8b5cf6); // Purple
      } else {
        color.setHex(0xff006e); // Hot pink
      }

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    this.waveformGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.waveformGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: 3,
    });

    if (this.waveformLine) {
      this.scene.remove(this.waveformLine);
    }

    this.waveformLine = new THREE.Line(this.waveformGeometry, material);
    this.scene.add(this.waveformLine);
  }

  getName(): string {
    return 'Waveform Horizon';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    // Add to current volume
    this.currentVolume += trade.vu;
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // BASS KICK: Screen flash effect
    this.screenFlash = 1.0;

    // Pulse the sun
    this.sunGlow.intensity = 5.0;

    // Flash the grid
    this.gridFloor.material.opacity = 0.9;
  }

  update(deltaTime: number): void {
    // Sample current volume into waveform every frame
    const amplitude = Math.log10(Math.max(1, this.currentVolume)) * 1.5;

    // Shift waveform left (older points move left)
    this.waveformPoints.shift();
    this.waveformPoints.push(amplitude);

    // Decay current volume for next sample
    this.currentVolume *= this.volumeDecay;

    // Update waveform geometry
    const positions = this.waveformGeometry.attributes.position.array as Float32Array;
    const colors = this.waveformGeometry.attributes.color.array as Float32Array;

    for (let i = 0; i < this.maxPoints; i++) {
      const x = (i / this.maxPoints) * 60 - 30;
      const y = this.waveformPoints[i];

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;

      // Color based on amplitude (gradient)
      const intensity = Math.abs(y) / 10;
      const color = new THREE.Color();

      if (intensity < 0.3) {
        color.setHex(0x00ddff); // Cyan
      } else if (intensity < 0.6) {
        color.setHex(0x8b5cf6); // Purple
      } else {
        color.setHex(0xff006e); // Hot pink
      }

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    this.waveformGeometry.attributes.position.needsUpdate = true;
    this.waveformGeometry.attributes.color.needsUpdate = true;

    // Decay screen flash
    if (this.screenFlash > 0) {
      this.screenFlash *= 0.9;
      // Apply flash to background
      this.scene.fog!.color.setRGB(this.screenFlash, this.screenFlash, this.screenFlash);
    }

    // Decay sun pulse
    if (this.sunGlow.intensity > 2) {
      this.sunGlow.intensity *= 0.95;
    }

    // Decay grid flash
    if (this.gridFloor.material.opacity > 0.4) {
      this.gridFloor.material.opacity *= 0.96;
    }

    // Subtle camera sway
    const time = this.clock.getElapsedTime();
    this.camera.position.x = Math.sin(time * 0.2) * 2;
    this.camera.position.y = 5 + Math.sin(time * 0.3) * 0.5;
  }

  dispose(): void {
    if (this.waveformLine) {
      this.scene.remove(this.waveformLine);
      if (this.waveformLine.geometry) this.waveformLine.geometry.dispose();
      if (this.waveformLine.material) (this.waveformLine.material as THREE.Material).dispose();
    }

    super.dispose();
  }
}
