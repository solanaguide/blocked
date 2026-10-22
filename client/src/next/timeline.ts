import type { Block } from './feed';

/**
 * Plays the chain back a fixed distance behind live so every slot gets a
 * full, evenly paced slot-time on screen regardless of network jitter.
 * The playhead is a fractional slot number.
 */
export class Timeline {
  readonly blocks = new Map<number, Block>();
  playhead = 0;
  latest = 0;
  slotsPerSec = 4.5;
  timeScale = 1;          // eased by "bullet time" moments
  private targetScale = 1;
  private lastArrival = 0;
  private lagSlots = 9;   // ~2s at 200ms slots
  private entered = 0;    // last slot we emitted

  onEnter: (slot: number, block: Block | undefined) => void = () => {};
  onJump: () => void = () => {};
  backfill = 64;            // slots replayed instantly after a jump

  push(b: Block) {
    this.blocks.set(b.slot, b);
    if (this.lastArrival && b.slot > this.latest) {
      const dt = (b.arrivedAt - this.lastArrival) / 1000 / (b.slot - this.latest);
      if (dt > 0.05 && dt < 2) this.slotsPerSec += (1 / dt - this.slotsPerSec) * 0.05;
    }
    if (b.slot > this.latest) {
      this.latest = b.slot;
      this.lastArrival = b.arrivedAt;
    }
    if (!this.playhead) {
      this.playhead = b.slot - this.lagSlots;
      this.entered = b.slot - 1;
    }
  }

  slowMo(scale: number) {
    this.targetScale = scale;
  }

  update(dt: number) {
    if (!this.playhead) return;
    this.timeScale += (this.targetScale - this.timeScale) * Math.min(1, dt * 4);
    if (this.targetScale < 1 && this.timeScale < this.targetScale + 0.02) this.targetScale = 1;

    const behind = this.latest - this.lagSlots - this.playhead;
    if (behind > 60) {
      // Tab was hidden or feed stalled: jump rather than fast-forward, then
      // replay the recent slots instantly so scenes refill their history
      this.playhead = this.latest - this.lagSlots;
      this.entered = Math.floor(this.playhead) - this.backfill;
      this.onJump();
    }
    // Gentle proportional catch-up keeps the buffer near lagSlots
    const catchUp = Math.max(-0.6, Math.min(1.5, behind * 0.12));
    const rate = this.slotsPerSec * Math.max(0.05, this.timeScale + (this.timeScale >= 0.95 ? catchUp : 0));
    this.playhead += dt * rate;
    // Never play past what we have
    this.playhead = Math.min(this.playhead, this.latest + 0.999);

    while (this.entered < Math.floor(this.playhead) && this.entered < this.latest) {
      this.entered++;
      this.onEnter(this.entered, this.blocks.get(this.entered));
    }
    // Forget old history
    if (this.blocks.size > 600) {
      for (const s of this.blocks.keys()) if (s < this.playhead - 500) this.blocks.delete(s);
    }
  }

  /** 0..1 progress through the current slot */
  get frac() {
    return this.playhead - Math.floor(this.playhead);
  }
}
