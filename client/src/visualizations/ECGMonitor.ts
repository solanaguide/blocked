import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import { volumeHeatmap } from '../utils/colors';
import type { TradeMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * ECGMonitor - ECG/heartbeat style display for network activity
 *
 * CONCEPT: Medical heart monitor visualization for blockchain "pulse".
 * - WAVEFORM = real-time trading activity (like ECG heartbeat)
 * - Wave HEIGHT = trade volume (log scale)
 * - Wave COLOR = volume heatmap (blue→purple→pink→red)
 * - Scrolls continuously from RIGHT to LEFT
 * - Block change = MASSIVE SPIKE (cardiac event / "block heartbeat")
 * - Flat line = no activity, spikes = high activity
 * - Shows multiple monitor lines for different metrics (trades, volume, programs)
 */
export class ECGMonitor extends BaseVisualization {
  private waveformLines: Map<string, WaveformLine> = new Map();
  private maxPoints = 200;
  private currentVolume = 0;
  private currentTrades = 0;
  private currentPrograms = new Set<string>();
  private updateInterval = 50; // Sample every 50ms for smooth ECG
  private lastUpdateTime = 0;
  private gridLines: THREE.Line[] = [];
  private blockPulse = 0;

  constructor() {
    super();

    this.camera.position.set(0, 0, 45);
    this.camera.lookAt(0, 0, 0);

    // Create ECG monitor grid
    this.createMonitorGrid();

    // Initialize waveform lines
    this.createWaveformLine('volume', 5, 0x00ff00);    // Top: Volume (green)
    this.createWaveformLine('trades', 0, 0x00ddff);    // Middle: Trade count (cyan)
    this.createWaveformLine('programs', -5, 0xff00ff); // Bottom: Program diversity (magenta)

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x004400, 0.3);
    this.scene.add(ambientLight);

    // Monitor glow
    const monitorGlow = new THREE.PointLight(0x00ff00, 0.5, 100);
    monitorGlow.position.set(0, 0, 10);
    this.scene.add(monitorGlow);
  }

  private createMonitorGrid(): void {
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x003300,
      transparent: true,
      opacity: 0.3,
    });

    // Horizontal lines
    for (let y = -15; y <= 15; y += 2.5) {
      const points = [
        new THREE.Vector3(-35, y, 0),
        new THREE.Vector3(35, y, 0),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, lineMaterial);
      this.scene.add(line);
      this.gridLines.push(line);
    }

    // Vertical lines
    for (let x = -35; x <= 35; x += 5) {
      const points = [
        new THREE.Vector3(x, -15, 0),
        new THREE.Vector3(x, 15, 0),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, lineMaterial);
      this.scene.add(line);
      this.gridLines.push(line);
    }

    // Add center line labels
    this.createLabel('VOLUME', 0, 8, 0x00ff00);
    this.createLabel('TRADES', 0, 3, 0x00ddff);
    this.createLabel('PROGRAMS', 0, -2, 0xff00ff);
  }

  private createLabel(text: string, x: number, y: number, color: number): void {
    // Simple label using a small plane (text rendering in Three.js is complex,
    // so we just use colored markers)
    const geometry = new THREE.PlaneGeometry(0.5, 0.5);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(x - 30, y, 0);
    this.scene.add(marker);
  }

  private createWaveformLine(id: string, yOffset: number, color: number): void {
    const points: number[] = [];
    for (let i = 0; i < this.maxPoints; i++) {
      points.push(yOffset); // Initialize at baseline
    }

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.maxPoints * 3);

    for (let i = 0; i < this.maxPoints; i++) {
      const x = (i / this.maxPoints) * 70 - 35;
      positions[i * 3] = x;
      positions[i * 3 + 1] = yOffset;
      positions[i * 3 + 2] = 0;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: 2,
    });

    const line = new THREE.Line(geometry, material);
    this.scene.add(line);

    this.waveformLines.set(id, {
      line,
      points,
      yOffset,
      baseColor: color,
    });
  }

  getName(): string {
    return 'ECG Monitor';
  }

  onTrade(trade: TradeMessage, slot: number): void {
    this.currentVolume += trade.vu;
    this.currentTrades++;
    this.currentPrograms.add(trade.p);
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    console.log(`💓 Block ${newSlot} complete - ${blockData.trades} trades`);

    // MASSIVE SPIKE for block completion (cardiac event)
    this.blockPulse = 12.0; // Large spike

    // Flash the grid
    this.gridLines.forEach(line => {
      (line.material as THREE.LineBasicMaterial).opacity = 0.8;
      (line.material as THREE.LineBasicMaterial).color.setHex(0x00ff00);
    });
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime() * 1000;

    // Sample data periodically
    if (time - this.lastUpdateTime > this.updateInterval) {
      this.updateWaveforms();
      this.lastUpdateTime = time;

      // Reset accumulators
      this.currentVolume = 0;
      this.currentTrades = 0;
      this.currentPrograms.clear();
    }

    // Decay block pulse
    if (this.blockPulse > 0) {
      this.blockPulse *= 0.9;
    }

    // Decay grid flash
    this.gridLines.forEach(line => {
      const material = line.material as THREE.LineBasicMaterial;
      if (material.opacity > 0.3) {
        material.opacity *= 0.98;
      }
      // Fade back to green
      const currentColor = material.color.getHex();
      if (currentColor !== 0x003300) {
        material.color.lerp(new THREE.Color(0x003300), 0.05);
      }
    });
  }

  private updateWaveforms(): void {
    // Update volume waveform
    const volumeLine = this.waveformLines.get('volume')!;
    const volumeAmplitude = Math.min(5, Math.log10(Math.max(1, this.currentVolume)) * 0.5);
    const volumeValue = volumeLine.yOffset + volumeAmplitude + this.blockPulse;
    this.updateWaveform(volumeLine, volumeValue);

    // Update trades waveform
    const tradesLine = this.waveformLines.get('trades')!;
    const tradesAmplitude = Math.min(4, this.currentTrades * 0.05);
    const tradesValue = tradesLine.yOffset + tradesAmplitude + this.blockPulse * 0.8;
    this.updateWaveform(tradesLine, tradesValue);

    // Update programs waveform
    const programsLine = this.waveformLines.get('programs')!;
    const programsAmplitude = Math.min(3, this.currentPrograms.size * 0.15);
    const programsValue = programsLine.yOffset + programsAmplitude + this.blockPulse * 0.6;
    this.updateWaveform(programsLine, programsValue);
  }

  private updateWaveform(waveform: WaveformLine, value: number): void {
    // Shift all points left
    waveform.points.shift();
    waveform.points.push(value);

    // Update geometry
    const positions = waveform.line.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < this.maxPoints; i++) {
      const x = (i / this.maxPoints) * 70 - 35;
      const y = waveform.points[i];

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
    }

    waveform.line.geometry.attributes.position.needsUpdate = true;

    // Update color based on intensity
    const intensity = Math.abs(value - waveform.yOffset);
    const heatColor = intensity > 5 ? 0xff0000 : intensity > 3 ? 0xff00ff : waveform.baseColor;
    (waveform.line.material as THREE.LineBasicMaterial).color.setHex(heatColor);
  }

  dispose(): void {
    this.waveformLines.forEach(waveform => {
      this.scene.remove(waveform.line);
      waveform.line.geometry.dispose();
      (waveform.line.material as THREE.Material).dispose();
    });
    this.waveformLines.clear();

    this.gridLines.forEach(line => {
      this.scene.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this.gridLines = [];

    super.dispose();
  }
}

interface WaveformLine {
  line: THREE.Line;
  points: number[];
  yOffset: number;
  baseColor: number;
}
