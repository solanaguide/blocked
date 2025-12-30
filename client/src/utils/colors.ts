// Shared color mappings for programs and tokens
// Used by both ParticleSystem and HUD for consistency

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
  ['SOL', 0xffd700],    // Gold
  ['USDC', 0x00ffd4],   // Cyan
  ['USDT', 0x26a17b],   // Green
]);

export function hashColor(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Convert to vibrant color
  return (hash & 0x00FFFFFF) | 0x404040; // Ensure minimum brightness
}

export function colorToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}
