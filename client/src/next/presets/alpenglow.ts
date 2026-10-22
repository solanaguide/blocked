import * as THREE from 'three';
import type { Block } from '../feed';
import type { Stats } from '../stats';
import type { Preset, Frame, Kpi } from './types';
import { LIMITS, FOG_GLSL, fmtInt } from '../palette';
import { Callouts } from '../callouts';
import { life, clusterTime, finalityMs, streamMs } from '../lifecycle';

const P = 1.7;              // world units between neighbouring slots
const HIST = 90;            // slots kept in the range
const AGE_SPAN = 70;        // distance over which finalized peaks settle into dusk
const SHREDS = 900;
const FLARES = 10;
const FOG = new THREE.Color('#2a3152');

interface Peak { fill: number; txns: number; skipped: boolean; entered: number }

/** Deterministic 0..1 hash so a slot always gets the same mountain */
function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** One jagged peak, unit radius and height; instances vary it by seed */
function mountainGeometry() {
  const N = 9, R = 6;
  const rnd = (i: number, k: number) => hash(i * 31 + k * 7 + 3);
  const ring: THREE.Vector3[][] = [];
  for (let k = 0; k < R; k++) {
    const y = k / R;
    const row: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (rnd(i, k) - 0.5) * 0.35;
      const r = Math.pow(1 - y, 0.85) * (0.72 + 0.5 * rnd(i + 50, k));
      row.push(new THREE.Vector3(Math.cos(a) * r, k ? y + (rnd(i + 90, k) - 0.5) * 0.09 : -0.04, Math.sin(a) * r));
    }
    ring.push(row);
  }
  const apex = new THREE.Vector3(0.08, 1, 0.05);
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let k = 0; k < R - 1; k++) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      tri(ring[k][i], ring[k + 1][i], ring[k][j]);
      tri(ring[k][j], ring[k + 1][i], ring[k + 1][j]);
    }
  }
  for (let i = 0; i < N; i++) tri(ring[R - 1][i], apex, ring[R - 1][(i + 1) % N]);
  return new THREE.Float32BufferAttribute(pos, 3);
}

const PEAK_VERT = /* glsl */ `
  attribute vec4 aA;      // x, z, radius, height
  attribute vec4 aB;      // rise, glow, flare, kind (0 timed, 1 untimed, 2 skipped)
  attribute float aSeed;
  varying vec3 vW;
  varying float vY;
  varying vec4 vB;
  varying float vX;
  varying float vDepth;
  void main() {
    float a = aSeed * 6.2831;
    float cs = cos(a), sn = sin(a);
    vec3 p = position;
    vec2 xz = vec2(p.x * cs - p.z * sn, p.x * sn + p.z * cs) * aA.z * vec2(1.0, 0.7 + 0.5 * fract(aSeed * 7.13));
    float e = 1.0 - pow(1.0 - aB.x, 3.0);
    // New peaks push up out of the ground as their shreds arrive
    vec4 w = modelMatrix * vec4(aA.x + xz.x, (p.y - (1.0 - e)) * aA.w, aA.y + xz.y, 1.0);
    vW = w.xyz; vY = p.y; vB = aB; vX = aA.x;
    vec4 mv = viewMatrix * w;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const PEAK_FRAG = /* glsl */ `
  uniform vec3 uLight;
  uniform float uAgeSpan;
  varying vec3 vW;
  varying float vY;
  varying vec4 vB;
  varying float vX;
  varying float vDepth;
  ${FOG_GLSL}
  void main() {
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
    if (dot(n, cameraPosition - vW) < 0.0) n = -n;
    float diff = max(dot(n, uLight), 0.0);
    float grain = fract(sin(dot(floor(vW.xz * 3.0), vec2(12.9898, 78.233))) * 43758.5453);
    float snow = smoothstep(0.6, 0.8, vY + (grain - 0.5) * 0.08);

    // Blue hour: the range before the light reaches it
    vec3 shade = mix(vec3(0.07, 0.09, 0.16), vec3(0.17, 0.21, 0.33), diff * 0.7 + vY * 0.25);
    shade = mix(shade, vec3(0.32, 0.38, 0.55) * (0.6 + 0.6 * diff), snow * 0.7);

    // Alpenglow: rose on rock, peach on snow
    vec3 lit = mix(vec3(0.5, 0.16, 0.3), vec3(0.85, 0.42, 0.38), vY) * (0.2 + 0.7 * diff);
    lit = mix(lit, vec3(0.95, 0.66, 0.62) * (0.3 + 0.6 * diff), snow * 0.75);
    float age = clamp(-vX / uAgeSpan, 0.0, 1.0);
    lit = mix(lit, lit * 0.42 + vec3(0.05, 0.03, 0.08), age);

    // Light arrives at the summit first and pours down the slopes
    float glow = vB.y;
    float front = 1.0 - glow;
    float on = step(0.001, glow);
    vec3 col = mix(shade, lit, smoothstep(front - 0.015, front + 0.015, vY) * on);
    float edge = (1.0 - smoothstep(0.0, 0.035, abs(vY - front))) * on * step(glow, 0.995);
    col += vec3(1.0, 0.72, 0.8) * edge * 0.9;

    // Finality: the summit flashes gold
    col += vec3(1.0, 0.72, 0.35) * vB.z * (0.15 + 1.2 * smoothstep(0.65, 1.0, vY));
    // Still receiving shreds: a cold rim
    col += vec3(0.35, 0.55, 1.0) * (1.0 - vB.x) * 0.3 * (1.0 - diff);

    if (vB.w > 1.5) col = shade * 0.55 + vec3(0.01, 0.03, 0.08);
    else if (vB.w > 0.5) col = mix(shade, vec3(0.3, 0.24, 0.36) * (0.4 + 0.7 * diff), 0.5);

    gl_FragColor = vec4(applyFog(col, vDepth), 1.0);
  }
`;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec3 vDir;
  float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5); }
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    float az = 0.78 + 0.22 * cos(atan(d.x, -d.z));
    // Earth's shadow, the Belt of Venus, then blue hour into night
    vec3 c = vec3(0.10, 0.12, 0.22);
    c = mix(c, vec3(0.20, 0.24, 0.40), smoothstep(-0.05, 0.0, y));
    c = mix(c, vec3(0.72, 0.42, 0.56) * az, smoothstep(0.02, 0.07, y));
    c = mix(c, vec3(0.30, 0.27, 0.50), smoothstep(0.08, 0.16, y));
    c = mix(c, vec3(0.06, 0.07, 0.19), smoothstep(0.16, 0.36, y));
    c = mix(c, vec3(0.015, 0.02, 0.06), smoothstep(0.36, 0.8, y));
    vec2 g = floor(d.xz / (y + 0.35) * 260.0);
    float star = step(0.9972, h(g)) * smoothstep(0.15, 0.4, y);
    c += star * (0.55 + 0.45 * sin(uTime * 2.0 + h(g + 7.0) * 40.0)) * 0.8;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const RANGE_FRAG = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uTop;
  varying float vH;
  varying float vDepth;
  ${FOG_GLSL}
  void main() {
    gl_FragColor = vec4(applyFog(mix(uBase, uTop, smoothstep(0.55, 1.0, vH)), vDepth), 1.0);
  }
`;

const RANGE_VERT = /* glsl */ `
  attribute float aH;
  varying float vH;
  varying float vDepth;
  void main() {
    vH = aH;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

/** A distant, static ridgeline for depth */
function backRange(z: number, base: number, amp: number, seed: number, top: THREE.Color, fog: number) {
  const pos: number[] = [], hs: number[] = [];
  const M = 160;
  let prev: [number, number] | null = null;
  for (let i = 0; i <= M; i++) {
    const x = -300 + (600 * i) / M;
    const y = base + amp * (0.5 * Math.sin(x * 0.031 + seed) + 0.3 * Math.sin(x * 0.083 + seed * 2.1) + 0.2 * Math.abs(Math.sin(x * 0.19 + seed * 3.7)));
    if (prev) {
      const [px, py] = prev;
      pos.push(px, 0, z, x, 0, z, px, py, z, x, 0, z, x, y, z, px, py, z);
      const top0 = py / (base + amp), top1 = y / (base + amp);
      hs.push(0, 0, top0, 0, top1, top0);
    }
    prev = [x, y];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hs, 1));
  return new THREE.Mesh(g, new THREE.ShaderMaterial({
    vertexShader: RANGE_VERT,
    fragmentShader: RANGE_FRAG,
    uniforms: { uBase: { value: new THREE.Color('#0c1020') }, uTop: { value: top }, fogColor: { value: FOG }, fogDensity: { value: fog } },
  }));
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,220,150,0.55)');
  r.addColorStop(1, 'rgba(255,180,120,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Alpenglow: every slot is a peak in a range at dawn. It rises while its
 * shreds arrive, catches light at the summit once the block is complete, the
 * light pours down while the cluster votes, and the summit flares gold the
 * moment the slot is finalized. Timings are the cluster's own, replayed.
 */
export class Alpenglow implements Preset {
  readonly id = 'alpenglow';
  readonly title = 'ALPENGLOW';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1200);
  readonly bloom: [number, number, number] = [0.5, 0.6, 0.62];
  readonly feed = 'windows';
  readonly legend = `
    Peak = one slot · height = block fill<br>
    rising = shreds arriving<i style="background:#6f8fff"></i><br>
    light pours down = cluster voting<i style="background:#ff8fa8"></i><br>
    gold summit = finalized<i style="background:#ffd27a"></i><br>
    dark = skipped<i style="background:#1a2238"></i><br>
    before Alpenglow, finality took ~12.8s`;

  private peaks = new Map<number, Peak>();
  private mesh: THREE.Mesh;
  private aA: THREE.InstancedBufferAttribute;
  private aB: THREE.InstancedBufferAttribute;
  private aSeed: THREE.InstancedBufferAttribute;
  private sky: THREE.Mesh;
  private shreds: THREE.Points;
  private sh = { slot: new Float64Array(SHREDS), dx: new Float32Array(SHREDS), y: new Float32Array(SHREDS), z: new Float32Array(SHREDS), v: new Float32Array(SHREDS), floor: new Float32Array(SHREDS), life: new Float32Array(SHREDS) };
  private shNext = 0;
  private flares: { sprite: THREE.Sprite; slot: number; y: number; z: number; age: number }[] = [];
  private flared = new Set<number>();
  private callouts = new Callouts();
  private calloutAt = 0;
  private clock = 0;
  private playhead = 0;
  private w = 1;
  private h = 1;
  private look = new THREE.Vector3();
  private anchor = new THREE.Vector3();

  constructor() {
    this.scene.background = FOG.clone();
    this.scene.fog = new THREE.FogExp2(FOG, 0.012);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { uTime: { value: 0 } }, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.scene.add(this.sky);

    this.scene.add(backRange(-220, 14, 22, 1.3, new THREE.Color('#b0607e'), 0.004));
    this.scene.add(backRange(-120, 4, 9, 4.1, new THREE.Color('#5a3a62'), 0.007));

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshBasicMaterial({ color: '#0e1324' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', mountainGeometry());
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(HIST * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(HIST * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.InstancedBufferAttribute(new Float32Array(HIST), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aA', this.aA);
    g.setAttribute('aB', this.aB);
    g.setAttribute('aSeed', this.aSeed);
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: PEAK_VERT,
      fragmentShader: PEAK_FRAG,
      uniforms: {
        uLight: { value: new THREE.Vector3(0.35, 0.32, 1).normalize() },
        uAgeSpan: { value: AGE_SPAN },
        fogColor: { value: FOG },
        fogDensity: { value: 0.012 },
      },
    }));
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SHREDS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(SHREDS), 1).setUsage(THREE.DynamicDrawUsage));
    this.shreds = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aLife;
        varying float vLife;
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aLife > 0.0 ? 2.2 * (30.0 / -mv.z) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vLife;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vec3(0.6, 0.78, 1.0) * smoothstep(0.5, 0.0, d) * vLife, 1.0);
        }`,
    }));
    this.shreds.frustumCulled = false;
    this.scene.add(this.shreds);

    const tex = glowTexture();
    for (let i = 0; i < FLARES; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#ffd27a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      this.scene.add(sprite);
      this.flares.push({ sprite, slot: 0, y: 0, z: 0, age: 1 });
    }
  }

  activate() {
    this.callouts.visible = true;
    const f = finalityMs();
    if (f) setTimeout(() => hero(`FINAL IN ${(f / 1000).toFixed(2)}s`), 900);
  }

  deactivate() {
    this.callouts.visible = false;
    this.callouts.clear();
  }

  enter(slot: number, block: Block | undefined) {
    this.peaks.set(slot, {
      fill: block ? Math.min(1, block.cu / LIMITS.cu) : 0,
      txns: block?.txns ?? 0,
      skipped: !block,
      entered: performance.now(),
    });
    for (const s of this.peaks.keys()) {
      if (s < slot - HIST) { this.peaks.delete(s); this.flared.delete(s); } else break;
    }
  }

  trade() { /* this view is about consensus, not markets */ }

  private x(slot: number) {
    return (slot - this.playhead) * P;
  }

  private z(slot: number) {
    return (hash(slot * 0.37) - 0.5) * 3.4;
  }

  private height(p: Peak) {
    return p.skipped ? 1.1 : 1.6 + 6.5 * Math.sqrt(p.fill);
  }

  update(f: Frame) {
    this.playhead = f.playhead;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = f.t;
    const T = clusterTime(f.playhead);
    // Cluster clock: follows the replayed first-shred times; free-runs when they're missing
    this.clock = T !== undefined && Math.abs(T - this.clock) < 3000 ? Math.max(this.clock, T) : T ?? this.clock + f.dt * 1000;

    const A = this.aA.array as Float32Array, B = this.aB.array as Float32Array, S = this.aSeed.array as Float32Array;
    const now = performance.now();
    let n = 0;
    for (const [s, p] of this.peaks) {
      if (s > f.playhead || n >= HIST) continue;
      const L = life(s);
      let rise = 1, glow = 0, flare = 0, kind = 0;
      if (p.skipped || L?.dead) {
        kind = 2;
        rise = Math.min(1, (now - p.entered) / 600);
      } else if (L && T !== undefined) {
        const el = this.clock - L.t;
        rise = clamp01(el / (L.c ?? 350));
        if (L.c !== undefined && el > L.c) {
          const end = L.r ?? L.o ?? L.c + 400;
          if (L.o !== undefined && L.r !== undefined && L.o > L.c && L.r > L.o) {
            glow = el < L.o ? 0.85 * (el - L.c) / (L.o - L.c) : 0.85 + 0.15 * clamp01((el - L.o) / (L.r - L.o));
          } else {
            glow = clamp01((el - L.c) / Math.max(1, end - L.c));
          }
        }
        if (L.r !== undefined && el >= L.r) {
          glow = 1;
          flare = Math.exp(-(el - L.r) / 380);
          if (!this.flared.has(s)) { this.flared.add(s); this.finalized(s, p, L); }
        }
      } else {
        // No timing for this slot: show it, but don't animate stages we can't vouch for
        kind = 1;
        rise = Math.min(1, (now - p.entered) / 350);
      }
      if (kind === 0 && rise < 1) this.emitShreds(s, p, f.dt);
      A.set([this.x(s), this.z(s), 1.15 + 0.7 * hash(s * 1.91), this.height(p)], n * 4);
      B.set([rise, glow, flare, kind], n * 4);
      S[n] = hash(s * 3.3);
      n++;
    }
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
    this.aA.needsUpdate = this.aB.needsUpdate = this.aSeed.needsUpdate = true;

    this.updateShreds(f.dt);
    for (const fl of this.flares) {
      if (fl.age >= 1) { fl.sprite.material.opacity = 0; continue; }
      fl.age = Math.min(1, fl.age + f.dt / 1.4);
      const k = 1 - fl.age;
      fl.sprite.position.set(this.x(fl.slot), fl.y + 0.2, fl.z);
      fl.sprite.scale.setScalar(1.2 + 5 * Math.sqrt(fl.age));
      fl.sprite.material.opacity = k * k;
    }

    const { t, pointer, portrait } = f;
    // Portrait looks down the length of the range so more of the pipeline fits
    if (portrait) {
      this.camera.position.set(13 + Math.sin(t * 0.05) * 0.5, 6.5, 11);
      this.look.set(-10, 2.2, -2.5);
    } else {
      this.camera.position.set(9 + Math.sin(t * 0.05) * 0.8 + pointer.x * 2, 5.2 - pointer.y * 1.2, 15);
      this.look.set(-8, 3, -2);
    }
    this.camera.lookAt(this.look);
    // Phones have no room beside the range for labels
    this.callouts.visible = !portrait;
    this.callouts.update(this.camera, this.w, this.h);
  }

  private finalized(s: number, p: Peak, L: { c?: number; o?: number; r?: number }) {
    const fl = this.flares.find((x) => x.age >= 1);
    if (fl) Object.assign(fl, { slot: s, y: this.height(p), z: this.z(s), age: 0 });
    const now = performance.now();
    if (now - this.calloutAt < 2600 || L.r === undefined) return;
    this.calloutAt = now;
    const stages = [L.c !== undefined && `block ${L.c}ms`, L.o !== undefined && `confirmed ${L.o}ms`].filter(Boolean).join(' · ');
    const h = this.height(p);
    this.callouts.add(() => {
      const x = this.x(s);
      return x < -24 ? null : this.anchor.set(x, h, this.z(s));
    }, `<b>SLOT ${fmtInt(s)}</b><span>FINAL IN ${L.r}ms</span><i>${stages}</i>`, { life: 4200, dx: 60, dy: -70, cls: 'alp' });
  }

  private emitShreds(s: number, p: Peak, dt: number) {
    const rate = 70 + Math.min(260, p.txns / 6);
    const h = this.height(p);
    for (let k = Math.floor(rate * dt + Math.random()); k > 0; k--) {
      const i = this.shNext;
      this.shNext = (i + 1) % SHREDS;
      const r = Math.random() * 0.9;
      const a = Math.random() * Math.PI * 2;
      this.sh.slot[i] = s;
      this.sh.dx[i] = Math.cos(a) * r;
      this.sh.z[i] = this.z(s) + Math.sin(a) * r;
      this.sh.y[i] = h + 3 + Math.random() * 6;
      this.sh.v[i] = 14 + Math.random() * 8;
      this.sh.floor[i] = h * (1 - r * 0.8);
      this.sh.life[i] = 1;
    }
  }

  private updateShreds(dt: number) {
    const pos = this.shreds.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lifeAttr = this.shreds.geometry.getAttribute('aLife') as THREE.BufferAttribute;
    const P3 = pos.array as Float32Array, LA = lifeAttr.array as Float32Array;
    const { slot, dx, y, z, v, floor, life: lv } = this.sh;
    for (let i = 0; i < SHREDS; i++) {
      if (lv[i] <= 0) { LA[i] = 0; continue; }
      y[i] -= v[i] * dt;
      if (y[i] <= floor[i]) { lv[i] = 0; LA[i] = 0; continue; }
      P3[i * 3] = this.x(slot[i]) + dx[i];
      P3[i * 3 + 1] = y[i];
      P3[i * 3 + 2] = z[i];
      LA[i] = Math.min(1, (y[i] - floor[i]) / 1.5) * 0.9;
    }
    pos.needsUpdate = lifeAttr.needsUpdate = true;
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 62 : 40;
    this.camera.updateProjectionMatrix();
  }

  kpis(s: Stats): Kpi[] {
    const ms = (v: number) => (v ? v.toFixed(0) + 'ms' : '—');
    return [
      { label: 'Time to finality', value: finalityMs(), fmt: (v) => (v ? (v / 1000).toFixed(2) + 's' : '—'), color: '#ff9ab0' },
      { label: 'Block streaming', value: streamMs(), fmt: ms, color: '#9fb4ff' },
      { label: 'Slot time', value: s.slotTimeMs, fmt: ms, color: '#ffd2c2' },
      { label: 'Block fill', value: s.fill * 100, fmt: (v) => v.toFixed(0) + '%', color: '#fff' },
    ];
  }
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Kinetic hero line, shared element with City */
function hero(text: string) {
  const el = document.getElementById('hero');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('slam');
  void el.offsetWidth;
  el.classList.add('slam');
}
