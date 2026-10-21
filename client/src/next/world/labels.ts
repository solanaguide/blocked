import * as THREE from 'three';
import { PITCH } from '../palette';

export const FONT = '"Share Tech Mono", ui-monospace, monospace';
export const DISPLAY = 'Orbitron, "Share Tech Mono", sans-serif';

/** A sprite whose canvas can be redrawn; world height fixed, width follows text. */
export class TextSprite {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private tex: THREE.CanvasTexture;
  private text = '';

  constructor(private height: number, private px = 64, private style: { glow?: number; plate?: boolean } = {}) {
    this.canvas.height = px * 2;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false, fog: false }));
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 10;
  }

  set(lines: { text: string; color: string; font?: string; scale?: number }[]) {
    const key = JSON.stringify(lines);
    if (key === this.text) return;
    this.text = key;
    const { ctx, px } = this;
    let w = 0;
    for (const l of lines) {
      ctx.font = `${Math.round(px * (l.scale ?? 1))}px ${l.font ?? FONT}`;
      w = Math.max(w, ctx.measureText(l.text).width);
    }
    const lineH = px * 1.05;
    this.canvas.width = Math.ceil(w + px * 0.8);
    this.canvas.height = Math.ceil(lineH * lines.length + px * 0.4);
    ctx.textBaseline = 'top';
    if (this.style.plate) {
      ctx.fillStyle = 'rgba(6, 1, 15, 0.78)';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    lines.forEach((l, i) => {
      ctx.font = `${Math.round(px * (l.scale ?? 1))}px ${l.font ?? FONT}`;
      ctx.shadowColor = l.color;
      ctx.shadowBlur = px * (this.style.glow ?? 0.15);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, px * 0.4, px * 0.2 + i * lineH);
    });
    this.tex.dispose();
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    (this.sprite.material as THREE.SpriteMaterial).map = this.tex;
    (this.sprite.material as THREE.SpriteMaterial).needsUpdate = true;
    const h = this.height * (this.canvas.height / (px * 1.45));
    this.sprite.scale.set(h * (this.canvas.width / this.canvas.height), h, 1);
  }

  set opacity(v: number) {
    (this.sprite.material as THREE.SpriteMaterial).opacity = v;
    this.sprite.visible = v > 0.01;
  }
}

interface Anchored {
  label: TextSprite;
  slot: number;
  x: number;
  y: number;
  born: number;
  life: number;
  active: boolean;
}

/** Labels pinned to a slot that ride back along the chain and fade. */
export class SlotLabels {
  readonly group = new THREE.Group();
  private pool: Anchored[] = [];

  constructor(n: number, height: number) {
    for (let i = 0; i < n; i++) {
      const label = new TextSprite(height);
      label.opacity = 0;
      this.group.add(label.sprite);
      this.pool.push({ label, slot: 0, x: 0, y: 0, born: 0, life: 0, active: false });
    }
  }

  add(slot: number, x: number, y: number, lines: Parameters<TextSprite['set']>[0], now: number, life: number) {
    const a = this.pool.find((p) => !p.active) ?? this.pool.reduce((o, p) => (p.born < o.born ? p : o));
    a.label.set(lines);
    Object.assign(a, { slot, x, y, born: now, life, active: true });
  }

  update(now: number, playhead: number) {
    for (const a of this.pool) {
      if (!a.active) continue;
      const age = (now - a.born) / a.life;
      if (age >= 1) { a.active = false; a.label.opacity = 0; continue; }
      a.label.sprite.position.set(a.x, a.y + Math.min(1, age * 8) * 0.4, (a.slot + 0.5 - playhead) * PITCH);
      a.label.opacity = Math.min(1, age * 10) * (1 - Math.pow(age, 3));
    }
  }
}
