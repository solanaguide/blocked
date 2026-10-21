import * as THREE from 'three';
import type { Block } from '../feed';
import type { Stats } from '../stats';
import type { Preset, Frame, TradeEvent, Kpi } from './types';
import { NeonBoxes } from '../world/neonboxes';
import { TextSprite, DISPLAY } from '../world/labels';
import { LIMITS, fmtUsd, fmtInt } from '../palette';

const BINS = 24;            // quarter-decade trade-size bands, $1M+ down to $1
const SEG = 18;             // LED segments per bar
const BAR_W = 0.56;
const GAP = 0.16;
const SEG_H = 0.26;
const SEG_GAP = 0.07;
const SCOPE_N = 180;        // slots in the oscilloscope trace

const CYAN = new THREE.Color('#18e8ff');
const WHITE = new THREE.Color('#e8fbff');
const ORANGE = new THREE.Color('#ff7a18');
const GHOST = new THREE.Color('#062029');

const bandX = (i: number) => (i - (BINS - 1) / 2) * (BAR_W + GAP);
const SAMPLE = 4000;        // recent trades used to place band edges

/**
 * Band edges split recent dollar volume into equal shares, so each bar
 * carries the same expected energy. Volume concentrates in large trades, so
 * this naturally gives the whale end more (and busier) bars than a fixed
 * log axis would. Edges are descending: edges[i] is band i's lower bound.
 */
class Bands {
  edges = Float64Array.from({ length: BINS }, (_, i) => Math.pow(10, 6 - (i + 1) * 0.25));
  private sample: number[] = [];

  observe(sizes: number[]) {
    for (const s of sizes) if (s > 0) this.sample.push(s);
    if (this.sample.length > SAMPLE) this.sample.splice(0, this.sample.length - SAMPLE);
  }

  recompute() {
    if (this.sample.length < 60) return;
    const s = [...this.sample].sort((a, b) => b - a);
    const total = s.reduce((a, b) => a + b, 0);
    let cum = 0, k = 0;
    for (const v of s) {
      cum += v;
      while (k < BINS - 1 && cum >= (total * (k + 1)) / BINS) {
        // ease in log space so labels and bars don't jump
        const next = Math.log(Math.max(v, 0.01));
        this.edges[k] = Math.exp(Math.log(this.edges[k]) * 0.6 + next * 0.4);
        k++;
      }
    }
    this.edges[BINS - 1] = 0;
  }

  of(usd: number) {
    for (let i = 0; i < BINS; i++) if (usd >= this.edges[i]) return i;
    return BINS - 1;
  }

  /** A typical single trade in band i */
  typical(i: number) {
    const hi = i === 0 ? this.edges[0] * 3 : this.edges[i - 1];
    return Math.sqrt(hi * Math.max(this.edges[i], hi / 10));
  }
}

/** Tron-lit Winamp analyzer: trade size is frequency, whales are the bass */
export class Spectrum implements Preset {
  readonly id = 'spectrum';
  readonly title = 'SPECTRUM';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  readonly bloom: [number, number, number] = [0.8, 0.4, 0.35];
  readonly feed = 'whales';
  readonly legend = `
    Each bar = an equal share of recent DEX volume<br>
    ◂ whales (bass) · shrimp (treble) ▸<br>
    Axis = live $ size where each band starts<br>
    Caps = recent peaks<br>
    Scope = block fill per slot<i style="background:#ff7a18"></i>`;

  private energy = new Float32Array(BINS);
  private bands = new Bands();
  private norm = new Float32Array(BINS).fill(1);
  private axisTags: [number, TextSprite][] = [];
  private recomputeAt = 0;
  private level = new Float32Array(BINS);
  private peak = new Float32Array(BINS);
  private peakHold = new Float32Array(BINS);
  private peakVel = new Float32Array(BINS);
  private flash = 0;
  private boxes = new NeonBoxes(BINS * SEG * 2 + BINS * 2, { edge: 0.02, fill: 0.12, fog: 0.004 });
  private scope: THREE.Line;
  private scopePos = new Float32Array(SCOPE_N * 3);
  private fills: number[] = [];
  private gridMat: THREE.ShaderMaterial;
  private whaleTag = new TextSprite(0.7, 64, { glow: 0.2 });
  private whaleAt = -1e9;
  private whaleX = 0;
  private col = new THREE.Color();
  private look = new THREE.Vector3(0, 3.3, 0);

  constructor() {
    this.scene.background = new THREE.Color('#000306');
    this.scene.add(this.boxes.mesh);

    // Glossy floor over the mirrored bars, with a Tron grid
    this.gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { beat: { value: 0 } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float beat; varying vec3 vW;
        float line(float v){ float d = abs(fract(v - 0.5) - 0.5) / fwidth(v); return 1.0 - min(d, 1.0); }
        void main(){
          float g = max(line(vW.x / ${(BAR_W + GAP).toFixed(2)} + 0.5), line(vW.z / 1.2));
          float fade = exp(-length(vW.xz) * 0.05);
          vec3 c = vec3(0.09, 0.9, 1.0) * g * (0.18 + beat * 0.35) * fade;
          gl_FragColor = vec4(c, 0.86 - g * 0.3);
        }`,
    });
    this.gridMat.extensions.derivatives = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), this.gridMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Oscilloscope
    const sg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(this.scopePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.scope = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: ORANGE.clone().multiplyScalar(1.6) }));
    this.scope.frustumCulled = false;
    this.scene.add(this.scope);
    const frame: number[] = [];
    const w = (BINS * (BAR_W + GAP)) / 2, y0 = SEG * (SEG_H + SEG_GAP) + 0.9;
    frame.push(-w, y0, 0, w, y0, 0, -w, y0 + 2.6, 0, w, y0 + 2.6, 0);
    this.scene.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(frame, 3)),
      new THREE.LineBasicMaterial({ color: '#0b3a46' }),
    ));

    // Axis
    // Axis: live dollar thresholds under every fourth band
    for (let i = 0; i < BINS; i += 4) {
      const s = new TextSprite(0.32, 64, { glow: 0 });
      s.sprite.position.set(bandX(i), -0.75, 0.6);
      this.scene.add(s.sprite);
      this.axisTags.push([i, s]);
    }
    this.labelAxis();
    const ends: [number, string][] = [[-1, '◂ WHALES'], [1, 'SHRIMP ▸']];
    for (const [side, text] of ends) {
      const s = new TextSprite(0.34, 64, { glow: 0 });
      s.set([{ text, color: '#ff9a4a' }]);
      s.sprite.position.set(side * (w - 1.2), -1.35, 0.6);
      this.scene.add(s.sprite);
    }
    const scopeLabel = new TextSprite(0.3, 64, { glow: 0 });
    scopeLabel.set([{ text: 'BLOCK FILL / SLOT', color: '#ff9a4a' }]);
    scopeLabel.sprite.position.set(-w + 1.6, y0 + 2.7, 0);
    this.scene.add(scopeLabel.sprite);

    this.whaleTag.opacity = 0;
    this.scene.add(this.whaleTag.sprite);
  }

  reset() {
    this.bands = new Bands();
    this.energy.fill(0);
    this.norm.fill(1);
    this.labelAxis();
  }

  private labelAxis() {
    for (const [i, s] of this.axisTags) s.set([{ text: fmtUsd(this.bands.edges[i]) + '+', color: '#4fd8ee' }]);
  }

  enter(_slot: number, b: Block | undefined) {
    if (b) this.bands.observe(b.trades.map((t) => t.usd));
    const now = performance.now();
    if (now - this.recomputeAt > 4000) {
      this.recomputeAt = now;
      this.bands.recompute();
      this.labelAxis();
    }
    this.fills.push(b ? b.cu / LIMITS.cu : 0);
    if (this.fills.length > SCOPE_N) this.fills.shift();
    this.gridMat.uniforms.beat.value = b ? Math.min(1, (b.cu / LIMITS.cu) * 2) : 0;
  }

  trade({ trade: t, whale, epic }: TradeEvent) {
    const i = this.bands.of(t.usd);
    this.energy[i] += t.usd;
    if (epic) this.flash = 1;
    if (whale) {
      this.whaleTag.set([
        { text: t.token, color: '#ffffff', font: DISPLAY, scale: 1 },
        { text: `${fmtUsd(t.usd)} · ${t.program}`, color: '#ff9a4a', scale: 0.6 },
      ]);
      this.whaleAt = performance.now();
      this.whaleX = bandX(i);
    }
  }

  update(f: Frame) {
    const dt = f.pdt;
    const bx = this.boxes;
    bx.begin();
    this.flash = Math.max(0, this.flash - f.dt * 1.2);
    for (let i = 0; i < BINS; i++) {
      // Fast attack, quick release; per-band AGC so every band can dance
      // Bass sustains like a real low note; treble is snappy
      const bass = 1 - i / (BINS - 1);
      this.energy[i] *= Math.exp(-dt * (6 - bass * 4.8));
      this.norm[i] = Math.max(this.norm[i] * Math.exp(-dt * 0.04), this.energy[i], this.bands.typical(i) * 2.5);
      const target = Math.sqrt(this.energy[i] / this.norm[i]);
      this.level[i] += (target - this.level[i]) * Math.min(1, dt * (target > this.level[i] ? 30 : 10));
      // Winamp peak caps: hold, then fall under gravity
      if (this.level[i] >= this.peak[i]) {
        this.peak[i] = this.level[i];
        this.peakHold[i] = 0.4 + bass * 0.9;
        this.peakVel[i] = 0;
      } else if ((this.peakHold[i] -= dt) < 0) {
        this.peakVel[i] += dt * 1.6;
        this.peak[i] = Math.max(this.level[i], this.peak[i] - this.peakVel[i] * dt);
      }

      const x = bandX(i);
      const lit = Math.round(this.level[i] * SEG);
      for (let s = 0; s < SEG; s++) {
        const y = s * (SEG_H + SEG_GAP) + SEG_H / 2 + 0.05;
        const k = s / (SEG - 1);
        if (s < lit) {
          if (k < 0.6) this.col.copy(CYAN).lerp(WHITE, k / 0.6 * 0.5);
          else this.col.copy(WHITE).lerp(ORANGE, (k - 0.6) / 0.4);
          this.col.lerp(WHITE, this.flash * 0.8);
          bx.put(x, y, 0, BAR_W, SEG_H, BAR_W, this.col, 0.9 + this.flash);
          if (s < 8) bx.put(x, -y, 0, BAR_W, SEG_H, BAR_W, this.col, 0.1);   // reflection
        } else {
          bx.put(x, y, 0, BAR_W, SEG_H, BAR_W, GHOST, 0);
        }
      }
      const py = Math.min(SEG - 1, this.peak[i] * SEG) * (SEG_H + SEG_GAP) + SEG_H + 0.12;
      bx.put(x, py, 0, BAR_W, 0.06, BAR_W, ORANGE, 1.6);
    }
    bx.commit();

    // Scope scrolls on the chain's clock: newest slot enters at the right
    const w = (BINS * (BAR_W + GAP)) / 2, y0 = SEG * (SEG_H + SEG_GAP) + 0.9;
    const n = this.fills.length;
    const step = (2 * w) / (SCOPE_N - 1);
    for (let k = 0; k < SCOPE_N; k++) {
      const v = this.fills[n - SCOPE_N + k] ?? 0;
      const x = -w + (k - f.frac) * step;
      this.scopePos.set([Math.max(-w, x), y0 + 0.1 + Math.min(1, v) * 2.4, 0], k * 3);
    }
    (this.scope.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    const age = (performance.now() - this.whaleAt) / 3500;
    this.whaleTag.opacity = age < 1 ? Math.min(1, age * 10) * (1 - age * age) : 0;
    this.whaleTag.sprite.position.set(this.whaleX, SEG * (SEG_H + SEG_GAP) * 0.55 + age * 1.2, 1.2);

    const { t, pointer, portrait } = f;
    const d = portrait ? 34 : 19;
    this.camera.position.set(Math.sin(t * 0.08) * 5 + pointer.x * 3, 4.2 - pointer.y * 1.5, d);
    this.camera.lookAt(this.look);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  kpis(s: Stats): Kpi[] {
    return [
      { label: 'Trades / sec', value: s.tradesPerSec, fmt: (v) => v.toFixed(0), color: '#18e8ff' },
      { label: 'DEX vol / min', value: s.volPerMin, fmt: fmtUsd, color: '#e8fbff' },
      { label: 'Avg trade', value: s.avgTrade, fmt: fmtUsd, color: '#ff7a18' },
      { label: 'User TPS', value: s.tps, fmt: fmtInt, color: '#18e8ff' },
    ];
  }
}
