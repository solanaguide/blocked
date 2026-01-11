// Shared color mappings for programs and tokens
// Used by both ParticleSystem and HUD for consistency

// Transaction type colors (no red - reverts are valid outcomes)
export const txTypeColors = {
  vote: 0xFFD700,      // Golden - network consensus/validation heartbeat
  completed: 0x00CED1, // Cyan/Teal - completed transactions
  reverted: 0xFFA500,  // Amber/Orange - reverted but valid (slippage, etc)
  jito: 0xFF8C00,      // Orange - MEV/Jito transactions
};

export const programColors: Map<string, number> = new Map([
  ['JUP', 0xb026ff],          // Jupiter - Electric Purple
  ['RAYDIUM_CLMM', 0x00f0ff], // Raydium CLMM - Neon Blue
  ['RAYDIUM_CP', 0xff006e],   // Raydium CP - Hot Pink
  ['RAYDIUM_CPMM', 0xff1493], // Raydium CPMM - Deep Pink
  ['ORCA', 0x00ffd4],         // Orca - Cyan
  ['PHOENIX', 0xff6b35],      // Phoenix - Orange
  ['LIFINITY', 0x00ff88],     // Lifinity - Green
  ['FLASH', 0xffff00],        // Flash - Yellow
]);

export const tokenColors: Map<string, number> = new Map([
  ['SOL', 0x9945ff],    // Solana purple (brand color)
  ['USDC', 0x00d4ff],   // Bright cyan/blue
  ['USDT', 0x00ff88],   // Bright green
]);

export function hashColor(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Generate vibrant vaporwave-style colors
  // Use hash to pick from a set of vibrant color ranges
  const hue = Math.abs(hash) % 360;

  // Convert HSL to RGB for vibrant colors
  // High saturation (90-100%), medium-high lightness (50-70%) for vaporwave aesthetic
  const saturation = 0.9 + (Math.abs(hash >> 8) % 10) / 100; // 90-100%
  const lightness = 0.5 + (Math.abs(hash >> 16) % 20) / 100; // 50-70%

  return hslToRgb(hue / 360, saturation, lightness);
}

function hslToRgb(h: number, s: number, l: number): number {
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return ((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255));
}

// Gradient heatmap for volume visualization
// Creates smooth color transitions based on trade volume
export function volumeHeatmap(volumeUsd: number): number {
  // Logarithmic scale for better distribution across volume ranges
  const logVolume = Math.log10(Math.max(1, volumeUsd));

  // Define gradient stops (log scale)
  // log10(1) = 0 → cyan/blue (micro trades)
  // log10(100) = 2 → purple (small trades)
  // log10(1000) = 3 → pink (medium trades)
  // log10(10000) = 4 → red (large trades)
  // log10(100000) = 5 → bright red (whales)

  if (logVolume < 1) {
    // $1 - $10: Blue → Cyan gradient
    return interpolateColor(0x0044ff, 0x00ddff, logVolume);
  } else if (logVolume < 2) {
    // $10 - $100: Cyan → Purple gradient
    return interpolateColor(0x00ddff, 0x8b5cf6, logVolume - 1);
  } else if (logVolume < 3) {
    // $100 - $1k: Purple → Pink gradient
    return interpolateColor(0x8b5cf6, 0xff1493, logVolume - 2);
  } else if (logVolume < 4) {
    // $1k - $10k: Pink → Hot Pink/Red gradient
    return interpolateColor(0xff1493, 0xff006e, logVolume - 3);
  } else {
    // $10k+: Hot Pink → Bright Red gradient
    const t = Math.min((logVolume - 4) / 2, 1); // Cap at log 6 ($1M)
    return interpolateColor(0xff006e, 0xff3333, t);
  }
}

// Linear interpolation between two colors
function interpolateColor(color1: number, color2: number, t: number): number {
  t = Math.max(0, Math.min(1, t)); // Clamp to [0, 1]

  const r1 = (color1 >> 16) & 0xff;
  const g1 = (color1 >> 8) & 0xff;
  const b1 = color1 & 0xff;

  const r2 = (color2 >> 16) & 0xff;
  const g2 = (color2 >> 8) & 0xff;
  const b2 = color2 & 0xff;

  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);

  return (r << 16) | (g << 8) | b;
}

export function colorToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}
