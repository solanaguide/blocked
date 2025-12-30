import * as THREE from 'three';

export class Environment {
  private scene: THREE.Scene;
  private grid!: THREE.GridHelper;
  private gridMaterial!: THREE.ShaderMaterial;

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

    // Point light at center (glow effect) - removed, was causing white dot artifact
    // const centerLight = new THREE.PointLight(0x8b5cf6, 2, 100);
    // centerLight.position.set(0, 0, 0);
    // this.scene.add(centerLight);
  }

  private setupGrid() {
    // 80s Elite-style bright grid
    const size = 400;
    const divisions = 80;

    // Bright cyan/green grid like classic wireframe games
    this.grid = new THREE.GridHelper(size, divisions, 0x00ffff, 0x0088ff);
    this.grid.position.y = -20;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(this.grid);

    // Add perspective grid lines going to horizon
    const horizonLines = new THREE.Group();
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.3
    });

    // Create lines radiating from center to horizon
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const points = [];
      points.push(new THREE.Vector3(0, -20, 0));
      points.push(new THREE.Vector3(
        Math.cos(angle) * 200,
        -20,
        Math.sin(angle) * 200
      ));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, lineMaterial);
      horizonLines.add(line);
    }
    this.scene.add(horizonLines);
  }

  private setupBackground() {
    // 80s Elite-style solid dark background
    this.scene.background = new THREE.Color(0x000000); // Pure black

    // Add starfield
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
    // Grid stays static - 80s style doesn't animate much
  }
}
