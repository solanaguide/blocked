import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Light CRT finish: chromatic fringing toward the edges, scanlines, vignette, grain
const CRT = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2() }, glitch: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform vec2 res; uniform float glitch; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      // occasional horizontal tear on glitch
      float band = step(0.985, rnd(vec2(floor(uv.y * 40.0), floor(time * 20.0))));
      uv.x += glitch * band * (rnd(vec2(time, uv.y)) - 0.5) * 0.06;
      vec2 c = uv - 0.5;
      float ca = 0.0004 + dot(c, c) * 0.0022 + glitch * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca * 4.0).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca * 4.0).b;
      float scan = 0.94 + 0.06 * sin(vUv.y * res.y * 1.5);
      col *= scan;
      col *= 1.0 - smoothstep(0.35, 0.95, length(c * vec2(1.0, 1.15)));
      col += (rnd(vUv * res + time) - 0.5) * 0.025;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  readonly composer: EffectComposer;
  private pass: RenderPass;
  private bloom: UnrealBloomPass;
  private crt: ShaderPass;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.pass = new RenderPass(scene, camera);
    this.composer.addPass(this.pass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 0.42);
    this.composer.addPass(this.bloom);
    this.crt = new ShaderPass(CRT);
    this.composer.addPass(this.crt);
    this.composer.addPass(new OutputPass());
  }

  use(scene: THREE.Scene, camera: THREE.Camera, bloom: [number, number, number]) {
    this.pass.scene = scene;
    this.pass.camera = camera;
    [this.bloom.strength, this.bloom.radius, this.bloom.threshold] = bloom;
  }

  resize(w: number, h: number) {
    this.composer.setSize(w, h);
    // Bloom at half resolution: big perf win, softer glow
    this.bloom.resolution.set(w / 2, h / 2);
    this.crt.uniforms.res.value.set(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
  }

  render(t: number, glitch: number) {
    this.crt.uniforms.time.value = t;
    this.crt.uniforms.glitch.value = glitch;
    this.composer.render();
  }
}
