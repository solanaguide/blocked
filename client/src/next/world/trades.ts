import * as THREE from 'three';
import { PITCH } from '../palette';

const MAX = 1200;
const TRAIL = 7;
const FLIGHT = 0.55;   // seconds of playback time

interface Meteor {
  alive: boolean;
  t: number;
  sx: number; sy: number; sSlot: number;   // launch, z expressed as fractional slot
  ex: number; ey: number; eSlot: number;   // landing
  size: number;
  color: THREE.Color;
  trail: Float32Array;                     // world xyz history
  onLand?: () => void;
}

/** Glowing heads with fading streaks, all in two draw calls. */
export class Trades {
  readonly group = new THREE.Group();
  private pool: Meteor[] = [];
  private heads: THREE.Points;
  private hPos = new Float32Array(MAX * 3);
  private hCol = new Float32Array(MAX * 3);
  private hSize = new Float32Array(MAX);
  private streaks: THREE.LineSegments;
  private sPos = new Float32Array(MAX * (TRAIL - 1) * 6);
  private sCol = new Float32Array(MAX * (TRAIL - 1) * 6);

  constructor() {
    for (let i = 0; i < MAX; i++) {
      this.pool.push({ alive: false, t: 0, sx: 0, sy: 0, sSlot: 0, ex: 0, ey: 0, eSlot: 0, size: 0, color: new THREE.Color(), trail: new Float32Array(TRAIL * 3) });
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(this.hPos, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute('color', new THREE.BufferAttribute(this.hCol, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute('size', new THREE.BufferAttribute(this.hSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.heads = new THREE.Points(
      hg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { scale: { value: window.innerHeight } },
        vertexShader: `attribute vec3 color; attribute float size; uniform float scale; varying vec3 vC;
          void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord*2.0-1.0; float d = dot(p,p); float a = exp(-d*5.0) + 0.6*exp(-d*40.0); gl_FragColor = vec4(vC * a * 1.2, a); }`,
      }),
    );
    this.heads.frustumCulled = false;
    this.group.add(this.heads);

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.streaks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.streaks.frustumCulled = false;
    this.group.add(this.streaks);
  }

  resize() {
    (this.heads.material as THREE.ShaderMaterial).uniforms.scale.value = window.innerHeight;
  }

  launch(from: THREE.Vector3, fromSlot: number, toX: number, toY: number, toSlot: number, usd: number, color: THREE.Color, onLand?: () => void) {
    const m = this.pool.find((p) => !p.alive);
    if (!m) { onLand?.(); return; }
    m.alive = true;
    m.t = 0;
    m.sx = from.x; m.sy = from.y; m.sSlot = fromSlot;
    m.ex = toX; m.ey = toY; m.eSlot = toSlot;
    m.size = 0.12 + Math.log10(1 + usd) * 0.09;
    m.color.copy(color);
    m.onLand = onLand;
    m.trail.fill(NaN);
  }

  update(dt: number, playhead: number) {
    let h = 0, s = 0;
    for (const m of this.pool) {
      if (!m.alive) continue;
      m.t += dt / FLIGHT;
      if (m.t >= 1) {
        m.alive = false;
        m.onLand?.();
        continue;
      }
      const t = m.t;
      const e = t * t * (3 - 2 * t);
      const x = m.sx + (m.ex - m.sx) * e;
      const z = (m.sSlot + (m.eSlot - m.sSlot) * e - playhead) * PITCH;
      const y = m.sy + (m.ey - m.sy) * e + Math.sin(Math.PI * t) * (1.8 + m.size * 2);
      m.trail.copyWithin(3, 0, (TRAIL - 1) * 3);
      m.trail[0] = x; m.trail[1] = y; m.trail[2] = z;

      this.hPos[h * 3] = x; this.hPos[h * 3 + 1] = y; this.hPos[h * 3 + 2] = z;
      this.hCol[h * 3] = m.color.r; this.hCol[h * 3 + 1] = m.color.g; this.hCol[h * 3 + 2] = m.color.b;
      this.hSize[h] = m.size;
      h++;
      for (let k = 0; k < TRAIL - 1; k++) {
        const a = k * 3, b = a + 3;
        if (Number.isNaN(m.trail[b])) break;
        const o = s * 6;
        this.sPos.set([m.trail[a], m.trail[a + 1], m.trail[a + 2], m.trail[b], m.trail[b + 1], m.trail[b + 2]], o);
        const f0 = 1 - k / (TRAIL - 1), f1 = 1 - (k + 1) / (TRAIL - 1);
        this.sCol.set([m.color.r * f0, m.color.g * f0, m.color.b * f0, m.color.r * f1, m.color.g * f1, m.color.b * f1], o);
        s++;
      }
    }
    const hg = this.heads.geometry;
    hg.setDrawRange(0, h);
    for (const n of ['position', 'color', 'size']) (hg.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
    const sg = this.streaks.geometry;
    sg.setDrawRange(0, s * 2);
    for (const n of ['position', 'color']) (sg.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
}
