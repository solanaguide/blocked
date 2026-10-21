import * as THREE from 'three';
import { FOG_GLSL, fogUniforms } from '../palette';

// Dark faces with bright edges. Size is per instance so edge width stays
// constant in world units however a box is stretched.
const vert = /* glsl */ `
  attribute vec3 iColor;
  attribute vec3 iSize;
  attribute float iHeat;
  varying vec3 vLocal; varying vec3 vSize; varying vec3 vColor; varying float vHeat; varying float vDepth;
  void main(){
    vLocal = position * iSize; vSize = iSize; vColor = iColor; vHeat = iHeat;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const frag = /* glsl */ `
  ${FOG_GLSL}
  uniform float edgeWidth; uniform float fillLevel; uniform float scanLines;
  varying vec3 vLocal; varying vec3 vSize; varying vec3 vColor; varying float vHeat; varying float vDepth;
  void main(){
    vec3 d = vSize * 0.5 - abs(vLocal);
    // median of the three = distance to the nearest edge on this face
    float b = max(min(d.x, d.y), min(max(d.x, d.y), d.z));
    float edge = 1.0 - smoothstep(0.0, edgeWidth, b);
    float scan = 0.5 + 0.5 * sin(vLocal.y * scanLines);
    vec3 col = vColor * (fillLevel + 0.12 * vHeat + 0.03 * scan) + vColor * edge * (0.55 + 0.9 * vHeat);
    gl_FragColor = vec4(applyFog(col, vDepth), 1.0);
  }`;

export class NeonBoxes {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  private color: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private heat: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private n = 0;

  constructor(max: number, opts: { edge?: number; fill?: number; fog?: number } = {}) {
    const fog = fogUniforms();
    if (opts.fog !== undefined) fog.fogDensity.value = opts.fog;
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...fog, edgeWidth: { value: opts.edge ?? 0.045 }, fillLevel: { value: opts.fill ?? 0.05 }, scanLines: { value: 40 } },
      vertexShader: vert,
      fragmentShader: frag,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.material, max);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.heat = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.color, this.size, this.heat]) a.setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry.setAttribute('iColor', this.color);
    this.mesh.geometry.setAttribute('iSize', this.size);
    this.mesh.geometry.setAttribute('iHeat', this.heat);
    this.mesh.frustumCulled = false;
  }

  begin() {
    this.n = 0;
  }

  /** Axis-aligned box centred at (x, y, z), optionally rotated about Y */
  put(x: number, y: number, z: number, w: number, h: number, l: number, col: THREE.Color, heat: number, rotY = 0) {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.q.setFromAxisAngle(this.up, rotY);
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(w, h, l));
    this.mesh.setMatrixAt(this.n, this.m);
    this.size.setXYZ(this.n, w, h, l);
    this.color.setXYZ(this.n, col.r, col.g, col.b);
    this.heat.setX(this.n, heat);
    this.n++;
  }

  commit() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.color.needsUpdate = this.size.needsUpdate = this.heat.needsUpdate = true;
  }
}
