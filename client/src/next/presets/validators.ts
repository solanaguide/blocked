import * as THREE from 'three';
import type { Block } from '../feed';
import type { Stats } from '../stats';
import type { Preset, Frame, Kpi } from './types';
import { NeonBoxes } from '../world/neonboxes';
import { TextSprite } from '../world/labels';
import { LIMITS } from '../palette';
import { short } from '../hud';
import { validatorName } from '../validators';

const COL_W = 1.25;           // one block column
const COL_PITCH = 1.55;
const COL_H = 7;              // column height = CU limit
const TILE_COLS = 8;
const MAX_TILES = 360;        // per block; above this a tile stands for several txns
const CARD_DX = 8.4;          // card spacing along the row
const CARD_DZ = 3.2;          // each older card steps back this far
const PAST = 8;               // cards kept behind the current one
const POOL = PAST + 3;

const PHOSPHOR = new THREE.Color('#39ff7a');
const AMBER = new THREE.Color('#ffb000');
const ALERT = new THREE.Color('#ff2a2a');
// Reverted txns (mostly slippage limits doing their job): neutral, not an alarm
const REVERTED = new THREE.Color('#56645b');
const VOTE = new THREE.Color('#1d3b2a');
const FRAME = new THREE.Color('#1f9a4a');

const VT = '"VT323", "Share Tech Mono", monospace';

interface Win {
  start: number;
  leader: string;
  slots: (Block | null | undefined)[];   // undefined = not played yet, null = skipped
}

interface Card {
  group: THREE.Group;
  frameCol: THREE.BufferAttribute;
  head: TextSprite;
  foot: TextSprite;
  cols: TextSprite[];
}

/**
 * WarGames big board of leader windows. Each card is one leader's four
 * slots; each block is a glass column (height = CU limit) packed with one
 * tile per transaction up to its real CU fill.
 */
export class Validators implements Preset {
  readonly id = 'validators';
  readonly title = 'VALIDATORS';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 500);
  readonly bloom: [number, number, number] = [0.6, 0.35, 0.45];
  readonly feed = 'windows';
  readonly legend = `
    Card = one leader's 4 slots · column = CU limit<br>
    1 tile = 1 transaction, stacked to real CU used<br>
    Jito<i style="background:#ffb000"></i> ok<i style="background:#39ff7a"></i>
    reverted<i style="background:#56645b"></i> votes<i style="background:#1d3b2a"></i><br>
    L/CU = fees per compute unit (packing value)`;

  private wins = new Map<number, Win>();
  private boxes = new NeonBoxes(POOL * 4 * (MAX_TILES + 4), { edge: 0.012, fill: 0.22, fog: 0.012 });
  private cards: Card[] = [];
  private defcon = new TextSprite(0.9, 64, { glow: 0.15 });
  private stats?: Stats;
  private col = new THREE.Color();
  private look = new THREE.Vector3();

  constructor() {
    this.scene.background = new THREE.Color('#010603');
    this.scene.fog = new THREE.FogExp2('#010603', 0.012);
    this.scene.add(this.boxes.mesh);

    // Floor: vector grid, NORAD style
    const lines: number[] = [];
    for (let x = -70; x <= 70; x += 2.5) lines.push(x, -0.02, 6, x, -0.02, -60);
    for (let z = 6; z >= -60; z -= 2.5) lines.push(-70, -0.02, z, 70, -0.02, z);
    this.scene.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)),
      new THREE.LineBasicMaterial({ color: '#0a3a1c', fog: true }),
    ));

    for (let i = 0; i < POOL; i++) this.cards.push(this.makeCard());
    this.defcon.sprite.position.set(-8, COL_H + 4, -8);
    this.scene.add(this.defcon.sprite);
  }

  private makeCard(): Card {
    const group = new THREE.Group();
    // Outline per column plus a card border; column outlines are recoloured per frame
    const pts: number[] = [];
    const w = COL_W / 2;
    for (let k = 0; k < 4; k++) {
      const x = (k - 1.5) * COL_PITCH;
      pts.push(x - w, 0, 0, x - w, COL_H, 0, x + w, 0, 0, x + w, COL_H, 0, x - w, COL_H, 0, x + w, COL_H, 0, x - w, 0, 0, x + w, 0, 0);
    }
    const bw = 2 * COL_PITCH + w + 0.35;
    pts.push(-bw, -1.45, 0, bw, -1.45, 0, -bw, COL_H + 1.5, 0, bw, COL_H + 1.5, 0, -bw, -1.45, 0, -bw, COL_H + 1.5, 0, bw, -1.45, 0, bw, COL_H + 1.5, 0);
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const frameCol = new THREE.BufferAttribute(new Float32Array(pts.length), 3);
    for (let v = 32; v < 40; v++) frameCol.setXYZ(v, FRAME.r * 0.6, FRAME.g * 0.6, FRAME.b * 0.6);
    geo.setAttribute('color', frameCol);
    group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, fog: true })));

    const head = new TextSprite(0.62, 64, { glow: 0.1 });
    head.sprite.position.set(0, COL_H + 0.35, 0);
    const foot = new TextSprite(0.36, 64, { glow: 0 });
    foot.sprite.position.set(0, -1.35, 0);
    const cols = [0, 1, 2, 3].map((k) => {
      const s = new TextSprite(0.28, 64, { glow: 0 });
      s.sprite.position.set((k - 1.5) * COL_PITCH, -0.62, 0);
      return s;
    });
    for (const s of [head, foot, ...cols]) {
      group.add(s.sprite);
      (s.sprite.material as THREE.SpriteMaterial).depthTest = true;
    }
    this.scene.add(group);
    group.visible = false;
    return { group, frameCol, head, foot, cols };
  }

  enter(slot: number, b: Block | undefined) {
    const start = slot - (slot % 4);
    let w = this.wins.get(start);
    if (!w) {
      w = { start, leader: '', slots: [undefined, undefined, undefined, undefined] };
      this.wins.set(start, w);
      for (const s of this.wins.keys()) if (s < start - (PAST + 4) * 4) this.wins.delete(s);
    }
    w.slots[slot % 4] = b ?? null;
    if (b) w.leader = b.leader;
  }

  trade() {}

  update(f: Frame) {
    const ph = f.playhead;
    const headSlot = Math.floor(ph);
    const grow = 1 - Math.pow(1 - Math.min(1, f.frac * 1.15), 3);
    const bx = this.boxes;
    bx.begin();
    for (const c of this.cards) c.group.visible = false;

    let ci = 0;
    for (const w of this.wins.values()) {
      // Continuous position: the current window glides through the centre
      const u = (w.start + 2 - ph) / 4;
      if (u < -PAST - 0.5 || u > 0.75 || ci >= this.cards.length) continue;
      // A straight row receding to the left; each card turns to face the camera
      const px = u * CARD_DX, pz = Math.min(0, u) * CARD_DZ;
      const theta = Math.atan2(this.camera.position.x - px, this.camera.position.z - pz) * 0.85;
      const cosT = Math.cos(theta), sinT = Math.sin(theta);
      const near = Math.max(0, 1 - Math.abs(u) / 3);
      const card = this.cards[ci++];
      card.group.visible = true;
      card.group.position.set(px, 0, pz);
      card.group.rotation.y = theta;

      let cu = 0, fees = 0, produced = 0, skipped = 0, tips = 0;
      for (let k = 0; k < 4; k++) {
        const b = w.slots[k];
        const slot = w.start + k;
        const lx = (k - 1.5) * COL_PITCH;
        const cx = px + lx * cosT, cz = pz - lx * sinT;
        const isHead = slot === headSlot;
        this.paintColumn(card, k, b === null ? ALERT : isHead ? PHOSPHOR : FRAME, isHead ? 1.6 : 0.5 + near * 0.5);
        if (b === undefined) { card.cols[k].opacity = 0; continue; }
        if (b === null) {
          skipped++;
          bx.put(cx, 0.15, cz, COL_W, 0.3, 0.4, ALERT, 1.2, theta);
          card.cols[k].set([{ text: 'SKIPPED', color: '#ff4a4a', font: VT }]);
          card.cols[k].opacity = near > 0 ? 1 : 0;
          continue;
        }
        produced++; cu += b.cu; fees += b.fees; tips += b.jitoTips;
        this.packBlock(b, cx, cz, theta, isHead ? grow : 1, isHead ? 1.1 : 0.25 + near * 0.35);
        const density = b.cu ? b.fees / b.cu : 0;
        card.cols[k].set([{ text: `${b.txns - b.votes} TX · ${density.toFixed(2)}`, color: '#7fdc9a', font: VT }]);
        card.cols[k].opacity = near > 0.2 ? near : 0;
      }

      const self = this.stats?.leaders.get(w.leader);
      card.head.set([{ text: validatorName(w.leader) ?? short(w.leader), color: u > -0.5 ? '#39ff7a' : '#1fbf5a', font: VT }]);
      const fill = produced ? (cu / produced / LIMITS.cu) * 100 : 0;
      card.foot.set([{
        text: `FILL ${fill.toFixed(0)}% · ${(cu ? fees / cu : 0).toFixed(2)} L/CU · TIPS ${(tips / 1e9).toFixed(3)}` +
          (skipped ? ` · ${skipped} SKIP` : '') + (self && self.windows > 1 ? ` · SEEN ${self.windows}×` : ''),
        color: skipped ? '#ff5a5a' : '#ffb000', font: VT,
      }]);
      card.head.opacity = 0.35 + near * 0.65;
      card.foot.opacity = 0.25 + near * 0.75;
    }
    bx.commit();

    const s = this.stats;
    if (s) {
      // Framed as production, not alarm: skips are normal background for a leader-rotated chain
      const produced = (1 - s.skipRate) * 100;
      const ok = s.skipRate < 0.08;
      this.defcon.set([{
        text: `BLOCK PRODUCTION · ${ok ? 'NOMINAL' : 'ELEVATED SKIPS'} · ${produced.toFixed(1)}% OF SLOTS`,
        color: ok ? '#39ff7a' : '#ffb000', font: VT, scale: 0.75,
      }]);
    }

    const { t, pointer, portrait } = f;
    this.camera.position.set(-1.5 + Math.sin(t * 0.05) * 0.8 + pointer.x * 2, 5 - pointer.y * 1.2, portrait ? 30 : 17.5);
    this.look.set(portrait ? -1 : -5, 3.4, -6);
    this.camera.lookAt(this.look);
  }

  /** One tile per transaction (or per k txns when busy), stacked to the block's CU fill */
  private packBlock(b: Block, cx: number, cz: number, theta: number, grow: number, heat: number) {
    const bx = this.boxes;
    const scale = COL_H / LIMITS.cu;
    const voteH = b.voteCu * scale;
    if (voteH > 0.01) bx.put(cx, voteH / 2, cz, COL_W * 0.96, voteH, 0.5, VOTE, 0.2, theta);
    const n = b.completed + b.reverted;
    if (!n) return;
    const per = Math.ceil(n / MAX_TILES);
    const tiles = Math.ceil(n / per);
    const rows = Math.ceil(tiles / TILE_COLS);
    const th = ((b.okCu + b.failedCu) * scale) / rows, tw = COL_W / TILE_COLS;
    const jito = Math.round(Math.min(b.jitoTxns, b.completed) / per);
    const ok = Math.round(b.completed / per);
    const shown = Math.floor(tiles * grow);
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    for (let i = 0; i < shown; i++) {
      const row = Math.floor(i / TILE_COLS), c = i % TILE_COLS;
      const lx = (c - (TILE_COLS - 1) / 2) * tw;
      const y = voteH + (row + 0.5) * th;
      bx.put(cx + lx * cosT, y, cz - lx * sinT, tw * 0.82, Math.max(0.006, th * 0.78), 0.32, i < jito ? AMBER : i < ok ? PHOSPHOR : REVERTED, heat, theta);
    }
  }

  private paintColumn(card: Card, k: number, c: THREE.Color, gain: number) {
    this.col.copy(c).multiplyScalar(gain);
    for (let v = k * 8; v < k * 8 + 8; v++) card.frameCol.setXYZ(v, this.col.r, this.col.g, this.col.b);
    card.frameCol.needsUpdate = true;
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  kpis(s: Stats): Kpi[] {
    this.stats = s;
    return [
      { label: 'Slots produced (session)', value: (1 - s.skipRate) * 100, fmt: (v) => v.toFixed(1) + '%', color: '#39ff7a' },
      { label: 'Slot time', value: s.slotTimeMs, fmt: (v) => v.toFixed(0) + 'ms', color: '#39ff7a' },
      { label: 'Block fill', value: s.fill * 100, fmt: (v) => v.toFixed(0) + '%', color: '#ffb000' },
      { label: 'Fees / CU (lamports)', value: s.feeDensity, fmt: (v) => v.toFixed(3), color: '#e8ffe8' },
    ];
  }
}
