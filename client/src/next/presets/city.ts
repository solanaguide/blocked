import * as THREE from 'three';
import type { Block } from '../feed';
import type { Stats } from '../stats';
import type { Preset, Frame, TradeEvent, Kpi } from './types';
import { LaneMap } from '../world/terrain';
import { TextSprite } from '../world/labels';
import { Callouts } from '../callouts';
import { validatorName } from '../validators';
import { short } from '../hud';
import { LIMITS, FLOW, fmtUsd, fmtInt } from '../palette';

const CELL = 3.4;
const SPAN = 9;               // city is (2*SPAN+1)^2 cells
const DATA = 40;              // token towers nearest the centre
const PORTS = 6;              // DEX spires on the perimeter
const PORT_R = 6.6 * CELL;
const CARS = 1600;
const CAR_SPEED = 19;         // world units per playback second
const RAIN = 3500;

const AMBER = new THREE.Color('#ffa24a');
const MAGENTA = '#ff3ea5';
const WASHED = new THREE.Color('#6f7f86');

/** Facades with procedurally lit windows; lit fraction and heat per instance */
const towerVert = /* glsl */ `
  attribute vec3 iSize; attribute vec3 iTint; attribute float iLit; attribute float iSeed; attribute float iHeat;
  varying vec3 vLocal; varying vec3 vN; varying vec3 vSize; varying vec3 vTint; varying float vLit; varying float vSeed; varying float vHeat; varying float vDepth;
  void main(){
    vLocal = position * iSize; vN = normal; vSize = iSize; vTint = iTint; vLit = iLit; vSeed = iSeed; vHeat = iHeat;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const towerFrag = /* glsl */ `
  uniform float time; uniform vec3 fogColor; uniform float fogDensity;
  varying vec3 vLocal; varying vec3 vN; varying vec3 vSize; varying vec3 vTint; varying float vLit; varying float vSeed; varying float vHeat; varying float vDepth;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main(){
    float side = step(abs(vN.y), 0.5);
    float u = abs(vN.x) > 0.5 ? vLocal.z : vLocal.x;
    float y = vLocal.y + vSize.y * 0.5;
    vec2 g = vec2(u / 0.26, y / 0.34);
    vec2 c = floor(g), f = fract(g);
    float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.72);
    float h = hash(c + vSeed * 17.0 + vN.xz * 3.1);
    float flick = hash(c + floor(vec2(time * 0.12 + h * 9.0)));
    float lit = step(h, vLit) * step(0.06, flick);
    vec3 col = vec3(0.010, 0.014, 0.024);
    col += side * win * mix(vec3(0.016, 0.022, 0.034), vTint * (0.42 + vHeat * 0.9), lit);
    vec3 d = vSize * 0.5 - abs(vLocal);
    float b = max(min(d.x, d.y), min(max(d.x, d.y), d.z));
    col += (1.0 - smoothstep(0.0, 0.05, b)) * vec3(0.06, 0.09, 0.14) * (0.6 + vHeat * 2.0);
    float fog = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth);
    gl_FragColor = vec4(mix(col, fogColor, fog), 1.0);
  }`;

interface Tower { x: number; z: number; w: number; h: number; target: number; lit: number; heat: number; seed: number; tint: THREE.Color }

interface Car {
  alive: boolean;
  pts: THREE.Vector3[];
  len: number[];      // cumulative
  s: number;
  size: number;
  color: THREE.Color;
  onArrive?: () => void;
}

/**
 * Blade Runner / Fifth Element city. Towers are tokens (height = rolling
 * volume, lit windows = live trades), perimeter spires are DEXes, and every
 * trade is a flying car on the sky lanes from its DEX to its token.
 */
export class City implements Preset {
  readonly id = 'city';
  readonly title = 'CITY';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  readonly bloom: [number, number, number] = [0.75, 0.5, 0.32];
  readonly feed = 'whales';
  readonly legend = `
    Tower = token · height = recent volume<br>
    Lit windows = trades right now<br>
    Spires = DEXes · cars = trades<i style="background:#ffa24a"></i><br>
    Centre spire = current leader · ring = new slot`;

  private towers: Tower[] = [];
  private tokens = new LaneMap(DATA, 40);
  private dexes = new LaneMap(PORTS, 60);
  private names = new Map<string, string>();
  private vol = new Float32Array(DATA);
  private act = new Float32Array(DATA);
  private mesh: THREE.InstancedMesh;
  private attr: Record<'size' | 'tint' | 'lit' | 'seed' | 'heat', THREE.InstancedBufferAttribute>;
  private towerMat: THREE.ShaderMaterial;
  private ports: { pos: THREE.Vector3; sign: TextSprite }[] = [];
  private cars: Car[] = [];
  private carLines: THREE.LineSegments;
  private carPos = new Float32Array(CARS * 6);
  private carCol = new Float32Array(CARS * 6);
  private heads: THREE.Points;
  private headPos = new Float32Array(CARS * 3);
  private headCol = new Float32Array(CARS * 3);
  private headSize = new Float32Array(CARS);
  private rain: THREE.LineSegments;
  private rainPos = new Float32Array(RAIN * 6);
  private rings: { mesh: THREE.Mesh; age: number }[] = [];
  private nextRing = 0;
  private board: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string };
  private callouts = new Callouts();
  private towerTags: ReturnType<Callouts['add']>[] = [];
  private tagAt = 0;
  private screen!: THREE.Mesh;
  private wash = new Float32Array(DATA);
  private peak = 10;
  private lastWhale = 0;
  private whaleTags = 0;
  private leader = '';
  private slot = 0;
  private fill = 0;
  private tmp = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private look = new THREE.Vector3(0, 5, 0);
  private w = 1;
  private h = 1;

  constructor() {
    this.scene.background = new THREE.Color('#04070d');
    this.scene.fog = new THREE.FogExp2('#0b1424', 0.02);

    // --- Towers: data towers spiral out from the centre, filler beyond ---
    const cells: [number, number][] = [];
    for (let i = -SPAN; i <= SPAN; i++) for (let j = -SPAN; j <= SPAN; j++) if (i || j) cells.push([i, j]);
    cells.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    const portAngles = Array.from({ length: PORTS }, (_, k) => (k / PORTS) * Math.PI * 2 + 0.3);
    const nearPort = (x: number, z: number) => portAngles.some((a) => Math.hypot(x - Math.cos(a) * PORT_R, z - Math.sin(a) * PORT_R) < CELL * 1.2);
    for (const [i, j] of cells) {
      const x = i * CELL, z = j * CELL;
      if (nearPort(x, z) || Math.hypot(x, z) > SPAN * CELL) continue;
      const data = this.towers.length < DATA;
      const r = Math.random();
      this.towers.push({
        x, z, w: CELL * (0.45 + r * 0.25), h: data ? 1.5 : 1 + Math.random() * 5 * Math.exp(-Math.hypot(i, j) / 8),
        target: 1.5, lit: data ? 0.05 : 0.04 + Math.random() * 0.08, heat: 0, seed: Math.random() * 100,
        tint: data ? new THREE.Color('#ffe2b8') : new THREE.Color('#9fb6d6'),
      });
    }
    // Centre spire
    this.towers.push({ x: 0, z: 0, w: 2.2, h: 19, target: 19, lit: 0.3, heat: 0, seed: 7, tint: new THREE.Color('#cfe4ff') });
    // DEX spires
    for (const a of portAngles) {
      const pos = new THREE.Vector3(Math.cos(a) * PORT_R, 13, Math.sin(a) * PORT_R);
      this.towers.push({ x: pos.x, z: pos.z, w: 1.6, h: 14, target: 14, lit: 0.18, heat: 0, seed: a * 10, tint: new THREE.Color('#ffd0a0') });
      const sign = new TextSprite(0.8, 64, { glow: 0.25 });
      sign.sprite.position.set(pos.x * 1.06, 8, pos.z * 1.06);
      sign.sprite.center.set(0.5, 0.5);
      sign.opacity = 0;
      this.scene.add(sign.sprite);
      this.ports.push({ pos, sign });
    }
    this.dexes.onChange = (l, key) => {
      const p = this.ports[l];
      if (!key) { p.sign.opacity = 0; return; }
      // Vertical neon sign: one glyph per line
      const word = key.replace(/\s+/g, '').toUpperCase().slice(0, 9);
      p.sign.set([...word].map((ch) => ({ text: ch, color: '#ffb36b', font: 'Orbitron, sans-serif' })));
      p.sign.opacity = 0.95;
    };

    const n = this.towers.length;
    this.towerMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, fogColor: { value: new THREE.Color('#0b1424') }, fogDensity: { value: 0.02 } },
      vertexShader: towerVert,
      fragmentShader: towerFrag,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.towerMat, n);
    const mk = (k: number) => new THREE.InstancedBufferAttribute(new Float32Array(n * k), k).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.attr = { size: mk(3), tint: mk(3), lit: mk(1), seed: mk(1), heat: mk(1) };
    const g = this.mesh.geometry;
    g.setAttribute('iSize', this.attr.size); g.setAttribute('iTint', this.attr.tint);
    g.setAttribute('iLit', this.attr.lit); g.setAttribute('iSeed', this.attr.seed); g.setAttribute('iHeat', this.attr.heat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    // Ground with warm street grid
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShaderMaterial({
      uniforms: { fogColor: { value: new THREE.Color('#0b1424') } },
      vertexShader: `varying vec3 vW; varying float vD; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 fogColor; varying vec3 vW; varying float vD;
        float line(float v){ float d = abs(fract(v) - 0.5) / fwidth(v); return 1.0 - min(d * 0.7, 1.0); }
        void main(){
          float s = max(line(vW.x / ${CELL.toFixed(2)}), line(vW.z / ${CELL.toFixed(2)}));
          vec3 c = vec3(0.012, 0.016, 0.026) + vec3(1.0, 0.55, 0.22) * s * 0.16 * exp(-length(vW.xz) / 40.0);
          gl_FragColor = vec4(mix(c, fogColor, 1.0 - exp(-0.0004 * vD * vD)), 1.0);
        }`,
    }));
    (ground.material as THREE.ShaderMaterial).extensions.derivatives = true;
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Leader billboard: four screens around the spire top
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.board = { canvas, tex, key: '' };
    const screenMat = new THREE.MeshBasicMaterial({ map: tex, fog: false, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(0.62, 0.62, 0.62) });
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(11, 5.5), screenMat);
    this.screen.position.set(0, 15.5, 0);
    this.scene.add(this.screen);

    // Slot heartbeat rings from the spire top
    for (let k = 0; k < 8; k++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.96, 1, 96),
        new THREE.MeshBasicMaterial({ color: '#cfe4ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 19.2;
      this.scene.add(mesh);
      this.rings.push({ mesh, age: 1 });
    }

    // Cars: streak + glowing head
    for (let i = 0; i < CARS; i++) this.cars.push({ alive: false, pts: [], len: [], s: 0, size: 1, color: new THREE.Color() });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.carPos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.carCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.carLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
    this.carLines.frustumCulled = false;
    this.scene.add(this.carLines);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(this.headPos, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute('color', new THREE.BufferAttribute(this.headCol, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute('size', new THREE.BufferAttribute(this.headSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.heads = new THREE.Points(hg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { scale: { value: 800 } },
      vertexShader: `attribute vec3 color; attribute float size; uniform float scale; varying vec3 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord*2.0-1.0; float a = exp(-dot(p,p)*6.0); gl_FragColor = vec4(vC*a*1.4, a); }`,
    }));
    this.heads.frustumCulled = false;
    this.scene.add(this.heads);

    // Rain
    for (let i = 0; i < RAIN; i++) this.dropRain(i, true);
    const rg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#7f93b3', transparent: true, opacity: 0.22, depthWrite: false, fog: true }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  private dropRain(i: number, anywhere = false) {
    const x = (Math.random() - 0.5) * 70, z = (Math.random() - 0.5) * 70;
    const y = anywhere ? Math.random() * 30 : 30 + Math.random() * 4;
    this.rainPos.set([x, y, z, x + 0.06, y + 0.7, z + 0.03], i * 6);
  }

  reset() {
    this.tokens.reset();
    this.dexes.reset();
    this.vol.fill(0); this.wash.fill(0); this.act.fill(0);
    this.peak = 10;
    for (const c of this.towerTags) this.callouts.remove(c);
    this.towerTags = [];
    this.tagAt = 0;
  }

  activate() { this.callouts.visible = true; }
  deactivate() { this.callouts.visible = false; this.callouts.clear(); this.towerTags = []; }

  enter(slot: number, b: Block | undefined) {
    this.slot = slot;
    const tv = new Map<string, number>(), dv = new Map<string, number>();
    const tn = new Float32Array(DATA);
    for (const t of b?.trades ?? []) {
      tv.set(t.tokenMint, (tv.get(t.tokenMint) ?? 0) + t.usd);
      dv.set(t.program, (dv.get(t.program) ?? 0) + t.usd);
      this.names.set(t.tokenMint, t.token);
    }
    this.tokens.observe(tv);
    this.dexes.observe(dv);
    for (const t of b?.trades ?? []) {
      const i = this.tokens.lane(t.tokenMint);
      if (i < 0) continue;
      this.vol[i] += t.usd;
      if (t.quality === 2) this.wash[i] += t.usd;
      tn[i]++;
    }
    this.peak = Math.max(10, this.peak * 0.998, ...this.vol);
    for (let i = 0; i < DATA; i++) {
      this.vol[i] *= FLOW.decay;
      this.wash[i] *= FLOW.decay;
      // Towers propped up by wash trading look hollow: cold, sickly windows
      const ws = this.vol[i] > 0 ? this.wash[i] / this.vol[i] : 0;
      this.towers[i].tint.set('#ffe2b8').lerp(WASHED, Math.min(1, ws * 1.3));
      this.act[i] = this.act[i] * (FLOW.decay > 0.996 ? 0.97 : 0.85) + tn[i];
      const t = this.towers[i];
      // Heights are relative to the busiest tower, so any flow size fills the skyline
      t.target = this.tokens.keys[i] ? 1.6 + 9 * (Math.log1p(this.vol[i]) / Math.log1p(this.peak)) : 1.2;
      t.lit = Math.min(0.6, 0.05 + this.act[i] * 0.08);
    }
    if (b) {
      this.leader = b.leader;
      this.fill = b.cu / LIMITS.cu;
    }
    const r = this.rings[this.nextRing++ % this.rings.length];
    r.age = 0;
    (r.mesh.material as THREE.MeshBasicMaterial).color.set(b ? '#cfe4ff' : '#ff3a3a');
    this.drawBoard();
  }

  private drawBoard() {
    const name = this.leader ? validatorName(this.leader) ?? short(this.leader) : '—';
    const key = `${name}|${this.slot % 4}|${Math.round(this.fill * 100)}`;
    if (key === this.board.key) return;
    this.board.key = key;
    const { canvas } = this.board;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#0a0108';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.strokeStyle = MAGENTA; c.lineWidth = 10;
    c.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    c.fillStyle = MAGENTA; c.font = '600 52px "Share Tech Mono", monospace';
    c.fillText('NOW LEADING', 56, 110);
    c.fillStyle = '#ffffff';
    let size = 150;
    c.font = `900 ${size}px Orbitron, sans-serif`;
    while (c.measureText(name).width > canvas.width - 112 && size > 48) c.font = `900 ${(size -= 6)}px Orbitron, sans-serif`;
    c.fillText(name, 56, 300);
    c.fillStyle = MAGENTA; c.font = '56px "Share Tech Mono", monospace';
    const pos = (this.slot % 4) + 1;
    c.fillText(`SLOT ${pos}/4 ${'■'.repeat(pos)}${'□'.repeat(4 - pos)}   FILL ${Math.round(this.fill * 100)}%`, 56, 440);
    this.board.tex.needsUpdate = true;
  }

  private towerTop(i: number) {
    const t = this.towers[i];
    return this.tmp.set(t.x, t.h, t.z);
  }

  trade({ trade: t, whale, epic }: TradeEvent, f: Frame) {
    const ti = this.tokens.lane(t.tokenMint);
    const pi = this.dexes.lane(t.program);
    const car = this.cars.find((c) => !c.alive);
    if (!car || ti < 0) return;
    const tw = this.towers[ti];
    const start = pi >= 0 ? this.ports[pi].pos.clone() : new THREE.Vector3((Math.random() - 0.5) * 60, 16, -32);
    // Sky lanes: three altitudes, routed along streets like Fifth Element traffic
    const alt = 12.5 + ((pi >= 0 ? pi : 1) % 3) * 1.6;
    const sx = tw.x + CELL / 2, sz = tw.z + CELL / 2;
    start.y = alt;
    car.pts = [start, new THREE.Vector3(sx, alt, start.z), new THREE.Vector3(sx, alt, sz), new THREE.Vector3(tw.x, tw.h + 0.4, tw.z)];
    car.len = [0];
    for (let k = 1; k < car.pts.length; k++) car.len.push(car.len[k - 1] + car.pts[k].distanceTo(car.pts[k - 1]));
    car.s = 0;
    car.alive = true;
    car.size = 0.3 + Math.log10(1 + t.usd) * 0.16;
    car.color.copy(whale ? new THREE.Color('#ffffff') : AMBER).multiplyScalar(0.6 + Math.log10(1 + t.usd) * 0.12);
    car.onArrive = () => {
      tw.heat = Math.min(2, tw.heat + 0.2 + Math.log10(1 + t.usd) * 0.12);
      if (whale && performance.now() - this.lastWhale > 1500 && this.whaleTags < 3) {
        this.lastWhale = performance.now();
        this.whaleTags++;
        setTimeout(() => this.whaleTags--, 5000);
        const anchor = new THREE.Vector3(tw.x, tw.h, tw.z);
        this.callouts.add(() => anchor.setY(tw.h), `<b>${esc(t.token)}</b><span>${esc(fmtUsd(t.usd))}</span><i>${esc(t.program)} · slot ${fmtInt(this.slot)}</i>`, { life: 5000, dx: 110, dy: -110, cls: 'whale' });
      }
    };
    if (epic) hero(`${t.token} ${fmtUsd(t.usd)}`);
    void f;
  }

  update(f: Frame) {
    const { t, dt, pdt } = f;
    this.towerMat.uniforms.time.value = t;

    // Towers ease to their targets
    for (let i = 0; i < this.towers.length; i++) {
      const tw = this.towers[i];
      tw.h += (tw.target - tw.h) * Math.min(1, dt * 1.5);
      tw.heat *= Math.exp(-dt * 2);
      this.m.makeScale(tw.w, tw.h, tw.w).setPosition(tw.x, tw.h / 2, tw.z);
      this.mesh.setMatrixAt(i, this.m);
      this.attr.size.setXYZ(i, tw.w, tw.h, tw.w);
      this.attr.tint.setXYZ(i, tw.tint.r, tw.tint.g, tw.tint.b);
      this.attr.lit.setX(i, tw.lit);
      this.attr.seed.setX(i, tw.seed);
      this.attr.heat.setX(i, tw.heat);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of Object.values(this.attr)) a.needsUpdate = true;

    // Cars
    let li = 0, hi = 0;
    for (const c of this.cars) {
      if (!c.alive) continue;
      c.s += pdt * CAR_SPEED;
      const total = c.len[c.len.length - 1];
      if (c.s >= total) { c.alive = false; c.onArrive?.(); continue; }
      const head = this.at(c, c.s), tail = this.at(c, Math.max(0, c.s - 1.1 - c.size));
      this.carPos.set([head.x, head.y, head.z, tail.x, tail.y, tail.z], li * 6);
      this.carCol.set([c.color.r, c.color.g, c.color.b, 0, 0, 0], li * 6);
      li++;
      this.headPos.set([head.x, head.y, head.z], hi * 3);
      this.headCol.set([c.color.r, c.color.g, c.color.b], hi * 3);
      this.headSize[hi++] = c.size;
    }
    this.carLines.geometry.setDrawRange(0, li * 2);
    this.heads.geometry.setDrawRange(0, hi);
    for (const geo of [this.carLines.geometry, this.heads.geometry]) {
      for (const k of Object.keys(geo.attributes)) (geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    }

    // Rain falls on wall-clock time: weather doesn't slow for bullet time
    for (let i = 0; i < RAIN; i++) {
      const o = i * 6;
      this.rainPos[o + 1] -= dt * 26; this.rainPos[o + 4] -= dt * 26;
      this.rainPos[o] -= dt * 2; this.rainPos[o + 3] -= dt * 2;
      if (this.rainPos[o + 1] < 0) this.dropRain(i);
    }
    (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    for (const r of this.rings) {
      r.age = Math.min(1, r.age + dt / 1.6);
      const s = 1 + r.age * 18;
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - r.age) * 0.22;
    }

    // Persistent tags on the five busiest towers, refreshed every few seconds
    const now = performance.now();
    if (now - this.tagAt > 4000) {
      this.tagAt = now;
      for (const c of this.towerTags) this.callouts.remove(c);
      const top = [...this.vol.keys()].filter((i) => this.tokens.keys[i]).sort((a, b) => this.vol[b] - this.vol[a]).slice(0, 4);
      this.towerTags = top.map((i) => {
        const tw = this.towers[i];
        const mint = this.tokens.keys[i]!;
        const anchor = new THREE.Vector3();
        return this.callouts.add(() => anchor.set(tw.x, tw.h, tw.z),
          `<b>${esc(this.names.get(mint) ?? mint.slice(0, 4))}</b><i>${esc(fmtUsd(this.vol[i] * (1 - FLOW.decay) * 270))} / min</i>` +
            (this.wash[i] / (this.vol[i] || 1) > 0.2 ? `<em>WASH ${Math.round((this.wash[i] / this.vol[i]) * 100)}%</em>` : ''),
          { life: Infinity, dx: 70, dy: -60, cls: 'tower' });
      });
    }

    const { pointer, portrait } = f;
    const a = t * 0.035;
    const r = portrait ? 50 : 36;
    this.camera.position.set(Math.cos(a) * r + pointer.x * 4, 12 + Math.sin(t * 0.07) * 2.5 - pointer.y * 3, Math.sin(a) * r);
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
    const yaw = Math.atan2(this.camera.position.x, this.camera.position.z);
    this.screen.rotation.y = yaw;
    this.screen.position.set(Math.sin(yaw) * 1.6, 15.5, Math.cos(yaw) * 1.6);
    this.callouts.update(this.camera, this.w, this.h);
  }

  private v = new THREE.Vector3();
  private at(c: Car, s: number) {
    let k = 1;
    while (k < c.len.length - 1 && c.len[k] < s) k++;
    const a = c.pts[k - 1], b = c.pts[k];
    const seg = c.len[k] - c.len[k - 1] || 1;
    return this.v.copy(a).lerp(b, Math.min(1, Math.max(0, (s - c.len[k - 1]) / seg))).clone();
  }

  resize(w: number, h: number) {
    this.w = w; this.h = h;
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 68 : 50;
    this.camera.updateProjectionMatrix();
    (this.heads.material as THREE.ShaderMaterial).uniforms.scale.value = h;
  }

  kpis(s: Stats): Kpi[] {
    return [
      { label: 'Trades / sec', value: s.tradesPerSec, fmt: (v) => v.toFixed(0), color: '#ffa24a' },
      { label: 'DEX vol / min', value: s.volPerMin, fmt: fmtUsd, color: '#ffffff' },
      { label: 'Tokens trading (10s)', value: s.liveTokens, fmt: fmtInt, color: '#cfe4ff' },
      { label: 'User TPS', value: s.tps, fmt: fmtInt, color: '#ffa24a' },
    ];
  }
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Kinetic hero word: one huge line slammed into frame, then gone */
function hero(text: string) {
  const el = document.getElementById('hero');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('slam');
  void el.offsetWidth;
  el.classList.add('slam');
}
