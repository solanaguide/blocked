import * as THREE from 'three';

/**
 * Crisp DOM labels tied to 3D points by thin leader lines, in the style of
 * annotated motion graphics: a small bracketed box offset from its anchor.
 */
interface Callout {
  el: HTMLDivElement;
  line: SVGPolylineElement;
  anchor: () => THREE.Vector3 | null;
  dx: number;
  dy: number;
  born: number;
  life: number;      // ms; Infinity for persistent
  side?: number;     // force labels left (-1) or right (1) of their anchor
}

export class Callouts {
  private root = document.getElementById('overlay')!;
  private svg = this.root.querySelector('svg')!;
  private items: Callout[] = [];
  private v = new THREE.Vector3();

  add(anchor: () => THREE.Vector3 | null, html: string, opts: { life?: number; dx?: number; dy?: number; cls?: string; side?: number } = {}) {
    const el = document.createElement('div');
    el.className = 'callout ' + (opts.cls ?? '');
    el.innerHTML = html;
    this.root.appendChild(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    this.svg.appendChild(line);
    const c: Callout = { el, line, anchor, dx: opts.dx ?? 60, dy: opts.dy ?? -50, born: performance.now(), life: opts.life ?? 5000, side: opts.side };
    this.items.push(c);
    return c;
  }

  remove(c: Callout) {
    c.el.remove();
    c.line.remove();
    this.items = this.items.filter((x) => x !== c);
  }

  clear() {
    for (const c of [...this.items]) this.remove(c);
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  update(camera: THREE.Camera, w: number, h: number) {
    const now = performance.now();
    for (const c of [...this.items]) {
      const age = (now - c.born) / c.life;
      if (age >= 1) { this.remove(c); continue; }
      const p = c.anchor();
      if (!p) { c.el.style.opacity = '0'; c.line.setAttribute('points', ''); continue; }
      this.v.copy(p).project(camera);
      const behind = this.v.z > 1;
      const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h;
      // Labels lean away from the screen centre so they don't pile onto the subject
      const dx = (c.side ?? (x < w / 2 ? -1 : 1)) * Math.abs(c.dx);
      const lx = x + dx, ly = y + c.dy;
      const fade = Number.isFinite(c.life) ? Math.min(1, age * 12) * (1 - Math.pow(age, 4)) : 1;
      const alpha = behind || x < -50 || x > w + 50 || y < -50 || y > h + 50 ? 0 : fade;
      c.el.style.opacity = String(alpha);
      c.el.style.transform = `translate(${dx < 0 ? lx - c.el.offsetWidth : lx}px, ${ly - c.el.offsetHeight / 2}px)`;
      c.line.setAttribute('points', alpha ? `${x},${y} ${x + dx * 0.35},${ly} ${lx},${ly}` : '');
      c.line.style.opacity = String(alpha);
    }
  }
}
