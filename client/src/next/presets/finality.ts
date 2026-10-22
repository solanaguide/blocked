import * as THREE from 'three';
import { geoEquirectangular, geoPath } from 'd3';
import type { Stats } from '../stats';
import type { Preset, Frame, Kpi } from './types';
import { fmtInt } from '../palette';
import { consensus, finalityMs, consensusMs, kindShare, type Consensus, type NodeView } from '../consensus';
import { place, type Place } from '../geo';

const MAX = 24;                 // cities the map shader lights
const WINDOW = 150;             // slots behind the playhead for each city's rolling stats
const PLAUSIBLE = 3;            // ms: anything faster means the node saw the block late
const REPLAY_EVERY = 20_000;    // ms between slow-motion replays
const SLOW = 25;                // replay speed divisor
const RING_SPEED = 0.028;       // deg per ms, live

type Health = 'ok' | 'flat' | 'none' | 'behind';

interface Node {
  key: string;
  p: Place;
  placed: boolean;
  x: number;                    // map position: lon, -lat (degrees), nudged apart when co-located
  z: number;
  idx: number;                  // shader slot, -1 if none
  sprite?: THREE.Sprite;
  el: HTMLDivElement;
  line: SVGPolylineElement;
  html: string;
  lw: number;                   // measured label size
  lh: number;
  sx: number; sy: number;       // projected anchor
  lx: number;                   // label centre x after packing
  row: number;
  glowSet: number;
  shownSet?: boolean;
  tf?: string;
  // live light
  notar: number;
  fin: number;
  ringMs: number;
  // rolling stats
  fs: number[];
  ns: number[];
  seen: number;
  missing: number;
  late: number;
  medF?: number;
  medN?: number;
  health: Health;
  lastSeen: number;
}

interface Replay {
  slot: number;
  c: Consensus;
  start: number;
  end: number;                  // slot-time ms where the replay stops advancing
  first: number;
  last: number;
  order: Map<string, number>;   // city → finalize rank
  fin: NodeView[];              // nodes that finalized, in order
}

// ---------- map shader ----------

const MAP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const MAP_FRAG = /* glsl */ `
  #define MAX ${MAX}
  uniform sampler2D uLand;
  uniform float uHasLand;
  uniform vec3 uSun;
  uniform vec4 uCity[MAX];      // x lon, y lat, z notarized light, w finalized light
  uniform vec4 uRing[MAX];      // x ring radius (deg), y ring strength, z health, w glow radius
  uniform int uCount;
  varying vec2 vUv;
  void main() {
    vec2 ll = vec2((vUv.x - 0.5) * 360.0, (vUv.y - 0.5) * 180.0);
    // Dot-matrix land: one dot per cell, sized by the land mask at its centre
    const float S = 1.25;
    vec2 cc = (floor(ll / S) + 0.5) * S;
    float land = texture2D(uLand, vec2(cc.x / 360.0 + 0.5, cc.y / 180.0 + 0.5)).r * uHasLand;
    float fw = max(fwidth(ll.x), fwidth(ll.y));
    float r = S * 0.3;
    float d = length(ll - cc);
    float dotm = 1.0 - smoothstep(r - fw * 0.7, r + fw * 0.7, d);
    float far = smoothstep(0.22 * S, 0.55 * S, fw);
    float landDot = mix(dotm, 0.28, far) * smoothstep(0.3, 0.6, land);

    // The real terminator right now: night, day, and a rose twilight band between
    float la = radians(ll.y), lo = radians(ll.x);
    vec3 p = vec3(cos(la) * cos(lo), sin(la), -cos(la) * sin(lo));
    float cz = dot(p, uSun);
    float day = smoothstep(-0.06, 0.35, cz);
    float twi = exp(-pow((cz + 0.03) / 0.11, 2.0));
    vec3 dotCol = mix(vec3(0.035, 0.04, 0.12), vec3(0.085, 0.082, 0.2), day) + vec3(0.95, 0.36, 0.52) * twi * 0.34;
    vec3 sea = vec3(0.008, 0.008, 0.03) + vec3(0.018, 0.016, 0.05) * day + vec3(0.16, 0.05, 0.13) * twi * 0.16;

    // Cities: a pool of light on the land around each, and a ring as it sees the block final
    vec3 light = vec3(0.0);
    float ring = 0.0;
    for (int i = 0; i < MAX; i++) {
      if (i >= uCount) break;
      vec4 c = uCity[i];
      vec4 rg = uRing[i];
      vec2 dd = ll - c.xy;
      float d2 = dot(dd, dd);
      float g = exp(-d2 / (rg.w * rg.w));
      light += g * (vec3(1.0, 0.32, 0.6) * c.z * 0.7 + vec3(1.0, 0.78, 0.8) * c.w) + exp(-d2 / 6.0) * vec3(0.35, 0.3, 0.6) * rg.z * 0.25;
      float rd = sqrt(d2) - rg.x;
      ring += rg.y * exp(-rd * rd / 0.9);
    }
    vec3 col = sea + light * 0.05 + vec3(1.0, 0.5, 0.65) * ring * 0.03;
    col += landDot * (dotCol + light * 1.6 + vec3(1.0, 0.58, 0.72) * ring);

    // Faint graticule every 30 degrees
    vec2 gq = abs(fract(ll / 30.0 + 0.5) - 0.5) * 30.0;
    vec2 gw = fwidth(ll);
    float grid = max(1.0 - smoothstep(0.0, gw.x * 1.2, gq.x), 1.0 - smoothstep(0.0, gw.y * 1.2, gq.y));
    col += vec3(0.11, 0.1, 0.26) * grid * 0.16;

    float edge = smoothstep(84.0, 66.0, ll.y) * smoothstep(-66.0, -48.0, ll.y) * smoothstep(180.0, 168.0, abs(ll.x));
    gl_FragColor = vec4(col, edge);
  }
`;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.16, 'rgba(255,240,245,0.85)');
  r.addColorStop(0.42, 'rgba(255,190,215,0.2)');
  r.addColorStop(1, 'rgba(255,160,200,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d')!;
  const l = g.createLinearGradient(0, 0, 0, 256);
  l.addColorStop(0, '#0d0824');
  l.addColorStop(0.45, '#080619');
  l.addColorStop(1, '#040310');
  g.fillStyle = l;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Subsolar point now, as a unit vector in the map shader's frame */
function sunVector(out: THREE.Vector3, date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 86_400_000;
  const decl = (-23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10)) * Math.PI) / 180;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lon = (-15 * (hours - 12) * Math.PI) / 180;
  return out.set(Math.cos(decl) * Math.cos(lon), Math.sin(decl), -Math.cos(decl) * Math.sin(lon));
}

function median(v: number[]) {
  if (!v.length) return undefined;
  const s = v.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * Finality, worldwide: a dark dot-matrix world under the real terminator,
 * with a light for every one of our Firedancer nodes. Each slot, each city
 * glows pink when it sees the block notarized and flares bright, throwing a
 * ring across the land, when it sees it finalized: on its own measured
 * latency, in the order the network actually reached it. Every so often one
 * slot is replayed at a tenth of the speed so the order can be read.
 */
export class Finality implements Preset {
  readonly id = 'finality';
  readonly title = 'FINALITY MAP';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);
  readonly bloom: [number, number, number] = [0.5, 0.4, 0.6];
  readonly crt = 0;
  maxDpr = 1.25;
  readonly feed = 'windows';
  readonly legend = `
    a light per consensus node · median ms to final<br>
    pink = that city sees the block notarized<i style="background:#ff5c9a"></i><br>
    flare + ring = it sees the block finalized<i style="background:#ffe0ea"></i><br>
    dim = node not reporting cleanly<i style="background:#4a4d7a"></i><br>
    rose band = today's real dawn / dusk line`;

  private nodes = new Map<string, Node>();
  private list: Node[] = [];
  private uCity: THREE.Vector4[] = Array.from({ length: MAX }, () => new THREE.Vector4());
  private uRing: THREE.Vector4[] = Array.from({ length: MAX }, () => new THREE.Vector4());
  private mat: THREE.ShaderMaterial;
  private glowTex = glowTexture();
  private w = 1;
  private h = 1;
  private slotMs = 200;
  private statsAt = 0;
  private sunAt = 0;
  private reporting = 0;
  private totalNodes = 0;
  private fit = { x: 0, z: -30, dist: 300, key: '' };
  private cam = { x: 0, z: -30, dist: 300 };
  private el = 52;
  private v = new THREE.Vector3();
  private active = false;
  private overlay?: HTMLDivElement;
  private svg?: SVGSVGElement;
  private strip?: HTMLCanvasElement;
  private replay?: Replay;
  private replayAt = 0;
  private stripAlpha = 0;
  private lastNow = 0;
  private shown: Node[] = [];
  private rowBuf: Node[] = [];
  private rowEnds = [0, 0, 0];

  constructor() {
    this.scene.background = skyTexture();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: MAP_VERT, fragmentShader: MAP_FRAG, transparent: true, depthWrite: false,
      uniforms: {
        uLand: { value: null }, uHasLand: { value: 0 }, uSun: { value: sunVector(new THREE.Vector3()) },
        uCity: { value: this.uCity }, uRing: { value: this.uRing }, uCount: { value: 0 },
      },
    });
    const map = new THREE.Mesh(new THREE.PlaneGeometry(360, 180), this.mat);
    map.rotation.x = -Math.PI / 2;
    this.scene.add(map);
    this.loadLand();
  }

  /** Land from Natural Earth (world-atlas 110m), rasterised once into a mask */
  private async loadLand() {
    try {
      const [{ feature }, topo] = await Promise.all([import('topojson-client'), import('world-atlas/land-110m.json')]);
      const t = (topo as any).default ?? topo;
      const land = feature(t, t.objects.land);
      const c = document.createElement('canvas');
      c.width = 1440; c.height = 720;
      const g = c.getContext('2d')!;
      const proj = geoEquirectangular().scale(c.width / (2 * Math.PI)).translate([c.width / 2, c.height / 2]);
      g.fillStyle = '#000';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff';
      g.beginPath();
      geoPath(proj, g)(land as any);
      g.fill();
      const tex = new THREE.CanvasTexture(c);
      tex.flipY = true;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      this.mat.uniforms.uLand.value = tex;
      this.mat.uniforms.uHasLand.value = 1;
    } catch (e) {
      console.warn('finality map: land failed to load', e);
    }
  }

  activate() {
    this.active = true;
    const o = document.getElementById('overlay')!;
    this.overlay = document.createElement('div');
    this.overlay.id = 'fin-labels';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.overlay.appendChild(this.svg);
    o.appendChild(this.overlay);
    for (const n of this.list) this.mountLabel(n);
    this.strip = document.createElement('canvas');
    this.strip.id = 'fin-replay';
    document.body.appendChild(this.strip);
    this.replayAt = performance.now() - REPLAY_EVERY + 5000;
    this.replay = undefined;
    const f = finalityMs();
    if (f) setTimeout(() => this.active && hero(`FINAL IN ${f.toFixed(0)}ms`), 900);
  }

  deactivate() {
    this.active = false;
    this.overlay?.remove();
    this.strip?.remove();
    this.overlay = this.svg = this.strip = undefined;
    this.replay = undefined;
  }

  enter() { /* slots are read from consensus as the playhead reaches them */ }
  trade() { /* this view is about consensus, not markets */ }

  // ---------- nodes ----------

  private ensure(key: string) {
    let n = this.nodes.get(key);
    if (n) return n;
    const p = place(key);
    const el = document.createElement('div');
    el.className = 'fin-label';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    n = {
      key, p, placed: p.lat !== undefined, x: p.lon ?? 0, z: -(p.lat ?? 0), idx: -1, el, line, html: '', lw: 90, lh: 40,
      sx: 0, sy: 0, lx: 0, row: 0, glowSet: -1, notar: 0, fin: 0, ringMs: Infinity,
      fs: [], ns: [], seen: 0, missing: 0, late: 0, health: 'none', lastSeen: 0,
    };
    if (n.placed) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      s.renderOrder = 3;
      this.scene.add(s);
      n.sprite = s;
    }
    this.nodes.set(key, n);
    this.list.push(n);
    this.spread();
    if (this.overlay) this.mountLabel(n);
    return n;
  }

  private mountLabel(n: Node) {
    this.overlay!.appendChild(n.el);
    this.svg!.appendChild(n.line);
    n.html = '';
  }

  /** Co-located nodes (e.g. three Frankfurt districts) fan out so each light is visible */
  private spread() {
    const placed = this.list.filter((n) => n.placed);
    const groups: Node[][] = [];
    for (const n of placed) {
      const g = groups.find((gr) => gr.some((m) => Math.hypot((m.p.lon! - n.p.lon!), (m.p.lat! - n.p.lat!)) < 2.2));
      if (g) g.push(n); else groups.push([n]);
    }
    for (const g of groups) {
      g.sort((a, b) => a.p.lon! - b.p.lon! || a.key.localeCompare(b.key));
      const cx = g.reduce((s, n) => s + n.p.lon!, 0) / g.length, cy = g.reduce((s, n) => s + n.p.lat!, 0) / g.length;
      g.forEach((n, i) => {
        if (g.length === 1) { n.x = n.p.lon!; n.z = -n.p.lat!; return; }
        const a = Math.PI + (i / g.length) * Math.PI * 2;
        n.x = cx + Math.cos(a) * 1.5;
        n.z = -(cy + Math.sin(a) * 1.1);
      });
    }
    // Shader slots: placed nodes first come, first served
    let k = 0;
    for (const n of this.list) n.idx = n.placed && k < MAX ? k++ : -1;
    this.mat.uniforms.uCount.value = k;
  }

  /** Rolling per-city medians and an honest read of each node's health */
  private refreshStats(ph: number) {
    const top = Math.floor(ph) - 1;
    for (const n of this.list) { n.fs.length = 0; n.ns.length = 0; n.seen = n.missing = n.late = 0; }
    const counts: number[] = [];
    for (let s = top; s > top - WINDOW; s--) {
      const c = consensus(s);
      if (!c) continue;
      let k = 0;
      for (const x of c.nodes) {
        const n = this.ensure(x.city);
        n.seen++;
        n.lastSeen = s;
        if (x.f === undefined) n.missing++;
        else if (x.f < PLAUSIBLE) n.late++;
        else { n.fs.push(x.f); k++; }
        if (x.n !== undefined && x.n >= PLAUSIBLE * 0.5) n.ns.push(x.n);
      }
      if (counts.length < 30) counts.push(k);
    }
    this.reporting = median(counts) ?? 0;
    let total = 0;
    for (const n of this.list) {
      if (n.seen) total++;
      n.medF = median(n.fs);
      n.medN = median(n.ns);
      const ok = n.fs.length;
      let lo = Infinity, hi = -Infinity;
      for (const v of n.fs) { if (v < lo) lo = v; if (v > hi) hi = v; }
      n.health = !n.seen || ok < n.seen * 0.25 ? (n.late > n.missing ? 'behind' : 'none') : ok >= 12 && hi - lo < 3 ? 'flat' : 'ok';
    }
    this.totalNodes = total;
    if (!this.replay) this.renderLabels();
  }

  private renderLabels(rt = Infinity) {
    const replay = this.replay;
    for (const n of this.list) {
      const sub = n.p.metro ? `${n.p.metro} · ${n.p.cc}` : n.p.cc;
      let html: string, cls = 'fin-label';
      if (replay) {
        const x = replay.c.nodes.find((y) => y.city === n.key);
        const rank = replay.order.get(n.key);
        // Revealed as the replay cursor reaches each city
        const fin = rank !== undefined && rt >= x!.f!;
        const notar = x?.n !== undefined && rt >= x.n;
        html = `<b>${esc(n.p.name)}</b><span>${fin ? `+${x!.f!.toFixed(0)}ms` : rank !== undefined ? '···' : '—'}</span><i>${
          fin ? `${ordinal(rank! + 1)} to see it final` : rank === undefined ? 'not in this replay' : notar ? `notarized +${x!.n!.toFixed(0)}ms` : 'waiting'}</i>`;
        if (rank === undefined) cls += ' dim';
        if (fin) cls += ' hit';
      } else if (n.health === 'ok' && n.medF !== undefined) {
        html = `<b>${esc(n.p.name)}</b><span>${n.medF.toFixed(0)}ms</span><i>${esc(sub)}${n.medN !== undefined ? ` · notar ${n.medN.toFixed(0)}` : ''}</i>`;
      } else {
        const why = n.health === 'flat' ? `flat ${n.medF?.toFixed(0)}ms · suspect` : n.health === 'behind' ? 'catching up' : 'no finality reported';
        html = `<b>${esc(n.p.name)}</b><span>—</span><i>${esc(why)}</i>`;
        cls += ' dim';
      }
      if (!n.placed) cls += ' unplaced';
      if (n.p.approx && n.placed) html = html.replace('</b>', ' <em>≈</em></b>');
      if (html !== n.html) {
        n.html = html;
        n.el.innerHTML = html;
        n.el.className = cls;
        n.lw = n.el.offsetWidth || 90;
        n.lh = n.el.offsetHeight || 40;
      }
    }
  }

  // ---------- frame ----------

  update(f: Frame) {
    if (f.timeline.slotsPerSec > 0) this.slotMs = 1000 / f.timeline.slotsPerSec;
    const now = performance.now();
    const ph = f.playhead;
    if (now - this.statsAt > 500 && ph) { this.statsAt = now; this.refreshStats(ph); }
    if (now - this.sunAt > 10_000) { this.sunAt = now; sunVector(this.mat.uniforms.uSun.value); }

    // Replays: one recent slot in slow motion, every so often
    if (!this.replay && ph && now - this.replayAt > REPLAY_EVERY) this.startReplay(ph, now);
    let rt = 0;
    const r = this.replay;
    if (r) {
      rt = Math.min(r.end, (now - r.start) / SLOW - 40);
      if (now - r.start > (r.end + 40) * SLOW + 3500) { this.replay = undefined; this.replayAt = now; this.renderLabels(); }
    }

    for (const n of this.list) { n.notar = 0; n.fin = 0; n.ringMs = Infinity; }
    if (r && this.replay) { this.lightReplay(r, rt); this.renderLabels(rt); }
    else if (ph) this.lightLive(ph);

    // Lights, sprites and shader inputs
    for (const n of this.list) {
      const dim = n.health !== 'ok' && !r;
      const health = n.health === 'ok' ? 1 : 0.35;
      if (n.sprite) {
        const s = n.sprite;
        s.position.set(n.x, 0.2, n.z);
        s.scale.setScalar(2.6 + n.notar * 1.4 + n.fin * 3.6);
        const m = s.material;
        // Resting lavender → notarized pink → finalized near-white rose
        if (n.fin > 0.02) m.color.setRGB(1, 0.55 + 0.4 * n.fin, 0.72 + 0.2 * n.fin);
        else if (n.notar > 0.02) m.color.setRGB(0.6 + 0.4 * n.notar, 0.5 - 0.1 * n.notar, 0.85 - 0.2 * n.notar);
        else m.color.setRGB(0.6, 0.6, 0.9);
        m.opacity = dim ? 0.35 : 0.85 + 0.15 * Math.max(n.notar, n.fin);
      }
      if (n.idx >= 0) {
        this.uCity[n.idx].set(n.x, -n.z, n.notar, n.fin);
        const ringSpeed = r ? RING_SPEED * 0.55 : RING_SPEED;
        const ringLife = r ? 1600 : 480;
        const age = n.ringMs;
        const live = age < ringLife;
        this.uRing[n.idx].set(live ? age * ringSpeed : 0, live ? (1 - age / ringLife) ** 2 * (r ? 0.9 : 0.55) : 0, health, r ? 5 : 4);
      }
      // Label glow tracks the city's finalize flare
      const g = Math.round(Math.max(n.fin, n.notar * 0.4) * 20) / 20;
      if (g !== n.glowSet) { n.glowSet = g; n.el.style.setProperty('--g', String(g)); }
    }

    this.frame(f);
    this.layoutLabels(f.portrait);
    this.drawStrip(r, rt, Math.min(0.25, (now - this.lastNow) / 1000));
    this.lastNow = now;
  }

  /** Live: each node lights on its own measured latency, slot after slot */
  private lightLive(ph: number) {
    const top = Math.floor(ph);
    for (let s = top; s > top - 8; s--) {
      const c = consensus(s);
      if (!c) continue;
      const since = (ph - s - 1) * this.slotMs;
      if (since < 0) continue;
      for (const x of c.nodes) {
        const n = this.nodes.get(x.city);
        if (!n || n.health !== 'ok') continue;
        if (x.n !== undefined && since >= x.n) n.notar = Math.max(n.notar, Math.exp(-(since - x.n) / 160));
        if (x.f !== undefined && x.f >= PLAUSIBLE && since >= x.f) {
          const a = since - x.f;
          n.fin = Math.max(n.fin, Math.exp(-a / 170));
          if (a < n.ringMs) n.ringMs = a;
        }
      }
    }
  }

  /** Replay: lights accumulate and hold, so the order of arrival stays readable */
  private lightReplay(r: Replay, rt: number) {
    for (const x of r.c.nodes) {
      const n = this.nodes.get(x.city);
      if (!n) continue;
      if (x.n !== undefined && rt >= x.n) n.notar = 0.55 + 0.45 * Math.exp(-(rt - x.n) / 12);
      if (x.f !== undefined && r.order.has(x.city) && rt >= x.f) {
        n.fin = 0.6 + 0.4 * Math.exp(-(rt - x.f) / 14);
        n.ringMs = (rt - x.f) * SLOW;
      }
    }
  }

  private startReplay(ph: number, now: number) {
    // The most widely reported recent slot, so the order has as many cities as possible
    let best: Consensus | undefined, bestK = 1;
    for (let s = Math.floor(ph) - 2; s > Math.floor(ph) - 40; s--) {
      const c = consensus(s);
      if (!c) continue;
      const k = c.nodes.filter((x) => x.f !== undefined && x.f >= PLAUSIBLE && this.nodes.get(x.city)?.health === 'ok').length;
      if (k > bestK) { best = c; bestK = k; }
    }
    this.replayAt = now;
    if (!best) return;
    const fin = best.nodes.filter((x) => x.f !== undefined && x.f >= PLAUSIBLE && this.nodes.get(x.city)?.health === 'ok').sort((a, b) => a.f! - b.f!);
    const order = new Map(fin.map((x, i) => [x.city, i]));
    const last = fin[fin.length - 1].f!;
    this.replay = { slot: best.slot, c: best, start: now, end: Math.max(last + 12, 50), first: fin[0].f!, last, order, fin };
    this.renderLabels();
  }

  // ---------- camera ----------

  /** Fit the placed cities into the frame below the label rail and above the KPIs */
  private frame(f: Frame) {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const n of this.list) {
      if (!n.placed || !n.seen) continue;
      a = Math.min(a, n.x); b = Math.max(b, n.x); c = Math.min(c, -n.z); d = Math.max(d, -n.z);
    }
    if (a === Infinity) { a = -20; b = 40; c = 30; d = 60; }
    a -= 24; b += 24; c -= 16; d += 8;
    if (b - a < 140) { const m = (a + b) / 2; a = m - 70; b = m + 70; }
    if (d - c < 50) { const m = (c + d) / 2; c = m - 25; d = m + 25; }
    a = Math.max(-180, a); b = Math.min(180, b); d = Math.min(78, d); c = Math.max(-60, c);
    // Portrait screens can't hold the whole spread legibly: frame a window and pan slowly across
    let pan = 0;
    const cap = f.portrait ? 120 : 360;
    if (b - a > cap) {
      pan = ((b - a - cap) / 2) * Math.sin(f.t * 0.07);
      const m = (a + b) / 2;
      a = m - cap / 2; b = m + cap / 2;
      c -= 6; d = Math.min(78, d + 4);
    }
    const key = `${a.toFixed(0)},${b.toFixed(0)},${c.toFixed(0)},${d.toFixed(0)},${this.w},${this.h}`;
    if (key !== this.fit.key) this.solveFit(a, b, c, d, f.portrait, key);
    // Ease toward the fit, with a slow drift
    const k = Math.min(1, f.dt * 1.5);
    this.cam.x += (this.fit.x + pan - this.cam.x) * k;
    this.cam.z += (this.fit.z - this.cam.z) * k;
    this.cam.dist += (this.fit.dist - this.cam.dist) * k;
    const sway = Math.sin(f.t * 0.05) * 0.012 + f.pointer.x * 0.02;
    const el = (this.el * Math.PI) / 180 - f.pointer.y * 0.02;
    this.placeCamera(this.cam.x, this.cam.z, this.cam.dist, el, sway);
  }

  private placeCamera(x: number, z: number, dist: number, el: number, yaw = 0) {
    this.camera.position.set(x + Math.sin(yaw) * Math.cos(el) * dist, Math.sin(el) * dist, z + Math.cos(yaw) * Math.cos(el) * dist);
    this.camera.lookAt(x, 0, z);
    this.camera.updateMatrixWorld();
  }

  private solveFit(a: number, b: number, c: number, d: number, portrait: boolean, key: string) {
    this.fit.key = key;
    this.el = portrait ? 64 : 54;
    const el = (this.el * Math.PI) / 180;
    // Target screen box in NDC: under the label rail, over the KPIs
    const [y0, y1] = portrait ? [-0.42, 0.42] : [-0.62, 0.36];
    const xs = 0.94;
    let x = (a + b) / 2, z = -(c + d) / 2, dist = 300;
    const pts = [[a, c], [b, c], [a, d], [b, d], [(a + b) / 2, c], [(a + b) / 2, d]];
    for (let i = 0; i < 40; i++) {
      this.placeCamera(x, z, dist, el);
      this.camera.updateProjectionMatrix();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [lon, lat] of pts) {
        this.v.set(lon, 0, -lat).project(this.camera);
        minX = Math.min(minX, this.v.x); maxX = Math.max(maxX, this.v.x); minY = Math.min(minY, this.v.y); maxY = Math.max(maxY, this.v.y);
      }
      const s = Math.max((maxX - minX) / (2 * xs), (maxY - minY) / (y1 - y0));
      dist *= 1 + (s - 1) * 0.7;
      const cy = (minY + maxY) / 2, ty = (y0 + y1) / 2;
      z -= (cy - ty) * ((d - c) / Math.max(0.01, maxY - minY)) * 0.7;
      x += ((minX + maxX) / 2) * ((b - a) / Math.max(0.01, maxX - minX)) * 0.7;
    }
    this.fit.x = x; this.fit.z = z; this.fit.dist = dist;
    if (!this.cam.dist || this.cam.dist === 300) { this.cam.x = x; this.cam.z = z; this.cam.dist = dist; }
  }

  // ---------- labels ----------

  /** A rail of labels above the map, packed in x order, each with a thin leader line */
  private layoutLabels(portrait: boolean) {
    if (!this.overlay) return;
    this.overlay.style.display = portrait ? 'none' : '';
    if (portrait) return;
    const W = this.w;
    const top = Math.max(118, this.h * 0.17);
    const shown = this.shown;
    shown.length = 0;
    for (const n of this.list) {
      const vis = n.seen > 0;
      if (vis !== n.shownSet) { n.shownSet = vis; n.el.style.display = vis ? '' : 'none'; if (!vis) setAttr(n.line, 'points', ''); }
      if (!vis) continue;
      if (n.placed) {
        this.v.set(n.x, 0.2, n.z).project(this.camera);
        n.sx = (this.v.x * 0.5 + 0.5) * W;
        n.sy = (-this.v.y * 0.5 + 0.5) * this.h;
      } else {
        n.sx = W + 1000 + shown.length;   // unplaced: packed at the end of the rail
        n.sy = -1;
      }
      shown.push(n);
    }
    shown.sort((p, q) => p.sx - q.sx);
    const gap = 10, margin = 18;
    let total = -gap;
    for (const n of shown) total += n.lw + gap;
    const rows = total > W - 2 * margin ? 2 : 1;
    const rs = this.rowBuf;
    for (let row = 0; row < rows; row++) {
      rs.length = 0;
      for (let i = row; i < shown.length; i += rows) rs.push(shown[i]);
      // Forward pass from desired centres, then pull back inside the screen
      let x = -Infinity;
      for (const n of rs) {
        const want = Math.min(n.sx, W + 500);
        n.lx = Math.max(want, x + n.lw / 2);
        x = n.lx + n.lw / 2 + gap;
      }
      let limit = W - margin;
      for (let i = rs.length - 1; i >= 0; i--) {
        const n = rs[i];
        n.lx = Math.min(n.lx, limit - n.lw / 2);
        limit = n.lx - n.lw / 2 - gap;
      }
      let first = margin;
      for (const n of rs) { n.lx = Math.max(n.lx, first + n.lw / 2); first = n.lx + n.lw / 2 + gap; n.row = row; }
    }
    for (const n of shown) {
      const y = top - n.row * 50;
      const left = n.lx - n.lw / 2;
      const tf = `translate(${left.toFixed(0)}px, ${y.toFixed(0)}px)`;
      if (tf !== n.tf) { n.tf = tf; n.el.style.transform = tf; }
      if (n.placed) {
        const yb = y + n.lh;
        const knee = yb + 14 + n.row * 4;
        setAttr(n.line, 'points', `${n.lx.toFixed(0)},${yb.toFixed(0)} ${n.lx.toFixed(0)},${knee.toFixed(0)} ${n.sx.toFixed(1)},${Math.max(knee + 10, n.sy - 6).toFixed(1)} ${n.sx.toFixed(1)},${(n.sy - 4).toFixed(1)}`);
        setAttr(n.line, 'class', n.el.classList.contains('dim') ? 'dim' : '');
      } else setAttr(n.line, 'points', '');
    }
  }

  // ---------- replay strip ----------

  private drawStrip(r: Replay | undefined, rt: number, dt: number) {
    const cv = this.strip;
    if (!cv) return;
    this.stripAlpha += ((r ? 1 : 0) - this.stripAlpha) * Math.min(1, dt * 4);
    cv.style.opacity = this.stripAlpha.toFixed(3);
    if (this.stripAlpha < 0.01 || !r) return;
    const dpr = Math.min(devicePixelRatio, 2);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const x0 = 14, x1 = W - 14, axis = H - 20;
    const T = Math.ceil((r.end + 5) / 25) * 25;
    const X = (ms: number) => x0 + ((x1 - x0) * Math.max(0, ms)) / T;

    g.font = '10px "Share Tech Mono", monospace';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ff8fb8';
    g.textAlign = 'left';
    const narrow = W < 560;
    g.fillText(narrow ? `REPLAY 1/${SLOW} · SLOT ${fmtInt(r.slot)}` : `REPLAY · SLOT ${fmtInt(r.slot)} · 1/${SLOW} SPEED`, x0, 11);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(215,220,255,0.75)';
    g.fillText(`${narrow ? 'spread' : 'first → last city final:'} ${(r.last - r.first).toFixed(0)}ms`, x1, 11);

    // Axis, from the block completing
    g.fillStyle = 'rgba(200,205,255,0.25)';
    g.fillRect(x0, axis, x1 - x0, 1);
    g.textAlign = 'center';
    for (let ms = 0; ms <= T; ms += 25) {
      g.fillStyle = 'rgba(200,205,255,0.35)';
      g.fillRect(Math.round(X(ms)), axis, 1, 4);
      g.fillStyle = 'rgba(200,205,255,0.5)';
      g.textAlign = ms === 0 ? 'left' : 'center';
      g.fillText(ms === 0 ? (narrow ? '0' : '0 = block complete') : `${ms}ms`, ms === 0 ? x0 - 1 : X(ms), axis + 15);
    }

    // Notarized dots and finalized ticks; labels staggered so close arrivals stay readable
    const rows = this.rowEnds;
    rows[0] = rows[1] = rows[2] = -1e9;
    for (const x of r.c.nodes) {
      if (x.n === undefined || !r.order.has(x.city)) continue;
      const lit = rt >= x.n;
      g.fillStyle = lit ? '#ff5c9a' : 'rgba(255,92,154,0.25)';
      g.beginPath();
      g.arc(X(x.n), axis, lit ? 2.6 : 2, 0, Math.PI * 2);
      g.fill();
    }
    for (const x of r.fin) {
      const px = X(x.f!);
      let row = rows.findIndex((end) => px - end > 30);
      if (row < 0) row = rows[0] <= rows[1] && rows[0] <= rows[2] ? 0 : rows[1] <= rows[2] ? 1 : 2;
      rows[row] = px;
      const lit = rt >= x.f!;
      const yTop = axis - 12 - row * 11;
      g.fillStyle = lit ? '#ffe0ea' : 'rgba(255,224,234,0.22)';
      g.fillRect(Math.round(px), yTop + 2, 1.5, axis - yTop - 2);
      g.fillText(this.nodes.get(x.city)?.p.code ?? x.city.slice(3, 6).toUpperCase(), px, yTop);
    }

    // Playback cursor
    if (rt >= 0) {
      const cx = X(Math.min(rt, T));
      g.fillStyle = 'rgba(255,170,200,0.9)';
      g.fillRect(Math.round(cx), axis - 44, 1, 48);
    }
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 40 : 30;
    this.camera.updateProjectionMatrix();
    this.fit.key = '';
  }

  kpis(_s: Stats): Kpi[] {
    const total = this.totalNodes;
    return [
      { label: 'Finality', value: finalityMs(), fmt: (v) => (v ? v.toFixed(0) + 'ms' : '—'), color: '#ffc0a0' },
      { label: 'Consensus after block', value: consensusMs(), fmt: (v) => (v ? v.toFixed(0) + 'ms' : '—'), color: '#ffd2dc' },
      { label: 'Fast-finalized', value: kindShare('fast') * 100, fmt: (v) => (v ? v.toFixed(1) + '%' : '—'), color: '#ff8fb8' },
      { label: 'Nodes reporting', value: this.reporting, fmt: (v) => (total ? `${Math.round(v)}/${total}` : '—'), color: '#e6e2ff' },
    ];
  }
}

/** Only touch the DOM when a value actually changes */
function setAttr(el: Element, k: string, v: string) {
  if (el.getAttribute(k) !== v) el.setAttribute(k, v);
}

function ordinal(n: number) {
  return n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Kinetic hero line, shared element with City and Alpenglow */
function hero(text: string) {
  const el = document.getElementById('hero');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('slam');
  void el.offsetWidth;
  el.classList.add('slam');
}
