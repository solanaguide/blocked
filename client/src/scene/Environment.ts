import * as THREE from 'three';

export class Environment {
  private scene: THREE.Scene;
  private grid: THREE.GridHelper;
  private gridMaterial: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.setupLights();
    this.setupGrid();
    this.setupBackground();
  }

  private setupLights() {
    // Ambient light
    const ambient = new THREE.AmbientLight(0x8b5cf6, 0.3);
    this.scene.add(ambient);

    // Main directional light (purple)
    const light1 = new THREE.DirectionalLight(0x8b5cf6, 1.5);
    light1.position.set(50, 100, 50);
    this.scene.add(light1);

    // Accent light (cyan)
    const light2 = new THREE.DirectionalLight(0x06ffa5, 1.0);
    light2.position.set(-50, 50, -50);
    this.scene.add(light2);

    // Pink accent
    const light3 = new THREE.DirectionalLight(0xff006e, 0.8);
    light3.position.set(0, 50, -50);
    this.scene.add(light3);

    // Point light at center (glow effect)
    const centerLight = new THREE.PointLight(0x8b5cf6, 2, 100);
    centerLight.position.set(0, 0, 0);
    this.scene.add(centerLight);
  }

  private setupGrid() {
    // Create infinite grid with vaporwave colors
    const size = 200;
    const divisions = 40;

    // Custom grid shader for animated vaporwave effect
    this.gridMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color1: { value: new THREE.Color(0xff006e) }, // Pink
        color2: { value: new THREE.Color(0x8b5cf6) }, // Purple
        color3: { value: new THREE.Color(0x06ffa5) }, // Cyan
      },
      vertexShader: `
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        varying vec3 vPosition;

        void main() {
          float dist = length(vPosition.xz) / 100.0;
          float pulse = sin(dist * 10.0 - time * 2.0) * 0.5 + 0.5;

          vec3 color = mix(color1, color2, pulse);
          color = mix(color, color3, sin(time + vPosition.x * 0.1) * 0.5 + 0.5);

          float alpha = max(0.0, 1.0 - dist * 0.5);
          gl_FragColor = vec4(color, alpha * 0.3);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });

    // Standard grid helper for structure
    this.grid = new THREE.GridHelper(size, divisions, 0xff006e, 0x8b5cf6);
    this.grid.position.y = -20;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.3;
    this.scene.add(this.grid);

    // Add animated plane underneath
    const planeGeometry = new THREE.PlaneGeometry(size, size);
    const plane = new THREE.Mesh(planeGeometry, this.gridMaterial);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -20.1;
    this.scene.add(plane);
  }

  private setupBackground() {
    // Vaporwave gradient background
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#0a0015');    // Dark purple
    gradient.addColorStop(0.3, '#1a0033');  // Purple
    gradient.addColorStop(0.6, '#2d1b4e');  // Mid purple
    gradient.addColorStop(1, '#0a0015');    // Back to dark

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 2, 256);

    const texture = new THREE.CanvasTexture(canvas);
    this.scene.background = texture;

    // Add stars
    this.addStars();
  }

  private addStars() {
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 1000;
    const positions = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 400;
      positions[i * 3 + 1] = Math.random() * 200 - 50;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 400;
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.5,
      transparent: true,
      opacity: 0.6,
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(stars);
  }

  update(time: number) {
    // Update grid animation
    if (this.gridMaterial) {
      this.gridMaterial.uniforms.time.value = time * 0.001;
    }

    // Rotate grid slowly
    if (this.grid) {
      this.grid.rotation.y = time * 0.0001;
    }
  }
}
