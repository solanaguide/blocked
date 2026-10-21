import * as THREE from 'three';
import { C, PITCH, HISTORY, LANE_COLORS, FOG_GLSL, fogUniforms } from '../palette';

export const LANES = 8;
const SUB = 6;                       // vertices per lane across
const COLS = LANES * SUB + 1;
const ROWS = HISTORY;
const LANE_W = 1.2;
const INNER = 2.2;                   // gap between road and first lane
const PEAK = 5.2;                    // world height for REF_USD in one slot

/**
 * Keeps the top-N keys (DEXes or tokens) in stable lanes. Lanes only change
 * hands periodically, so the mountains don't reshuffle every block.
 */
export class LaneMap {
  readonly keys: (string | null)[];
  private ema = new Map<string, number>();
  private sinceReassign = 0;
  onChange: (lane: number, key: string | null) => void = () => {};

  constructor(private n = LANES, private every = 25) {
    this.keys = new Array(n).fill(null);
  }

  observe(volumes: Map<string, number>) {
    for (const [k, v] of this.ema) this.ema.set(k, v * 0.993);
    for (const [k, v] of volumes) this.ema.set(k, (this.ema.get(k) ?? 0) + v);
    if (++this.sinceReassign > this.every || this.keys.every((k) => k === null)) this.reassign();
  }

  /** Forget all history and free every lane (e.g. when the trade filter changes) */
  reset() {
    this.ema.clear();
    for (let i = 0; i < this.n; i++) if (this.keys[i]) { this.keys[i] = null; this.onChange(i, null); }
    this.sinceReassign = this.every;
  }

  lane(key: string) {
    return this.keys.indexOf(key);
  }

  private reassign() {
    this.sinceReassign = 0;
    const top = [...this.ema.entries()].filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]).slice(0, this.n).map(([k]) => k);
    const keep = new Set(top);
    for (let i = 0; i < this.n; i++) {
      const k = this.keys[i];
      if (k && !keep.has(k)) { this.keys[i] = null; this.onChange(i, null); }
    }
    for (const k of top) {
      if (this.keys.includes(k)) continue;
      const free = this.keys.indexOf(null);
      if (free < 0) break;
      this.keys[free] = k;
      this.onChange(free, k);
    }
    if (this.ema.size > 400) {
      const cut = [...this.ema.entries()].sort((a, b) => b[1] - a[1])[300][1];
      for (const [k, v] of this.ema) if (v <= cut) this.ema.delete(k);
    }
  }
}

/**
 * A waterfall spectrogram: x = lane, z = time (slots), y = volume.
 * Rendered as a dark occluding surface with glowing cross-section lines.
 */
export class Terrain {
  readonly group = new THREE.Group();
  readonly lanes = new LaneMap();
  private rows: { slot: number; v: Float32Array }[] = [];
  private surf: THREE.Mesh;
  private lines: THREE.LineSegments;
  private pos: Float32Array;
  private lpos: Float32Array;
  private lcol: Float32Array;
  private heights = new Float32Array(COLS);
  private hp = new Float32Array(ROWS * COLS);
  private ref = 20_000;   // rolling peak lane volume per slot

  constructor(private side: -1 | 1) {
    // Surface
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(COLS * ROWS * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        const a = r * COLS + c, b = a + 1, d = a + COLS, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    geo.setIndex(idx);
    this.surf = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: fogUniforms(),
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        vertexShader: `varying float vH; varying float vDepth; void main(){ vH = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `${FOG_GLSL} varying float vH; varying float vDepth;
          void main(){ vec3 c = mix(vec3(0.012,0.0,0.03), vec3(0.06,0.0,0.09), clamp(vH/4.0,0.0,1.0)); gl_FragColor = vec4(applyFog(c, vDepth), 1.0); }`,
      }),
    );
    this.surf.frustumCulled = false;
    this.group.add(this.surf);

    // Cross-section lines (one polyline per slot row) plus lane ridges
    const segs = ROWS * (COLS - 1) + LANES * (ROWS - 1);
    this.lpos = new Float32Array(segs * 6);
    this.lcol = new Float32Array(segs * 6);
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(this.lpos, 3).setUsage(THREE.DynamicDrawUsage));
    lgeo.setAttribute('color', new THREE.BufferAttribute(this.lcol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      lgeo,
      new THREE.ShaderMaterial({
        uniforms: fogUniforms(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexShader: `attribute vec3 color; varying vec3 vC; varying float vDepth; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `${FOG_GLSL} varying vec3 vC; varying float vDepth;
          void main(){ float f = exp(-fogDensity*fogDensity*vDepth*vDepth); gl_FragColor = vec4(vC * f, 1.0); }`,
      }),
    );
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
  }

  reset() {
    this.lanes.reset();
    this.rows = [];
    this.ref = 200;
  }

  /** Lane centre in world x */
  laneX(lane: number) {
    return this.side * (INNER + (lane + 0.5) * LANE_W);
  }

  laneHeight(usd: number) {
    return (Math.log10(1 + usd) / Math.log10(1 + this.ref)) * PEAK;
  }

  /** A new slot begins: commit the head row, open a fresh one */
  enter(slot: number, totals: Map<string, number>) {
    this.lanes.observe(totals);
    const v = new Float32Array(LANES);
    for (const [k, usd] of totals) {
      const l = this.lanes.lane(k);
      if (l >= 0) v[l] += usd;
    }
    this.ref = Math.max(200, this.ref * 0.998, ...v);
    this.rows.unshift({ slot, v });
    if (this.rows.length > ROWS) this.rows.pop();
  }

  /** Current visible peak of a lane at the head, for trade launch points */
  headPeak(lane: number) {
    const r = this.rows[1]?.v;
    return r ? this.laneHeight(r[lane]) : 0;
  }

  update(playhead: number, grow: number) {
    const heights = this.heights;
    let li = 0;
    const col = new THREE.Color();
    const hp = this.hp;
    for (let r = 0; r < ROWS; r++) {
      const row = this.rows[r];
      const z = row ? (row.slot + 0.5 - playhead) * PITCH : (Math.floor(playhead) - r + 0.5 - playhead) * PITCH;
      // Smooth lane values across x with a cosine kernel
      for (let c = 0; c < COLS; c++) {
        const u = c / SUB - 0.5;               // lane-space coordinate
        const l0 = Math.floor(u), l1 = l0 + 1;
        const t = u - l0;
        const s = (1 - Math.cos(Math.PI * t)) / 2;
        const v0 = row && l0 >= 0 && l0 < LANES ? this.laneHeight(row.v[l0]) : 0;
        const v1 = row && l1 >= 0 && l1 < LANES ? this.laneHeight(row.v[l1]) : 0;
        heights[c] = (v0 * (1 - s) + v1 * s) * (r === 0 ? grow : 1);
      }
      for (let c = 0; c < COLS; c++) {
        const x = this.side * (INNER + (c / (COLS - 1)) * LANES * LANE_W);
        const o = (r * COLS + c) * 3;
        this.pos[o] = x; this.pos[o + 1] = heights[c]; this.pos[o + 2] = z;
        hp[r * COLS + c] = heights[c];
      }
      // Row polyline, coloured by height through the lane hue
      for (let c = 0; c < COLS - 1; c++) {
        const lane = Math.min(LANES - 1, Math.max(0, Math.round(c / SUB - 0.5)));
        const h = (heights[c] + heights[c + 1]) / 2;
        const k = Math.min(1, h / PEAK);
        col.copy(C.violet).lerp(LANE_COLORS[lane], Math.min(1, k * 1.6)).multiplyScalar(0.1 + k * 1.1 + (r === 0 ? 0.5 : 0));
        const o = r * COLS * 3 + c * 3;
        li = seg(this.lpos, this.lcol, li, this.pos[o], this.pos[o + 1] + 0.01, this.pos[o + 2], this.pos[o + 3], this.pos[o + 4] + 0.01, this.pos[o + 5], col);
      }
    }
    // Lane ridgelines running back in time
    for (let l = 0; l < LANES; l++) {
      const c = l * SUB + SUB / 2;
      for (let r = 0; r < ROWS - 1; r++) {
        const a = (r * COLS + c) * 3, b = ((r + 1) * COLS + c) * 3;
        const k = Math.min(1, hp[r * COLS + c] / PEAK);
        col.copy(LANE_COLORS[l]).multiplyScalar(0.05 + k * 0.7);
        li = seg(this.lpos, this.lcol, li, this.pos[a], this.pos[a + 1] + 0.01, this.pos[a + 2], this.pos[b], this.pos[b + 1] + 0.01, this.pos[b + 2], col);
      }
    }
    (this.surf.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.surf.geometry.computeBoundingSphere();
    const lg = this.lines.geometry;
    (lg.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (lg.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

function seg(p: Float32Array, c: Float32Array, i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, col: THREE.Color) {
  const o = i * 6;
  p[o] = ax; p[o + 1] = ay; p[o + 2] = az; p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
  c[o] = c[o + 3] = col.r; c[o + 1] = c[o + 4] = col.g; c[o + 2] = c[o + 5] = col.b;
  return i + 1;
}
