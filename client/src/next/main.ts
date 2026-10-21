import * as THREE from 'three';
import { connectFeed, type Block, type Trade } from './feed';
import { Timeline } from './timeline';
import { Post } from './post';
import { Hud } from './hud';
import { Stats } from './stats';
import { LIMITS, FLOW, observeCu } from './palette';
import { loadValidatorNames } from './validators';
import { filterTokenized, filterOrganic, tokenizedCount, loadTokenizedAssets } from './assets';
import type { Preset, Frame } from './presets/types';
import { Highway } from './presets/highway';
import { Validators } from './presets/validators';
import { Spectrum } from './presets/spectrum';
import { City } from './presets/city';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.getElementById('stage')!.appendChild(renderer.domElement);

const presets: Preset[] = [new Highway(), new Validators(), new Spectrum(), new City()];
let active = presets[0];

const post = new Post(renderer, active.scene, active.camera);
const hud = new Hud();
const stats = new Stats();
const timeline = new Timeline();

loadValidatorNames();
loadTokenizedAssets();

// Block CU limit is a server setting (it changes with network upgrades)
fetch(`${import.meta.env.BASE_URL}api/network-state`)
  .then((r) => r.json())
  .then((s) => { if (s.blockCuLimit > 0) LIMITS.cu = Math.max(LIMITS.cu, s.blockCuLimit); })
  .catch(() => {});

// --- Whale detection: adaptive to how busy the network is right now ---
const sizes: number[] = [];
let th = { label: 2500, epic: 50_000 };
function thresholds() {
  if (sizes.length < (mode === 'tokenized' ? 40 : 200)) return th;
  const s = [...sizes].sort((a, b) => a - b);
  return {
    label: Math.max(mode === 'tokenized' ? 200 : 800, s[Math.floor(s.length * 0.993)]),
    epic: Math.max(mode === 'tokenized' ? 5_000 : 20_000, s[Math.floor(s.length * 0.9995)]),
  };
}

// --- Playback: trades of the head slot fire in block order ---
let pending: Trade[] = [];
let headSlot = 0;
let prevBlock: Block | undefined;
let glitch = 0;

stats.onWindow = (w) => {
  for (const p of presets) p.window?.(w);
  hud.window(w);
};

// Trade filter: everything, organic only (indexer wash/bot flags removed), or tokenized assets
type Mode = 'all' | 'organic' | 'tokenized';
const MODES: Mode[] = ['all', 'organic', 'tokenized'];
let mode: Mode = (MODES as string[]).includes(new URLSearchParams(location.search).get('f') ?? '') ? (new URLSearchParams(location.search).get('f') as Mode) : 'all';

timeline.onEnter = (slot, raw) => {
  const block = !raw ? raw : mode === 'tokenized' ? filterTokenized(raw) : mode === 'organic' ? filterOrganic(raw) : raw;
  for (const t of pending) fire(t, headSlot);
  headSlot = slot;
  if (block) {
    observeCu(block.cu);
    for (const t of block.trades) sizes.push(t.usd);
    if (sizes.length > 4000) sizes.splice(0, sizes.length - 4000);
    if (slot % 20 === 0) th = thresholds();
  }
  stats.played(slot, block, performance.now());
  for (const p of presets) p.enter(slot, block, prevBlock);
  pending = [...(block?.trades ?? [])];
  hud.played(block, slot);
  if (!block) glitch = Math.max(glitch, 0.5);
  prevBlock = block ?? prevBlock;
};

function fire(t: Trade, slot: number) {
  const whale = t.usd >= th.label;
  const epic = t.usd >= th.epic;
  active.trade({ trade: t, slot, whale, epic }, frame);
  if (whale) hud.whale(t);
  if (epic) {
    timeline.slowMo(0.22);
    glitch = 1;
  }
}

connectFeed((b) => timeline.push(b), (up) => hud.status(up));

// --- Preset switching: keys 1-4, [ ], A for auto-cycle, ?p= deep link ---
function use(i: number) {
  active.deactivate?.();
  active = presets[(i + presets.length) % presets.length];
  active.activate?.();
  post.use(active.scene, active.camera, active.bloom);
  active.resize(innerWidth, innerHeight);
  hud.usePreset(active.id, active.title, active.legend, active.feed, presets.indexOf(active), presets.length);
  hud.kpis(active.kpis(stats));
  const u = new URL(location.href);
  u.searchParams.set('p', active.id);
  history.replaceState(null, '', u);
  glitch = Math.max(glitch, 0.6);
}
function setFilter(m: Mode) {
  mode = m;
  sizes.length = 0;
  th = { label: m === 'tokenized' ? 500 : 2500, epic: m === 'tokenized' ? 10_000 : 50_000 };
  FLOW.decay = m === 'tokenized' ? 0.9988 : 0.995;
  pending = [];
  for (const p of presets) p.reset?.();
  hud.clearFeed();
  document.body.dataset.filter = m;
  document.getElementById('filter-state')!.textContent =
    m === 'tokenized' ? `TOKENIZED ASSETS · ${tokenizedCount()} STOCKS, ETFs, RWAs` : m === 'organic' ? 'ORGANIC ONLY · WASH & BOTS HIDDEN' : 'ALL TOKENS';
  const u = new URL(location.href);
  if (m === 'all') u.searchParams.delete('f'); else u.searchParams.set('f', m);
  history.replaceState(null, '', u);
  glitch = Math.max(glitch, 0.6);
}
document.getElementById('filter')!.addEventListener('click', () => setFilter(MODES[(MODES.indexOf(mode) + 1) % MODES.length]));

let auto = false;
let autoAt = 0;
addEventListener('keydown', (e) => {
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= presets.length) use(n - 1);
  if (e.key === ']' || e.key === 'ArrowRight') use(presets.indexOf(active) + 1);
  if (e.key === '[' || e.key === 'ArrowLeft') use(presets.indexOf(active) - 1);
  if (e.key === 't' || e.key === 'T') setFilter(mode === 'tokenized' ? 'all' : 'tokenized');
  if (e.key === 'o' || e.key === 'O') setFilter(mode === 'organic' ? 'all' : 'organic');
  if (e.key === 'a' || e.key === 'A') {
    auto = !auto;
    autoAt = performance.now();
    document.getElementById('auto')!.classList.toggle('on', auto);
  }
});
document.getElementById('prev')!.addEventListener('click', () => use(presets.indexOf(active) - 1));
document.getElementById('next')!.addEventListener('click', () => use(presets.indexOf(active) + 1));

const pointer = new THREE.Vector2();
addEventListener('pointermove', (e) => pointer.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5));

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  for (const p of presets) p.resize(w, h);
  post.resize(w, h);
}
addEventListener('resize', resize);

const frame: Frame = { t: 0, dt: 0, pdt: 0, playhead: 0, frac: 0, timeline, pointer, portrait: false };
resize();
use(Math.max(0, presets.findIndex((p) => p.id === new URLSearchParams(location.search).get('p'))));
setFilter(mode);

let last = performance.now();
let lastPlayhead = 0;
let lastKpi = 0;

function loop(now: number) {
  // The playback clock uses real elapsed time so slow devices don't drift behind live
  const real = Math.min(0.5, Math.max(0, now - last) / 1000);
  last = now;
  timeline.update(real);
  const ph = timeline.playhead;

  frame.t = now / 1000;
  frame.dt = Math.min(0.05, real);
  frame.pdt = ph && lastPlayhead ? Math.max(0, ph - lastPlayhead) / timeline.slotsPerSec : 0;
  frame.playhead = ph;
  frame.frac = timeline.frac;
  frame.portrait = innerWidth < innerHeight;
  lastPlayhead = ph;

  if (ph) {
    const due = pending.filter((tr) => tr.order * 0.85 <= frame.frac);
    if (due.length) {
      pending = pending.filter((tr) => tr.order * 0.85 > frame.frac);
      for (const tr of due) fire(tr, headSlot);
    }
    hud.delay((timeline.latest + 1 - ph) / timeline.slotsPerSec);
  }
  active.update(frame);

  if (now - lastKpi > 500) {
    lastKpi = now;
    hud.kpis(active.kpis(stats));
  }
  hud.tick(real);
  if (auto && now - autoAt > 45_000) {
    autoAt = now;
    use(presets.indexOf(active) + 1);
  }

  glitch = Math.max(0, glitch - frame.dt * 1.5);
  post.render(frame.t, glitch);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Debug handle for automation
(window as any).__live = { timeline, stats, use, th: () => th };
