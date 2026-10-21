import type { Block } from './feed';
import { LIMITS } from './palette';

interface Played { t: number; slot: number; b?: Block }

/** One leader's 4-slot window, scored for block packing */
export interface Window {
  leader: string;
  start: number;            // first slot of the window
  produced: number;
  skipped: number;
  fill: number;             // mean CU / limit over produced blocks
  feeDensity: number;       // lamports per CU
  failedShare: number;      // failed CU / total CU
  tips: number;             // lamports
  fees: number;             // lamports
  txns: number;
}

export interface LeaderTotals {
  windows: number; produced: number; skipped: number;
  cu: number; fees: number; failedCu: number; tips: number;
}

/**
 * Rolling network stats over what has been *played* (so numbers match the
 * picture), plus per-leader packing scores for the session.
 */
export class Stats {
  private window: Played[] = [];
  private session = { slots: 0, skipped: 0 };
  readonly leaders = new Map<string, LeaderTotals>();
  private open: { start: number; blocks: Block[]; skipped: number } | null = null;
  onWindow: (w: Window) => void = () => {};

  played(slot: number, b: Block | undefined, now: number) {
    this.window.push({ t: now, slot, b });
    while (this.window.length && this.window[0].t < now - 10_000) this.window.shift();
    this.session.slots++;
    if (!b) this.session.skipped++;

    // Leader windows are aligned to 4-slot boundaries
    const start = slot - (slot % 4);
    if (this.open && this.open.start !== start) this.closeWindow();
    if (!this.open) this.open = { start, blocks: [], skipped: 0 };
    if (b) this.open.blocks.push(b);
    else this.open.skipped++;
  }

  private closeWindow() {
    const o = this.open!;
    this.open = null;
    const leader = o.blocks[0]?.leader;
    if (!leader) return;  // whole window skipped: leader unknown without a schedule
    let cu = 0, fees = 0, failed = 0, tips = 0, txns = 0;
    for (const b of o.blocks) {
      cu += b.cu; fees += b.fees; failed += b.failedCu; tips += b.jitoTips; txns += b.txns - b.votes;
    }
    const w: Window = {
      leader, start: o.start, produced: o.blocks.length, skipped: o.skipped,
      fill: cu / o.blocks.length / LIMITS.cu,
      feeDensity: cu ? fees / cu : 0,
      failedShare: cu ? failed / cu : 0,
      tips, fees, txns,
    };
    const t = this.leaders.get(leader) ?? { windows: 0, produced: 0, skipped: 0, cu: 0, fees: 0, failedCu: 0, tips: 0 };
    t.windows++; t.produced += w.produced; t.skipped += w.skipped; t.cu += cu; t.fees += fees; t.failedCu += failed; t.tips += tips;
    this.leaders.set(leader, t);
    this.onWindow(w);
  }

  private sum(f: (b: Block) => number) {
    let s = 0;
    for (const p of this.window) if (p.b) s += f(p.b);
    return s;
  }

  private get span() {
    return this.window.length > 1 ? Math.max(1, (this.window[this.window.length - 1].t - this.window[0].t) / 1000) : 1;
  }

  private get produced() {
    return this.window.filter((p) => p.b).length || 1;
  }

  get tps() { return this.sum((b) => b.txns - b.votes) / this.span; }
  get volPerMin() { return (this.sum((b) => b.swapUsd) / this.span) * 60; }
  get feesPerMin() { return (this.sum((b) => b.fees) / 1e9 / this.span) * 60; }
  get fill() { return this.sum((b) => b.cu) / this.produced / LIMITS.cu; }
  get tradesPerSec() { return this.sum((b) => b.trades.length) / this.span; }
  get feeDensity() { const cu = this.sum((b) => b.cu); return cu ? this.sum((b) => b.fees) / cu : 0; }
  get failedShare() { const cu = this.sum((b) => b.cu); return cu ? this.sum((b) => b.failedCu) / cu : 0; }
  /** Slots advance whether or not a block lands, so this is true slot cadence */
  get slotTimeMs() {
    // Measured on network arrival times, not the (catch-up adjusted) playback clock
    const got = this.window.filter((p) => p.b);
    const a = got[0]?.b, b = got[got.length - 1]?.b;
    return a && b && b.slot > a.slot ? (b.arrivedAt - a.arrivedAt) / (b.slot - a.slot) : 0;
  }
  get skipRate() { return this.session.slots ? this.session.skipped / this.session.slots : 0; }
  get sessionSlots() { return this.session.slots; }
  get liveTokens() {
    const s = new Set<string>();
    for (const p of this.window) for (const t of p.b?.trades ?? []) s.add(t.tokenMint);
    return s.size;
  }
  get avgTrade() { const n = this.sum((b) => b.trades.length); return n ? this.sum((b) => b.swapUsd) / n : 0; }
  get lastSwapUsd() { const p = this.window[this.window.length - 1]; return p?.b?.swapUsd ?? 0; }
  get meanSwapUsd() { return this.sum((b) => b.swapUsd) / this.produced; }
}
