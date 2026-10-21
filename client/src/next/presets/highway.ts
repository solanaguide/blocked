import * as THREE from 'three';
import type { Block } from '../feed';
import type { Stats } from '../stats';
import type { Preset, Frame, TradeEvent, Kpi } from './types';
import { Sky } from '../world/sky';
import { Chain } from '../world/chain';
import { Terrain, LANES } from '../world/terrain';
import { Trades } from '../world/trades';
import { TextSprite, SlotLabels, DISPLAY } from '../world/labels';
import { C, LANE_COLORS, SLOTS_PER_EPOCH, fmtUsd, fmtInt } from '../palette';

/** The chain as a road into an eclipse, flanked by DEX and token volume ranges */
export class Highway implements Preset {
  readonly id = 'highway';
  readonly title = 'HIGHWAY';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 2000);
  readonly bloom: [number, number, number] = [0.7, 0.45, 0.42];
  readonly feed = 'whales';
  readonly legend = `
    Block compute: succeeded<i style="background:var(--cyan)"></i><br>
    failed<i style="background:var(--hot)"></i><br>
    <span class="votes">votes<i style="background:#3a2d7a"></i><br></span>
    Jito tips<i style="background:var(--gold)"></i><br>
    Arch = new leader<i style="background:var(--magenta)"></i><br>
    Ring = epoch progress`;

  private sky = new Sky();
  private chain = new Chain();
  private dex = new Terrain(-1);
  private tokens = new Terrain(1);
  private trades = new Trades();
  private whaleLabels = new SlotLabels(10, 0.42);
  private names = new Map<string, string>();
  private tmp = new THREE.Vector3();
  private look = new THREE.Vector3();
  private lastWhaleLabel = 0;
  private whaleSide = 1;
  private slot = 0;
  private sawVotes = true;

  constructor() {
    this.scene.background = C.bg;
    this.scene.fog = new THREE.FogExp2(C.fog, 0.011);
    this.scene.add(this.sky.group, this.chain.group, this.dex.group, this.tokens.group, this.trades.group, this.whaleLabels.group);
    this.laneTags(this.dex, '◂ DEX VOLUME');
    this.laneTags(this.tokens, 'TOKEN VOLUME ▸');
  }

  // Lane name tags at the near edge of each range, on dark plates for legibility
  private laneTags(t: Terrain, title: string) {
    const tags: TextSprite[] = [];
    for (let l = 0; l < LANES; l++) {
      const s = new TextSprite(0.26, 64, { glow: 0, plate: true });
      s.sprite.position.set(t.laneX(l), 0.15, -4);
      s.opacity = 0;
      this.scene.add(s.sprite);
      tags.push(s);
    }
    t.lanes.onChange = (l, key) => {
      let name = key ? (t === this.dex ? key : this.names.get(key) ?? key) : '';
      if (name.length > 14) name = name.slice(0, 4) + '…' + name.slice(-4);
      tags[l].set([{ text: name.toUpperCase(), color: '#' + LANE_COLORS[l].clone().multiplyScalar(0.85).getHexString() }]);
      tags[l].opacity = key ? 0.9 : 0;
    };
    const head = new TextSprite(0.26, 64, { glow: 0 });
    head.set([{ text: title, color: '#9d8cd9' }]);
    head.sprite.position.set(t.laneX(LANES / 2 - 0.5), 0, -1);
    head.opacity = 0.7;
    this.scene.add(head.sprite);
  }

  enter(slot: number, block: Block | undefined, prev: Block | undefined) {
    this.slot = slot;
    this.chain.enter(slot, block, prev);
    const dv = new Map<string, number>(), tv = new Map<string, number>();
    for (const t of block?.trades ?? []) {
      dv.set(t.program, (dv.get(t.program) ?? 0) + t.usd);
      tv.set(t.tokenMint, (tv.get(t.tokenMint) ?? 0) + t.usd);
      this.names.set(t.tokenMint, t.token);
    }
    this.dex.enter(slot, dv);
    this.tokens.enter(slot, tv);
    if (block) this.sawVotes = block.voteCu > 0;
  }

  trade({ trade: t, slot, whale }: TradeEvent, f: Frame) {
    const target = slot + 0.5;
    const tx = (Math.random() - 0.5) * 1.4;
    const ty = this.chain.headTop(f.frac);
    const dl = this.dex.lanes.lane(t.program);
    const tl = this.tokens.lanes.lane(t.tokenMint);
    const land = () => {
      this.chain.impact(t.usd);
      if (!whale) return;
      const now = performance.now();
      if (now - this.lastWhaleLabel < 700) return;
      this.lastWhaleLabel = now;
      this.whaleSide = -this.whaleSide;
      this.whaleLabels.add(slot, this.whaleSide * 2.3, 1.2 + Math.random() * 1.2, [
        { text: t.token, color: '#ffffff', font: DISPLAY, scale: 1 },
        { text: `${fmtUsd(t.usd)} · ${t.program}`, color: '#ffc23d', scale: 0.62 },
      ], now, 6500);
    };
    // Primary spark from the DEX that executed it
    if (dl >= 0) this.tmp.set(this.dex.laneX(dl), this.dex.headPeak(dl) + 0.4, 0);
    else this.tmp.set(-12 - Math.random() * 3, 1 + Math.random() * 2, 0);
    const col = dl >= 0 ? LANE_COLORS[dl] : C.white;
    this.trades.launch(this.tmp, f.playhead - 2, tx, ty, target, t.usd, whale ? C.gold : col, land);
    // Echo spark from the token's range: a trade joins a DEX, a token and a block
    if (tl >= 0) {
      this.tmp.set(this.tokens.laneX(tl), this.tokens.headPeak(tl) + 0.4, 0);
      this.trades.launch(this.tmp, f.playhead - 2, tx, ty, target, t.usd * 0.3, LANE_COLORS[tl]);
    }
  }

  update(f: Frame) {
    const grow = 1 - Math.pow(1 - Math.min(1, f.frac * 1.15), 3);
    this.chain.update(f.pdt, f.playhead);
    this.dex.update(f.playhead, grow);
    this.tokens.update(f.playhead, grow);
    this.trades.update(f.pdt, f.playhead);
    this.whaleLabels.update(performance.now(), f.playhead);
    this.sky.update(f.t, f.playhead, this.pulse, (this.slot % SLOTS_PER_EPOCH) / SLOTS_PER_EPOCH);
    document.querySelectorAll<HTMLElement>('#legend .votes').forEach((e) => (e.style.display = this.sawVotes ? '' : 'none'));

    const { t, pointer, portrait } = f;
    this.camera.position.set(
      Math.sin(t * 0.07) * 1.1 + pointer.x * 1.5,
      (portrait ? 5.2 : 4.3) + Math.sin(t * 0.05) * 0.25 - pointer.y * 0.8,
      portrait ? 8.5 : 9,
    );
    this.look.set(Math.sin(t * 0.05) * 0.6, portrait ? 0.2 : 1.0, -20);
    this.camera.lookAt(this.look);
  }

  pulse = 0;

  reset() {
    this.dex.reset();
    this.tokens.reset();
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 72 : 52;
    this.camera.updateProjectionMatrix();
    this.trades.resize();
  }

  kpis(s: Stats): Kpi[] {
    this.pulse = Math.min(1, s.meanSwapUsd > 0 ? (s.lastSwapUsd / s.meanSwapUsd) * 0.35 : 0);
    return [
      { label: 'User TPS', value: s.tps, fmt: fmtInt, color: 'var(--cyan)' },
      { label: 'DEX vol / min', value: s.volPerMin, fmt: fmtUsd, color: 'var(--magenta)' },
      { label: 'Fees SOL / min', value: s.feesPerMin, fmt: (v) => v.toFixed(2), color: 'var(--gold)' },
      { label: 'Block fill', value: s.fill * 100, fmt: (v) => v.toFixed(0) + '%', color: '#fff' },
    ];
  }
}
