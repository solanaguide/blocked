import * as THREE from 'three';
import type { Block } from '../feed';
import type { Stats } from '../stats';
import type { Preset, Frame, Kpi } from './types';
import { LIMITS, fmtInt } from '../palette';
import { Callouts } from '../callouts';
import { consensus, finalityMs, consensusMs, kindShare, type Consensus } from '../consensus';

const LOW = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 900px)').matches;
const D = 2.6;                 // depth between neighbouring blocks' ranges
const Z0 = 2;                  // where the newest range stands
const HIST = LOW ? 44 : 64;    // ranges kept, receding into haze
const HALF_W = 150;            // ranges span the whole horizon
const NX = LOW ? 180 : 260;
const NZ = 9;                  // rows across one block's slice of terrain
const ANCHORS = 16;            // summits where node sparkles can land
const SPARKS = 96;

// ---------- noise (CPU, for terrain) ----------

const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const PERM = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

/** 2D simplex noise, roughly -1..1 */
function simplex(x: number, y: number) {
  const F2 = 0.3660254, G2 = 0.2113249;
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  for (const [dx, dy, gi] of [[x0, y0, PERM[ii + PERM[jj]]], [x1, y1, PERM[ii + i1 + PERM[jj + j1]]], [x2, y2, PERM[ii + 1 + PERM[jj + 1]]]]) {
    const tt = 0.5 - dx * dx - dy * dy;
    if (tt > 0) {
      const g = GRAD[gi & 7];
      n += tt * tt * tt * tt * (g[0] * dx + g[1] * dy);
    }
  }
  return 70 * n;
}

/** Ridged multifractal: sharp arêtes and summits */
function ridged(x: number, y: number) {
  let sum = 0, amp = 0.55, freq = 1, weight = 1;
  for (let o = 0; o < 5; o++) {
    let n = 1 - Math.abs(simplex(x * freq, y * freq));
    n *= n * weight;
    weight = Math.min(1, Math.max(0, n * 1.8));
    sum += n * amp;
    freq *= 2.07;
    amp *= 0.5;
  }
  return sum;
}

// ---------- shaders ----------

const NOISE_GLSL = /* glsl */ `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < ${LOW ? 2 : 3}; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }
  float fbm2(vec3 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03); }
`;

// Shared atmosphere: twilight haze, warmed toward the low sun on the left
const ATMOS_GLSL = /* glsl */ `
  uniform vec3 uSun;
  vec3 atmosphere(vec3 col, vec3 world) {
    vec3 ray = world - cameraPosition;
    float dist = length(ray);
    vec3 dir = ray / dist;
    float toSun = max(dot(dir, normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
    float haze = 1.0 - exp(-dist * 0.0062);
    vec3 hazeCol = mix(vec3(0.07, 0.05, 0.19), vec3(0.3, 0.14, 0.38), smoothstep(-5.0, 60.0, world.y + dist * 0.1));
    hazeCol += vec3(1.0, 0.4, 0.4) * pow(toSun, 5.0) * 0.45;
    // Low mist pooled in the valleys, lit pink on the sun side
    float mist = exp(-max(world.y + 0.6, 0.0) * 0.55) * 0.7;
    vec3 mistCol = mix(vec3(0.12, 0.11, 0.3), vec3(0.6, 0.28, 0.45), pow(toSun, 3.0) * 0.8);
    col = mix(col, mistCol, mist * (0.4 + 0.6 * haze));
    return mix(col, hazeCol, haze);
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
  uniform vec3 uSun;
  varying vec3 vDir;
  ${NOISE_GLSL}
  float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5); }
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 sd = normalize(vec3(uSun.x, 0.0, uSun.z));
    float toSun = max(dot(normalize(vec3(d.x, 0.0, d.z)), sd), 0.0);
    // Deep violet overhead, magenta toward the horizon, a warm glow where the sun has set
    vec3 c = mix(vec3(0.34, 0.13, 0.4), vec3(0.14, 0.05, 0.32), smoothstep(0.0, 0.16, y));
    c = mix(c, vec3(0.035, 0.02, 0.11), smoothstep(0.16, 0.7, y));
    c += vec3(1.0, 0.42, 0.35) * pow(toSun, 6.0) * (1.0 - smoothstep(0.0, 0.3, y)) * 0.7;
    c = mix(vec3(0.13, 0.1, 0.3), c, smoothstep(-0.03, 0.01, y));
    // Streaky clouds, undersides lit on the sun side
    if (y > 0.0) {
      vec3 q = vec3(d.x / (y + 0.12) * 1.4 + uTime * 0.01, d.z / (y + 0.12) * 0.35, 0.0);
      float cl = smoothstep(0.5, 0.78, fbm3(q * vec3(0.9, 3.5, 1.0) + vec3(0.0, 0.0, 7.0)));
      cl *= smoothstep(0.03, 0.09, y) * (1.0 - smoothstep(0.22, 0.5, y));
      vec3 lit = mix(vec3(0.3, 0.12, 0.38), vec3(1.0, 0.45, 0.45), pow(toSun, 2.0));
      c = mix(c, lit, cl * 0.75);
    }
    vec2 g = floor(d.xz / (y + 0.35) * 280.0);
    float star = step(0.997, h(g)) * smoothstep(0.35, 0.7, y);
    c += star * (0.6 + 0.4 * sin(uTime * 1.7 + h(g + 7.0) * 40.0)) * 0.5;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const MIST_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  ${NOISE_GLSL}
  ${ATMOS_GLSL}
  void main() {
    vec3 q = vec3(vWorld.x * 0.03 + uTime * 0.025, uTime * 0.015, vWorld.z * 0.05);
    float n = fbm2(q);
    vec3 dir = normalize(vWorld - cameraPosition);
    float toSun = max(dot(dir, normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
    float a = smoothstep(0.45, 0.8, n) * 0.4 * smoothstep(10.0, 35.0, length(vWorld - cameraPosition));
    gl_FragColor = vec4(mix(vec3(0.2, 0.18, 0.42), vec3(0.8, 0.38, 0.52), pow(toSun, 3.0)), a * 0.7);
  }
`;

// ---------- terrain material ----------

type TerrainUniforms = Record<'uH' | 'uNotar' | 'uFinal' | 'uFlare' | 'uFront', { value: number }> & { uSun: { value: THREE.Vector3 } };

const GROW_GLSL = /* glsl */ `smoothstep(uFront + 0.5, uFront - 9.0, (modelMatrix * vec4(position, 1.0)).z)`;

/**
 * Physically based snow and rock under a real, shadow-casting low sun. The
 * data never recolours the ground: it only decides whether the sunlight has
 * reached this block's slice yet (notarized: a first touch on the summits;
 * finalized: the light sweeps across and down). Skylight is always there.
 */
function terrainMaterial(u: TerrainUniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0, shadowSide: THREE.BackSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uFront;
        varying vec3 vWorldP;
        varying vec3 vWorldN;
        varying float vLocalY;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float growN = ${GROW_GLSL};
        objectNormal = normalize(vec3(objectNormal.x * growN, objectNormal.y, objectNormal.z * growN));
        vWorldN = normalize(mat3(modelMatrix) * objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocalY = position.y;
        // Terrain emerges from the ground near the viewer: no cut edge on the newest slice
        transformed.y = mix(-0.7, transformed.y, ${GROW_GLSL});
        vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uH;
        uniform float uNotar;
        uniform float uFinal;
        uniform float uFlare;
        varying vec3 vWorldP;
        varying vec3 vWorldN;
        varying float vLocalY;
        ${NOISE_GLSL}
        ${ATMOS_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 pN = vWorldP * vec3(0.5, 1.0, 0.5);
        float camDist = length(vWorldP - cameraPosition);
        bool nearDetail = camDist < 90.0;
        float f0 = nearDetail ? fbm3(pN) : fbm2(pN);
        float slope = 1.0 - normalize(vWorldN).y;
        float yn = clamp(vLocalY / uH, 0.0, 1.2);
        float snowM = smoothstep(0.44, 0.27, slope + (f0 - 0.5) * 0.3) * smoothstep(0.02, 0.14, yn);
        float strata = 0.82 + 0.18 * sin(vWorldP.y * 4.0 + f0 * 7.0);
        vec3 rockC = mix(vec3(0.05, 0.045, 0.06), vec3(0.15, 0.13, 0.15), f0) * strata;
        diffuseColor.rgb = mix(rockC, vec3(0.9, 0.92, 1.0), snowM);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.92, 0.55, snowM);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (nearDetail) {
          const float be = 0.15;
          vec2 bg = vec2(fbm2(pN + vec3(be, 0.0, 0.0)) - fbm2(pN), fbm2(pN + vec3(0.0, 0.0, be)) - fbm2(pN)) / be;
          normal = normalize(normal - (viewMatrix * vec4(bg.x, 0.0, bg.y, 0.0)).xyz * 0.35 * (1.0 - camDist / 90.0));
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // Has the sunlight reached this slice yet?
        float litN = smoothstep(0.84, 0.95, yn) * uNotar;
        float sweep = mix(-70.0, 70.0, uFinal);
        float across = clamp(smoothstep(sweep + 6.0, sweep - 6.0, vWorldP.x) + step(0.999, uFinal), 0.0, 1.0);
        float floorLine = mix(1.05, 0.18, smoothstep(0.0, 1.0, uFinal));
        float litF = across * smoothstep(floorLine - 0.08, floorLine + 0.12, yn + (f0 - 0.5) * 0.12) * step(0.001, uFinal);
        float reveal = max(litF, litN * 0.4);
        reflectedLight.directDiffuse *= reveal;
        reflectedLight.directSpecular *= reveal;
        reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.45, 0.55) * uFlare * smoothstep(0.85, 1.0, yn) * 0.25;`)
      .replace('#include <fog_fragment>', `gl_FragColor.rgb = atmosphere(gl_FragColor.rgb, vWorldP);`);
  };
  mat.customProgramCacheKey = () => 'alpenglow-terrain';
  // Shadows must see the same ground-emergence as the visible terrain
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uFront: u.uFront });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFront;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed.y = mix(-0.7, transformed.y, ${GROW_GLSL});`);
  };
  depth.customProgramCacheKey = () => 'alpenglow-terrain-depth';
  return { mat, depth };
}

// ---------- sprites ----------

function starTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.12, 'rgba(255,240,210,0.8)');
  r.addColorStop(0.4, 'rgba(255,200,140,0.18)');
  r.addColorStop(1, 'rgba(255,180,120,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---------- ranges ----------

interface Range {
  mesh: THREE.Mesh;
  u: TerrainUniforms;
  slot: number;
  h: number;
  glow: number;
  warm: number;
  flareAt: number;
  anchors: THREE.Vector3[];     // summit positions, local to the range
  sparked: Set<string>;
  called: boolean;
  skipped: boolean;
}

/** The landscape, 0..~1.2: broad massifs carved by ridged noise, continuous in world space */
function terrain(x: number, z: number) {
  const massif = 0.55 + 0.45 * (0.5 + 0.5 * simplex(x * 0.007 + 31, z * 0.007 + 57));
  return massif * Math.pow(ridged(x * 0.022, z * 0.022), 1.4) * 1.2;
}

/** Grid column → x: dense where the camera looks, sparse at the far edges */
function colX(i: number) {
  const u = (2 * i) / (NX - 1) - 1;
  return HALF_W * Math.sign(u) * Math.pow(Math.abs(u), 1.7);
}

function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Alpenglow: every block raises a mountain range, and the ranges recede into
 * the haze like Highway's chain. When our Firedancer nodes see the block
 * notarized, light lands on its summits; when they see it finalized the light
 * turns gold and pours into the valleys. Each node that sees finality makes
 * one sparkle on a summit, at the moment it saw it.
 */
export class Alpenglow implements Preset {
  readonly id = 'alpenglow';
  readonly title = 'ALPENGLOW';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  readonly bloom: [number, number, number] = [0.55, 0.7, 0.72];
  readonly crt = 0;
  maxDpr = 1;
  private ft = 16;           // smoothed frame time, ms
  private quality = 3;       // 3 full · 2 lower res · 1 no light shafts · 0 no shadows
  private qAt = 0;
  private frameN = 0;
  readonly rays = { uv: new THREE.Vector2(), strength: 0 };
  private raysPulse = 0;
  readonly feed = 'windows';
  readonly legend = `
    Each range = one block · height = compute used<br>
    pink touch on the summits = notarized<i style="background:#ff80b8"></i><br>
    alpenglow sweep = finalized<i style="background:#ff3a64"></i><br>
    glint = one node sees it final<i style="background:#ffc0d0"></i><br>
    finality = block + consensus`;

  private ranges: Range[] = [];
  private index: THREE.BufferAttribute;
  private sky: THREE.Mesh;
  private mist: THREE.Mesh;
  private sparks: { sprite: THREE.Sprite; range?: Range; at: THREE.Vector3; age: number; life: number; size: number }[] = [];
  private callouts = new Callouts();
  private calloutAt = 0;
  private playhead = 0;
  private slotMs = 200;
  private w = 1;
  private h = 1;
  private look = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private sun = new THREE.Vector3(-0.8, 0.12, -0.6).normalize();
  private prevAmp?: number;
  private sunLight = new THREE.DirectionalLight();

  constructor() {
    this.scene.background = new THREE.Color('#070a18');

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
        uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3() } },
      }),
    );
    this.scene.add(this.sky);

    // Valley floor, hazed like the ranges so the horizon has no seam
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        ${ATMOS_GLSL}
        void main() { gl_FragColor = vec4(atmosphere(vec3(0.07, 0.07, 0.18), vWorld), 1.0); }`,
      uniforms: { uSun: { value: this.sun } },
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.6;
    this.scene.add(floor);

    // Shared grid topology for every range
    const idx: number[] = [];
    for (let j = 0; j < NZ - 1; j++) {
      for (let i = 0; i < NX - 1; i++) {
        const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.index = new THREE.BufferAttribute(new Uint32Array(idx), 1);

    for (let k = 0; k < HIST; k++) {
      const g = new THREE.BufferGeometry();
      g.setIndex(this.index);
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NX * NZ * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(NX * NZ * 3), 3));
      const u: TerrainUniforms = { uH: { value: 1 }, uNotar: { value: 0 }, uFinal: { value: 0 }, uFlare: { value: 0 }, uFront: { value: Z0 }, uSun: { value: this.sun } };
      const { mat, depth } = terrainMaterial(u);
      const mesh = new THREE.Mesh(g, mat);
      mesh.customDepthMaterial = depth;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.scene.add(mesh);
      this.ranges.push({ mesh, u, slot: -1, h: 1, glow: 0, warm: 0, flareAt: -1e9, anchors: [], sparked: new Set(), called: false, skipped: false });
    }

    const sky = new THREE.HemisphereLight('#6a6ad8', '#140e2a', 0.5);
    this.scene.add(sky);
    this.sunLight.color.set('#ff5a74');
    this.sunLight.intensity = 9;
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.setScalar(LOW ? 1024 : 2048);
    this.sunLight.shadow.autoUpdate = false;
    const sc = this.sunLight.shadow.camera;
    sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.near = 10; sc.far = 900;
    this.sunLight.shadow.bias = -0.0015;
    this.sunLight.shadow.normalBias = 1.4;
    this.sunLight.target.position.set(0, 0, -80);
    this.sunLight.position.copy(this.sunLight.target.position).addScaledVector(this.sun, 400);
    this.scene.add(this.sunLight, this.sunLight.target);

    // Far massifs beyond the last block: scenery, so the horizon is always mountains
    this.scene.add(this.backdrop());

    this.mist = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 260),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        vertexShader: /* glsl */ `varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: MIST_FRAG,
        uniforms: { uTime: { value: 0 }, uSun: { value: this.sun } },
      }),
    );
    this.mist.rotation.x = -Math.PI / 2;
    this.mist.position.set(0, 1.1, -110);
    this.scene.add(this.mist);

    const tex = starTexture();
    for (let i = 0; i < SPARKS; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      sprite.renderOrder = 5;
      this.scene.add(sprite);
      this.sparks.push({ sprite, at: new THREE.Vector3(), age: 1, life: 1, size: 1 });
    }
  }

  private backdrop() {
    const NXB = 700, NZB = 30, X = 700, Z0B = -210, Z1B = -520;
    const pos = new Float32Array(NXB * NZB * 3);
    for (let j = 0; j < NZB; j++) {
      const z = Z0B + ((Z1B - Z0B) * j) / (NZB - 1);
      const rise = Math.min(1, j / 6);
      for (let i = 0; i < NXB; i++) {
        const x = -X + (2 * X * i) / (NXB - 1);
        const k = (j * NXB + i) * 3;
        pos[k] = x;
        pos[k + 1] = rise * (8 + 42 * terrain(x * 0.22 + 900, z * 0.22)) - 1;
        pos[k + 2] = z;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < NZB - 1; j++) for (let i = 0; i < NXB - 1; i++) {
      const a = j * NXB + i;
      idx.push(a, a + NXB, a + 1, a + 1, a + NXB, a + NXB + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Always sunlit: the far range holds the glow
    const { mat } = terrainMaterial({ uH: { value: 55 }, uNotar: { value: 1 }, uFinal: { value: 1 }, uFlare: { value: 0 }, uFront: { value: Z0 }, uSun: { value: this.sun } });
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    return m;
  }

  activate() {
    this.callouts.visible = true;
    const f = finalityMs();
    if (f) setTimeout(() => hero(`FINAL IN ${f.toFixed(0)}ms`), 900);
  }

  deactivate() {
    this.callouts.visible = false;
    this.callouts.clear();
  }

  enter(slot: number, block: Block | undefined) {
    // Recycle the oldest slice. A skipped slot still gets one: a low, unlit saddle
    const r = this.ranges.reduce((a, b) => (a.slot < b.slot ? a : b));
    const amp = block ? 7 + 14 * Math.min(1, block.cu / LIMITS.cu) : 2;
    this.build(r, slot, this.prevAmp ?? amp, amp, !block);
    this.prevAmp = amp;
  }

  /**
   * One block's slice of a continuous landscape: from the previous block's
   * ridge line to its own. The noise lives in world space, so slices join
   * seamlessly; height eases between the two blocks' compute.
   */
  private build(r: Range, slot: number, ampPrev: number, amp: number, skipped: boolean) {
    const zBase = (slot % 1_000_000) * D;
    const height = (x: number, zl: number) => {
      const t = (zl + D) / D;
      const a = ampPrev + (amp - ampPrev) * t * t * (3 - 2 * t);
      return a * terrain(x, zBase + zl) - 0.4;
    };
    const pos = r.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = r.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const P = pos.array as Float32Array, Nn = nor.array as Float32Array;
    const best = new Float32Array(NX).fill(-1e9), bestZ = new Float32Array(NX);
    const e = 0.2;
    for (let j = 0; j < NZ; j++) {
      const zl = -D + (D * j) / (NZ - 1);
      for (let i = 0; i < NX; i++) {
        const x = colX(i);
        const y = height(x, zl);
        const k = (j * NX + i) * 3;
        P[k] = x; P[k + 1] = y; P[k + 2] = zl;
        // Normals from the height function itself, so neighbouring slices light without seams
        const dx = (height(x + e, zl) - height(x - e, zl)) / (2 * e);
        const dz = (height(x, zl + e) - height(x, zl - e)) / (2 * e);
        const inv = 1 / Math.hypot(dx, 1, dz);
        Nn[k] = -dx * inv; Nn[k + 1] = inv; Nn[k + 2] = -dz * inv;
        if (y > best[i]) { best[i] = y; bestZ[i] = zl; }
      }
    }
    pos.needsUpdate = nor.needsUpdate = true;
    // Summits for node glints: local maxima of this slice's skyline, near the centre of view
    const peaks: number[] = [];
    for (let i = 2; i < NX - 2; i++) {
      if (Math.abs(colX(i)) < 30 && best[i] >= best[i - 1] && best[i] >= best[i + 1] && best[i] >= best[i - 2] && best[i] >= best[i + 2]) peaks.push(i);
    }
    peaks.sort((a, b) => best[b] - best[a]);
    r.anchors = peaks.slice(0, ANCHORS).map((i) => new THREE.Vector3(colX(i), best[i], bestZ[i]));
    r.slot = slot;
    r.skipped = skipped;
    r.h = Math.max(amp, ampPrev) * 1.15;
    r.glow = 0;
    r.warm = 0;
    r.flareAt = -1e9;
    r.sparked = new Set();
    r.called = false;
    r.u.uH.value = r.h;
  }

  trade() { /* this view is about consensus, not markets */ }

  private z(slot: number) {
    return Z0 - (this.playhead - slot) * D;
  }

  update(f: Frame) {
    this.playhead = f.playhead;
    // Terrain scrolls slowly enough that shadows can refresh every other frame
    if (++this.frameN % 2 === 0 && this.quality > 0) this.sunLight.shadow.needsUpdate = true;
    this.govern(f.dt);
    if (f.timeline.slotsPerSec > 0) this.slotMs = 1000 / f.timeline.slotsPerSec;
    const now = performance.now();
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = f.t;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uSun.value.copy(this.sun);
    (this.mist.material as THREE.ShaderMaterial).uniforms.uTime.value = f.t;

    for (const r of this.ranges) {
      const age = f.playhead - r.slot;
      if (r.slot < 0 || age < 0 || age > HIST + 1) { r.mesh.visible = false; continue; }
      r.mesh.visible = true;
      r.mesh.position.set(0, 0, this.z(r.slot));

      // The block completes at the end of its slot; stages are timed from there
      const since = (age - 1) * this.slotMs;
      const c = r.skipped ? undefined : consensus(r.slot);
      // Stage moments are real; how the light then travels is the scene's own pacing
      // Driven by playback time, so slow frames don't slow the light
      r.glow = c?.notarized !== undefined ? clamp01((since - c.notarized) / 350) : 0;
      r.warm = c?.finalized !== undefined ? clamp01((since - c.finalized) / 750) : 0;
      if (r.warm > 0 && r.flareAt < 0) { r.flareAt = now; this.raysPulse = Math.min(1, this.raysPulse + 0.5); }
      if (c) this.sparkle(r, c, since);
      r.u.uNotar.value = r.glow;
      r.u.uFinal.value = r.warm;
      r.u.uFlare.value = r.flareAt > 0 ? Math.exp(-(now - r.flareAt) / 700) : 0;
      if (c?.finalized !== undefined && r.flareAt > 0 && !r.called) this.callout(r, c, now);
    }

    for (const s of this.sparks) {
      if (s.age >= 1 || !s.range) { s.sprite.material.opacity = 0; continue; }
      s.age = Math.min(1, s.age + f.dt / s.life);
      const k = s.age < 0.12 ? s.age / 0.12 : 1 - (s.age - 0.12) / 0.88;
      const m = s.range.mesh.position;
      s.sprite.position.set(s.at.x + m.x, s.at.y + m.y + 0.45, s.at.z + m.z);
      s.sprite.scale.setScalar(s.size * (0.6 + 0.6 * Math.sqrt(s.age)));
      s.sprite.material.opacity = k * k;
    }

    const { t, pointer, portrait } = f;
    this.camera.position.set(Math.sin(t * 0.03) * 3 + pointer.x * 4, (portrait ? 9.5 : 8) - pointer.y * 1.2, portrait ? 28 : 22);
    this.look.set(Math.sin(t * 0.03) * 1.5, 5, -60);
    this.camera.lookAt(this.look);
    this.callouts.visible = !portrait;
    this.callouts.update(this.camera, this.w, this.h);

    // Light shafts from the low sun, swelling briefly each time a block finalizes
    this.tmp.copy(this.camera.position).addScaledVector(this.sun, 1000).project(this.camera);
    this.rays.uv.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5);
    this.raysPulse *= Math.exp(-f.dt / 0.5);
    this.rays.strength = this.tmp.z < 1 && this.quality > 1 ? 0.45 + this.raysPulse * 0.5 : 0;
  }

  /**
   * Keep the scene smooth on modest GPUs: if frames run long for a couple of
   * seconds, step quality down (resolution, then light shafts, then shadows).
   */
  private govern(dt: number) {
    this.ft += (dt * 1000 - this.ft) * 0.05;
    const now = performance.now();
    if (now - this.qAt < 2500 || this.quality === 0 || this.ft < 22) return;
    this.qAt = now;
    this.quality--;
    if (this.quality === 2) this.maxDpr = 0.75;
    if (this.quality === 1) this.rays.strength = 0;
    if (this.quality === 0) { this.sunLight.castShadow = false; this.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = false; }); }
    this.onQuality?.();
  }

  /** Engine hook so a lower pixel ratio takes effect */
  onQuality?: () => void;

  /** One sparkle per node, on its own summit, when that node saw the stage */
  private sparkle(r: Range, c: Consensus, since: number) {
    c.nodes.forEach((n, i) => {
      const a = r.anchors[i % Math.max(1, r.anchors.length)];
      if (!a) return;
      for (const [stage, ms, color, size] of [['f', n.f, '#ffd0e0', 0.9]] as const) {
        const key = stage + n.city;
        if (ms === undefined || since < ms || r.sparked.has(key)) continue;
        r.sparked.add(key);
        if (since - ms > 400) continue;   // too late to be meaningful (e.g. switched in mid-flight)
        const s = this.sparks.find((x) => x.age >= 1);
        if (!s) return;
        s.range = r;
        s.at.copy(a);
        s.age = 0;
        s.life = stage === 'f' ? 1.1 : 0.7;
        s.size = size;
        s.sprite.material.color.set(color);
      }
    });
  }

  private callout(r: Range, c: Consensus, now: number) {
    r.called = true;
    if (now - this.calloutAt < 3200 || !r.anchors.length || c.finalized === undefined) return;
    this.calloutAt = now;
    const a = r.anchors[0].clone();
    const slot = r.slot;
    const nodes = c.nodes.filter((x) => x.f !== undefined).length;
    const notar = c.notarized !== undefined ? `notarized +${c.notarized.toFixed(0)}ms · ` : '';
    this.callouts.add(() => {
      if (r.slot !== slot || this.z(slot) < -60) return null;
      return this.tmp.copy(a).add(r.mesh.position);
    }, `<b>SLOT ${fmtInt(slot)}</b><span>FINAL IN ${((c.dur ?? 0) + c.finalized).toFixed(0)}ms</span><i>block ${c.dur?.toFixed(0) ?? '—'}ms · ${notar}final +${c.finalized.toFixed(0)}ms · ${nodes} node${nodes === 1 ? '' : 's'}</i>`,
    { life: 3000, dx: 70, dy: -80, cls: 'alp', side: 1 });
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 64 : 42;
    this.camera.updateProjectionMatrix();
  }

  kpis(s: Stats): Kpi[] {
    return [
      { label: 'Finality', value: finalityMs(), fmt: (v) => (v ? v.toFixed(0) + 'ms' : '—'), color: '#ffc08a' },
      { label: 'Consensus after block', value: consensusMs(), fmt: (v) => (v ? v.toFixed(0) + 'ms' : '—'), color: '#ffd2c2' },
      { label: 'Fast-finalized', value: kindShare('fast') * 100, fmt: (v) => (v ? v.toFixed(0) + '%' : '—'), color: '#ff9ab4' },
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
