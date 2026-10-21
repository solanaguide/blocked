import * as THREE from 'three';
import { C, PITCH, FOG_GLSL, fogUniforms } from '../palette';

/** Gradient sky, striped synthwave sun, stars and the scrolling floor grid. */
export class Sky {
  readonly group = new THREE.Group();
  private sunMat: THREE.ShaderMaterial;
  private gridMat: THREE.ShaderMaterial;
  private pulse = 0;

  constructor() {
    // Sky dome
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: C.bg }, horizon: { value: C.horizon }, glow: { value: new THREE.Color('#ff2b8a') } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(horizon, top, smoothstep(0.0, 0.45, h));
          c += glow * 0.18 * exp(-abs(h) * 18.0) * smoothstep(0.9, 0.2, abs(vDir.x));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
    this.group.add(sky);

    // Stars
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI - Math.PI;
      const ph = 0.04 + Math.random() * 1.3;
      const r = 800;
      pos[i * 3] = r * Math.cos(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph);
      pos[i * 3 + 2] = r * Math.cos(ph) * Math.sin(th);
    }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)),
      new THREE.PointsMaterial({ color: 0xb9a6ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.group.add(stars);

    // Sun
    this.sunMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { time: { value: 0 }, pulse: { value: 0 }, progress: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float time; uniform float pulse; uniform float progress; varying vec2 vUv;
        void main(){
          // An eclipse rather than a sunset: dark disc, living corona, and a ring
          // that fills clockwise with epoch progress
          vec2 p = (vUv * 2.0 - 1.0) * 1.7;
          float r = length(p);
          float a = atan(p.x, p.y) / 6.2831853;
          a = a < 0.0 ? a + 1.0 : a;
          float disc = smoothstep(1.0, 0.99, r);
          float streak = 0.75 + 0.25 * sin(a * 6.2831853 * 9.0 + time * 0.25) * sin(a * 6.2831853 * 4.0 - time * 0.17);
          float corona = exp(-max(r - 1.0, 0.0) * (5.5 - pulse * 2.0)) * (1.0 - disc) * streak;
          vec3 cc = mix(vec3(1.0, 0.75, 0.3), vec3(1.0, 0.12, 0.55), smoothstep(1.0, 1.5, r));
          vec3 col = cc * corona * (0.55 + pulse * 0.5);
          col += vec3(1.0, 0.85, 0.6) * exp(-abs(r - 1.0) * 120.0) * 0.9;   // diamond rim
          col += vec3(0.03, 0.0, 0.05) * disc;
          // epoch ring
          float ring = exp(-abs(r - 1.32) * 220.0);
          float done = step(a, progress);
          float ticks = step(0.985, fract(a * 10.0)) * exp(-abs(r - 1.32) * 60.0);
          col += ring * mix(vec3(0.35, 0.25, 0.8) * 0.35, vec3(1.0, 0.8, 0.3) * 1.2, done) + ticks * vec3(0.5, 0.4, 1.0) * 0.4;
          float head = exp(-length(p - 1.32 * vec2(sin(progress * 6.2831853), cos(progress * 6.2831853))) * 40.0);
          col += vec3(1.0, 0.9, 0.6) * head * 1.5;
          float alpha = clamp(disc + corona + ring + head, 0.0, 1.0);
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(380, 380), this.sunMat);
    sun.position.set(0, 88, -620);
    this.group.add(sun);

    // Floor grid, scrolls with the chain so the ground reads as moving time
    this.gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { offset: { value: 0 }, color: { value: C.grid }, ...fogUniforms() },
      vertexShader: `varying vec3 vW; varying float vDepth;
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        ${FOG_GLSL}
        uniform float offset; uniform vec3 color; varying vec3 vW; varying float vDepth;
        float line(float v, float w){ float d = abs(fract(v - 0.5) - 0.5) / fwidth(v); return 1.0 - min(d / w, 1.0); }
        void main(){
          float gx = line(vW.x / 2.0, 0.8);
          float gz = line((vW.z - offset) / ${(PITCH * 4).toFixed(2)}, 0.8);
          float g = max(gx, gz);
          float fade = exp(-vDepth * 0.012);
          vec3 c = color * g * (0.12 + 0.3 * fade);
          c = applyFog(c, vDepth * 0.7);
          gl_FragColor = vec4(c, g * 0.8);
        }`,
    });
    this.gridMat.extensions.derivatives = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), this.gridMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    this.group.add(floor);
  }

  /** volumePulse is a 0..1 heartbeat from recent swap volume */
  update(t: number, playhead: number, volumePulse: number, epochProgress: number) {
    this.sunMat.uniforms.progress.value = epochProgress;
    this.pulse += (volumePulse - this.pulse) * 0.08;
    this.sunMat.uniforms.time.value = t;
    this.sunMat.uniforms.pulse.value = this.pulse;
    this.gridMat.uniforms.offset.value = -(playhead * PITCH) % (PITCH * 4);
  }
}
