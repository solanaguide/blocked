import type { Block, Trade } from './feed';
import type { Kpi } from './presets/types';
import type { Window } from './stats';
import { fmtUsd, fmtInt, SLOTS_PER_EPOCH } from './palette';
import { validatorName } from './validators';

const $ = (id: string) => document.getElementById(id)!;

/** Smoothly rolling number, so KPIs glide rather than flicker every block */
class Roller {
  shown = NaN;
  target = 0;
  fmt: (v: number) => string = String;
  constructor(readonly v: HTMLElement, readonly l: HTMLElement) {}
  tick(dt: number) {
    if (!Number.isFinite(this.target)) return;
    this.shown = Number.isFinite(this.shown) ? this.shown + (this.target - this.shown) * Math.min(1, dt * 3) : this.target;
    this.v.textContent = this.fmt(this.shown);
  }
}

export class Hud {
  private rollers: Roller[] = [];
  private feedEl = $('feed');
  private feedMode: 'whales' | 'windows' = 'whales';

  constructor() {
    const box = $('kpis');
    for (let i = 0; i < 4; i++) {
      const k = document.createElement('div');
      k.className = 'kpi';
      k.innerHTML = '<div class="v"></div><div class="label"></div>';
      box.appendChild(k);
      this.rollers.push(new Roller(k.children[0] as HTMLElement, k.children[1] as HTMLElement));
    }
  }

  played(b: Block | undefined, slot: number) {
    $('slot').textContent = fmtInt(slot);
    const ep = Math.floor(slot / SLOTS_PER_EPOCH);
    $('epoch').textContent = `${ep} · ${(((slot % SLOTS_PER_EPOCH) / SLOTS_PER_EPOCH) * 100).toFixed(1)}%`;
    if (!b) {
      $('leader').textContent = 'SKIPPED';
      return;
    }
    $('leader').textContent = validatorName(b.leader) ?? short(b.leader);
  }

  /** Swap in a preset's identity: title, legend, KPI definitions, ticker */
  usePreset(id: string, title: string, legend: string, feed: 'whales' | 'windows', index: number, count: number) {
    document.body.dataset.preset = id;
    $('preset-name').textContent = title;
    $('preset-dots').textContent = Array.from({ length: count }, (_, i) => (i === index ? '■' : '□')).join(' ');
    $('legend').innerHTML = legend;
    if (feed !== this.feedMode) this.feedEl.replaceChildren();
    this.feedMode = feed;
    this.feedEl.className = 'hud ' + feed;
    for (const r of this.rollers) r.shown = NaN;
  }

  kpis(list: Kpi[]) {
    list.forEach((k, i) => {
      const r = this.rollers[i];
      if (!r) return;
      r.target = k.value;
      r.fmt = k.fmt;
      r.v.style.color = k.color;
      r.l.textContent = k.label;
    });
  }

  whale(t: Trade) {
    if (this.feedMode !== 'whales') return;
    this.push(`<b>${esc(fmtUsd(t.usd))}</b><span>${esc(t.token)}</span><i>${esc(t.program)}</i>`);
  }

  window(w: Window) {
    if (this.feedMode !== 'windows') return;
    const cells = '<em class="ok">■</em>'.repeat(w.produced) + '<em class="skip">■</em>'.repeat(w.skipped);
    this.push(
      `<span>${esc(clip(validatorName(w.leader) ?? short(w.leader)))}</span>${cells}` +
      `<b>${(w.fill * 100).toFixed(0)}%</b><i>${w.feeDensity.toFixed(2)} L/CU</i>`,
    );
  }

  private push(html: string) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = html;
    this.feedEl.prepend(row);
    while (this.feedEl.children.length > 6) this.feedEl.lastElementChild!.remove();
  }

  clearFeed() {
    this.feedEl.replaceChildren();
  }

  status(up: boolean) {
    $('link').classList.toggle('down', !up);
    $('link-text').textContent = up ? 'LINK' : 'RECONNECTING';
  }

  delay(sec: number) {
    $('delay').textContent = `T−${sec.toFixed(1)}s`;
  }

  tick(dt: number) {
    for (const r of this.rollers) r.tick(dt);
  }
}

export function short(k: string) {
  return k ? k.slice(0, 4) + '…' + k.slice(-4) : '—';
}

function clip(s: string, n = 16) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
