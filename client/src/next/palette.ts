import * as THREE from 'three';

export const PITCH = 0.9;          // world units per slot along the chain
export const HISTORY = 170;        // slots kept on screen (~38s)
export const LIMITS = { cu: 60_000_000 };
export const SLOTS_PER_EPOCH = 432_000;

/** Trade-flow memory per slot: ~45s for the full market, ~4min for sparse filtered flows */
export const FLOW = { decay: 0.995 };

/** Track the network's block CU limit: server config first, observed blocks as a backstop */
export function observeCu(cu: number) {
  if (cu > LIMITS.cu) LIMITS.cu = Math.ceil(cu / 10_000_000) * 10_000_000;
}
export const SLAB_W = 2.2;
export const SLAB_H = 3.4;         // height of a block at the CU limit

export const C = {
  bg: new THREE.Color('#06010f'),
  horizon: new THREE.Color('#2a0838'),
  fog: new THREE.Color('#12031e'),
  grid: new THREE.Color('#ff2bd6'),
  cyan: new THREE.Color('#22e6ff'),
  magenta: new THREE.Color('#ff2bd6'),
  violet: new THREE.Color('#7b5cff'),
  gold: new THREE.Color('#ffc23d'),
  hot: new THREE.Color('#ff3b6b'),
  vote: new THREE.Color('#3a2d7a'),
  white: new THREE.Color('#ffffff'),
};

// Distinct neon hues for lanes, nearest-road first
export const LANE_COLORS = [
  '#22e6ff', '#ff2bd6', '#ffc23d', '#7bff6a', '#a07bff', '#ff7a3d', '#3dffd0', '#ff5c8a',
].map((c) => new THREE.Color(c));

export function fmtUsd(v: number) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}

export function fmtInt(v: number) {
  return Math.round(v).toLocaleString('en-US');
}

export const FOG_GLSL = /* glsl */ `
  uniform vec3 fogColor;
  uniform float fogDensity;
  vec3 applyFog(vec3 col, float depth) {
    float f = 1.0 - exp(-fogDensity * fogDensity * depth * depth);
    return mix(col, fogColor, clamp(f, 0.0, 1.0));
  }
`;

export const fogUniforms = () => ({
  fogColor: { value: C.fog.clone() },
  fogDensity: { value: 0.011 },
});
