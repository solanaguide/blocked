import * as THREE from 'three';
import { BaseVisualization } from '../core/BaseVisualization';
import type { TradeMessage, BlockMessage } from '../../../shared/types';
import type { BlockData } from '../types';

/**
 * ECGMonitor - ECG/heartbeat style display for network activity
 *
 * CONCEPT: Medical heart monitor visualization for blockchain "pulse".
 * - Top line (GREEN) = Trade Volume (USD, log scale)
 * - Middle line (CYAN) = Trade Count (number of trades)
 * - Bottom line (MAGENTA) = Program Diversity (unique programs)
 * - Scrolls continuously from RIGHT to LEFT
 * - Pulses on every websocket batch update (network heartbeat)
 * - Shows real-time network activity like a medical monitor
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
  private batchPulse = 0;
  private labels: THREE.Sprite[] = [];

  // Block data for scaling (Revenue focus)
  private blockRevenue = 0;     // allFees + jitoTotal in SOL
  private blockVolume = 0;      // swapVolume + transferVolume in USD
  private completionRate = 1.0; // completed / (completed + reverted)

  constructor() {
    super();

    this.camera.position.set(0, 0, 45);
    this.camera.lookAt(0, 0, 0);

    // Create ECG monitor grid
    this.createMonitorGrid();

    // Initialize waveform lines with labels
    this.createWaveformLine('volume', 5, 0x00ff00, 'VOLUME (USD)');
    this.createWaveformLine('trades', 0, 0x00ddff, 'TRADES (COUNT)');
    this.createWaveformLine('programs', -5, 0xff00ff, 'PROGRAMS (UNIQUE)');

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
  }

  private createTextLabel(text: string, color: number): THREE.Sprite {
    // Create canvas for text
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 512;
    canvas.height = 128;

    // Draw text
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.font = 'Bold 48px monospace';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(text, 10, 64);

    // Create texture and sprite
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(12, 3, 1);

    return sprite;
  }

  private createWaveformLine(id: string, yOffset: number, color: number, label: string): void {
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

    // Add text label on left side
    const textLabel = this.createTextLabel(label, color);
    textLabel.position.set(-28, yOffset, 1);
    this.scene.add(textLabel);
    this.labels.push(textLabel);

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

    // Pulse on every batch (this gets called for each trade in batch)
    // Small pulse for individual trades
    this.batchPulse = Math.max(this.batchPulse, 0.5);
  }

  onBlockComplete(blockData: BlockData, oldSlot: number, newSlot: number): void {
    // Larger pulse for block completion - scaled by revenue
    const revenuePulse = Math.min(3.0, 1.5 + this.blockRevenue * 20);
    this.batchPulse = Math.max(this.batchPulse, revenuePulse);

    // Flash the grid - color based on completion rate
    const flashColor = this.completionRate > 0.7 ? 0x00ff00 : 0xffa500; // Green or amber
    this.gridLines.forEach(line => {
      (line.material as THREE.LineBasicMaterial).opacity = 0.8;
      (line.material as THREE.LineBasicMaterial).color.setHex(flashColor);
    });
  }

  /**
   * Handle rich block data - scale ECG by Revenue and Volume
   */
  onBlockData(block: BlockMessage): void {
    // Revenue (primary metric) - in SOL
    this.blockRevenue = (block.allFees + block.jitoTotal) / 1e9;

    // Volume (secondary metric) - in USD
    this.blockVolume = block.swapVolumeUsd + block.transferVolumeUsd;

    // Completion rate for color warmth
    const nonVote = block.completed + block.reverted;
    this.completionRate = nonVote > 0 ? block.completed / nonVote : 1.0;

    // Create spike for high priority fee events
    if (block.priorityMax > 1e9) { // > 1 SOL max priority
      this.batchPulse = Math.max(this.batchPulse, 4.0);
    }
  }

  update(deltaTime: number): void {
    const time = this.clock.getElapsedTime() * 1000;

    // Sample data periodically
    if (time - this.lastUpdateTime > this.updateInterval) {
      this.updateWaveforms();
      this.lastUpdateTime = time;

      // Reset accumulators after sampling
      this.currentVolume = 0;
      this.currentTrades = 0;
      this.currentPrograms.clear();
    }

    // Decay batch pulse
    if (this.batchPulse > 0) {
      this.batchPulse *= 0.92;
    }

    // Decay grid flash
    this.gridLines.forEach(line => {
      const material = line.material as THREE.LineBasicMaterial;
      if (material.opacity > 0.3) {
        material.opacity *= 0.98;
      }
      // Fade back to dark green
      const currentColor = material.color.getHex();
      if (currentColor !== 0x003300) {
        material.color.lerp(new THREE.Color(0x003300), 0.05);
      }
    });
  }

  private updateWaveforms(): void {
    // Scale factor based on block revenue (network heartbeat intensity)
    const revenueScale = Math.min(2.0, 1.0 + this.blockRevenue * 10);

    // Update volume waveform (scaled by trade volume + block volume)
    const volumeLine = this.waveformLines.get('volume')!;
    const volumeAmplitude = Math.min(5, Math.log10(Math.max(1, this.currentVolume + this.blockVolume * 0.001)) * 0.5);
    const volumeValue = volumeLine.yOffset + volumeAmplitude * revenueScale + this.batchPulse;
    this.updateWaveform(volumeLine, volumeValue);

    // Update trades waveform
    const tradesLine = this.waveformLines.get('trades')!;
    const tradesAmplitude = Math.min(4, this.currentTrades * 0.05);
    const tradesValue = tradesLine.yOffset + tradesAmplitude * revenueScale + this.batchPulse * 0.8;
    this.updateWaveform(tradesLine, tradesValue);

    // Update programs waveform
    const programsLine = this.waveformLines.get('programs')!;
    const programsAmplitude = Math.min(3, this.currentPrograms.size * 0.15);
    const programsValue = programsLine.yOffset + programsAmplitude * revenueScale + this.batchPulse * 0.6;
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
    const heatColor = intensity > 5 ? 0xff0000 : intensity > 3 ? 0xffff00 : waveform.baseColor;
    (waveform.line.material as THREE.LineBasicMaterial).color.setHex(heatColor);
  }

  dispose(): void {
    this.waveformLines.forEach(waveform => {
      this.scene.remove(waveform.line);
      waveform.line.geometry.dispose();
      (waveform.line.material as THREE.Material).dispose();
    });
    this.waveformLines.clear();

    this.labels.forEach(label => {
      this.scene.remove(label);
      if (label.material.map) label.material.map.dispose();
      label.material.dispose();
    });
    this.labels = [];

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
