import * as THREE from 'three';
import type { Block } from '../feed';
import { C, PITCH, HISTORY, LIMITS, SLAB_W, SLAB_H } from '../palette';
import { NeonBoxes } from './neonboxes';

const LAYERS = 4;              // ok CU, failed CU, vote CU, jito tip cap
const MAX = HISTORY * LAYERS;

interface Slot {
  slot: number;
  block?: Block;
  heat: number;     // impact glow, decays
}

export class Chain {
  readonly group = new THREE.Group();
  private boxes = new NeonBoxes(MAX);
  private slots: Slot[] = [];
  private gates: THREE.InstancedMesh;
  private gateSlots: number[] = [];
  private m = new THREE.Matrix4();

  constructor() {
    this.group.add(this.boxes.mesh);

    // Leader-change gates: a thin neon arch over the chain
    const gateGeo = new THREE.BufferGeometry();
    const w = SLAB_W / 2 + 0.35, h = SLAB_H * 0.62, t = 0.03;
    const parts = [
      new THREE.BoxGeometry(t, h, t).translate(-w, h / 2, 0),
      new THREE.BoxGeometry(t, h, t).translate(w, h / 2, 0),
      new THREE.BoxGeometry(w * 2 + t, t, t).translate(0, h, 0),
    ];
    const merged = mergeBoxes(parts);
    gateGeo.copy(merged);
    this.gates = new THREE.InstancedMesh(
      gateGeo,
      new THREE.MeshBasicMaterial({ color: C.magenta.clone().multiplyScalar(0.45), fog: true }),
      64,
    );
    this.gates.frustumCulled = false;
    this.group.add(this.gates);
  }

  enter(slot: number, block: Block | undefined, prev: Block | undefined) {
    this.slots.unshift({ slot, block, heat: 1 });
    if (this.slots.length > HISTORY) this.slots.pop();
    if (block && prev && block.leader !== prev.leader) {
      this.gateSlots.unshift(slot);
      if (this.gateSlots.length > 64) this.gateSlots.pop();
    }
  }

  /** Called when a trade lands on the head block */
  impact(usd: number) {
    const s = this.slots[0];
    if (s) s.heat = Math.min(2.5, s.heat + 0.15 + Math.log10(1 + usd) * 0.12);
  }

  /** Height of the head slab top in world units, for trades to aim at */
  headTop(frac: number) {
    const b = this.slots[0]?.block;
    return b ? Math.max(0.3, (b.cu / LIMITS.cu) * SLAB_H * fill(frac)) : 0.3;
  }

  update(dt: number, playhead: number) {
    const frac = playhead - Math.floor(playhead);
    const bx = this.boxes;
    bx.begin();
    for (let k = 0; k < this.slots.length; k++) {
      const s = this.slots[k];
      s.heat += (0 - s.heat) * Math.min(1, dt * (k === 0 ? 1.2 : 2.5));
      const z = (s.slot + 0.5 - playhead) * PITCH;
      const len = PITCH * 0.78;
      const age = k === 0 ? fill(frac) : 1;
      const heat = s.heat + (k === 0 ? 0.6 : 0);
      if (!s.block) {
        // Skipped slot: a low red ghost on the road
        bx.put(0, 0.04, z, SLAB_W, 0.08, len, C.hot, 0.4);
        continue;
      }
      const b = s.block;
      const scale = (SLAB_H / LIMITS.cu) * age;
      let y = 0;
      const ok = b.okCu * scale, bad = b.failedCu * scale, vote = b.voteCu * scale;
      if (ok > 0.001) { bx.put(0, y + ok / 2, z, SLAB_W, ok, len, C.cyan, heat); y += ok; }
      if (bad > 0.001) { bx.put(0, y + bad / 2, z, SLAB_W, bad, len, C.hot, heat); y += bad; }
      if (vote > 0.001) { bx.put(0, y + vote / 2, z, SLAB_W * 0.92, vote, len * 0.92, C.vote, heat * 0.4); y += vote; }
      // Jito tips: a gold cap whose thickness tracks tips (log)
      const tips = Math.log10(1 + b.jitoTips / 1e3) * 0.09 * age;
      if (tips > 0.01) bx.put(0, y + tips / 2 + 0.03, z, SLAB_W * 0.28, tips, len * 0.45, C.gold, heat + 0.5);
    }
    bx.commit();

    let g = 0;
    for (const slot of this.gateSlots) {
      const z = (slot - playhead) * PITCH;
      if (z < -HISTORY * PITCH) break;
      this.m.makeTranslation(0, 0, z);
      this.gates.setMatrixAt(g++, this.m);
    }
    this.gates.count = g;
    this.gates.instanceMatrix.needsUpdate = true;
  }
}

function fill(frac: number) {
  const t = Math.min(1, frac * 1.15);
  return 1 - Math.pow(1 - t, 3);
}

function mergeBoxes(geos: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}
