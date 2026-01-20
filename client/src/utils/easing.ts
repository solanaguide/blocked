/**
 * Easing functions for smooth animations
 * All functions take t (0-1) and return eased value (0-1)
 */

// Linear (no easing)
export const linear = (t: number): number => t;

// Quadratic
export const easeInQuad = (t: number): number => t * t;
export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);
export const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

// Cubic
export const easeInCubic = (t: number): number => t * t * t;
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Quartic
export const easeInQuart = (t: number): number => t * t * t * t;
export const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);
export const easeInOutQuart = (t: number): number =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

// Quintic
export const easeInQuint = (t: number): number => t * t * t * t * t;
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);
export const easeInOutQuint = (t: number): number =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

// Exponential
export const easeInExpo = (t: number): number =>
  t === 0 ? 0 : Math.pow(2, 10 * t - 10);
export const easeOutExpo = (t: number): number =>
  t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
export const easeInOutExpo = (t: number): number =>
  t === 0 ? 0 : t === 1 ? 1 : t < 0.5
    ? Math.pow(2, 20 * t - 10) / 2
    : (2 - Math.pow(2, -20 * t + 10)) / 2;

// Circular
export const easeInCirc = (t: number): number =>
  1 - Math.sqrt(1 - Math.pow(t, 2));
export const easeOutCirc = (t: number): number =>
  Math.sqrt(1 - Math.pow(t - 1, 2));
export const easeInOutCirc = (t: number): number =>
  t < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;

// Back (overshoots slightly)
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;

export const easeInBack = (t: number): number =>
  c3 * t * t * t - c1 * t * t;
export const easeOutBack = (t: number): number =>
  1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
export const easeInOutBack = (t: number): number =>
  t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;

// Elastic
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;

export const easeInElastic = (t: number): number =>
  t === 0 ? 0 : t === 1 ? 1
    : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
export const easeOutElastic = (t: number): number =>
  t === 0 ? 0 : t === 1 ? 1
    : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
export const easeInOutElastic = (t: number): number =>
  t === 0 ? 0 : t === 1 ? 1 : t < 0.5
    ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
    : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;

// Bounce
export const easeOutBounce = (t: number): number => {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  } else {
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

export const easeInBounce = (t: number): number =>
  1 - easeOutBounce(1 - t);
export const easeInOutBounce = (t: number): number =>
  t < 0.5
    ? (1 - easeOutBounce(1 - 2 * t)) / 2
    : (1 + easeOutBounce(2 * t - 1)) / 2;

// Sine
export const easeInSine = (t: number): number =>
  1 - Math.cos((t * Math.PI) / 2);
export const easeOutSine = (t: number): number =>
  Math.sin((t * Math.PI) / 2);
export const easeInOutSine = (t: number): number =>
  -(Math.cos(Math.PI * t) - 1) / 2;

/**
 * Interpolate between two values using an easing function
 * @param start Start value
 * @param end End value
 * @param t Progress (0-1)
 * @param easeFn Easing function to use
 */
export function lerp(
  start: number,
  end: number,
  t: number,
  easeFn: (t: number) => number = linear
): number {
  return start + (end - start) * easeFn(t);
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Map a value from one range to another
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

/**
 * Smoothstep interpolation (cubic hermite)
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Smootherstep interpolation (quintic hermite - smoother derivative)
 */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}
