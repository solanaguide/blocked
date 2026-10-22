import type * as THREE from 'three';
import type { Block, Trade } from '../feed';
import type { Timeline } from '../timeline';
import type { Stats, Window } from '../stats';

export interface Frame {
  t: number;          // wall seconds
  dt: number;         // wall delta, clamped for easing
  pdt: number;        // playback delta: in-world motion follows the chain's clock
  playhead: number;   // fractional slot
  frac: number;       // progress through the head slot
  timeline: Timeline;
  pointer: THREE.Vector2;
  portrait: boolean;
}

export interface TradeEvent {
  trade: Trade;
  slot: number;
  whale: boolean;
  epic: boolean;
}

export interface Kpi {
  label: string;
  value: number;
  fmt: (v: number) => string;
  color: string;
}

export interface Preset {
  readonly id: string;
  readonly title: string;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly legend: string;
  readonly bloom: [strength: number, radius: number, threshold: number];
  /** Retro CRT finish strength, 0 = clean film finish (default 1) */
  readonly crt?: number;
  /** Cap on device pixel ratio for heavy scenes (default 1.5) */
  maxDpr?: number;
  /** Called by the preset when it changes its own quality level */
  onQuality?: () => void;
  /** Screen-space light shafts toward a sun position, updated by the preset each frame */
  readonly rays?: { uv: THREE.Vector2; strength: number };
  /** Which ticker the HUD shows: big trades, or this preset's own rows */
  readonly feed: 'whales' | 'windows';

  /** Every slot, active or not, so a preset has history when switched to */
  enter(slot: number, block: Block | undefined, prev: Block | undefined): void;
  /** Leader window closed (all presets) */
  window?(w: Window): void;
  /** A trade's moment in the block arrives (active preset only) */
  trade(e: TradeEvent, f: Frame): void;
  update(f: Frame): void;
  resize(w: number, h: number): void;
  kpis(s: Stats): Kpi[];
  /** The trade filter changed: drop trade-derived history */
  reset?(): void;
  /** Playback jumped (tab was hidden): drop anything tied to the old position */
  jumped?(): void;
  activate?(): void;
  deactivate?(): void;
}
