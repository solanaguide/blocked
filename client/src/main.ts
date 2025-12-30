import { Scene } from './scene/Scene';
import { HUD } from './hud/HUD';
import type { WSMessage, BatchMessage, BlockCompleteMessage, StatsMessage } from '../../shared/types';
import type { FocusMode, ParticleShape } from './types';

// Initialize
const container = document.getElementById('canvas-container')!;
const scene = new Scene(container);
const hud = new HUD();

// Create worker
const worker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
});

// State
let currentSlot = 0;
let currentMode: FocusMode = 'volume';
let currentShape: ParticleShape = 'cube';
let tradesThisSecond = 0;
let volumeThisSecond = 0;
let lastTpsUpdate = Date.now();
let leaderboardMode: 'window' | 'block' = 'window'; // Toggle between 60s window and last block

// Handle worker messages
worker.onmessage = (event) => {
  const { type, data } = event.data;

  if (type === 'connected') {
    console.log('✅ Connected to WebSocket server');
    hud.showNotification('Connected to Solana stream', 2000);
  }

  if (type === 'disconnected') {
    console.log('❌ Disconnected from WebSocket server');
    hud.showNotification('Disconnected - reconnecting...', 2000);
  }

  if (type === 'ws_message') {
    handleWSMessage(data);
  }
};

function handleWSMessage(message: WSMessage) {
  if (message.type === 'trades') {
    const batch = message as BatchMessage;

    // Add trades to scene
    for (const trade of batch.batch) {
      scene.addTrade(trade);
      tradesThisSecond++;
      volumeThisSecond += trade.vu;

      // Show notification for mega trades
      if (trade.vu > 1000000) {
        hud.showNotification(
          `🔥 Mega Trade: $${(trade.vu).toFixed(2)}`,
          3000
        );
      }
    }

    // Update HUD
    currentSlot = batch.currentSlot;
    hud.updateCurrentSlot(currentSlot);
    hud.updateBlockProgress(batch.blockProgress);

    // Update TPS and charts every second
    const now = Date.now();
    if (now - lastTpsUpdate > 1000) {
      hud.updateTPS(tradesThisSecond);

      // Add per-second data point to charts
      hud.addChartDataPoint(tradesThisSecond, volumeThisSecond);

      tradesThisSecond = 0;
      volumeThisSecond = 0;
      lastTpsUpdate = now;
    }
  }

  if (message.type === 'block_complete') {
    const block = message as BlockCompleteMessage;
    console.log(`✅ Block ${block.slot} complete: ${block.trades} trades, $${block.volume.toFixed(2)}`);

    hud.showNotification(
      `Block ${block.slot} | ${block.trades} trades | $${formatNumber(block.volume)}`,
      2000
    );
  }

  if (message.type === 'stats') {
    const stats = message as StatsMessage;

    console.log('📊 Stats received:', {
      windowTrades: stats.window.trades,
      windowVolume: stats.window.volume,
      windowPrograms: Object.keys(stats.window.programs).length,
      windowTokens: Object.keys(stats.window.tokenVolumes).length,
      lastBlockSlot: stats.lastBlock.slot,
      lastBlockTrades: stats.lastBlock.trades,
      lastBlockPrograms: Object.keys(stats.lastBlock.programs).length,
      lastBlockTokens: Object.keys(stats.lastBlock.tokenVolumes).length
    });

    // Update last block stats in left panel
    if (stats.lastBlock && stats.lastBlock.slot > 0) {
      console.log(`📋 Updating block stats: slot ${stats.lastBlock.slot}, trades ${stats.lastBlock.trades}, volume ${stats.lastBlock.volume}`);
      hud.updateBlockStats(stats.lastBlock.slot, stats.lastBlock.trades, stats.lastBlock.volume);
    } else {
      console.warn('⚠️ lastBlock is invalid:', stats.lastBlock);
    }

    // Store both window and block data for toggling
    (window as any).cachedWindowPrograms = stats.window.programs;
    (window as any).cachedWindowTokens = stats.window.tokenVolumes;
    (window as any).cachedBlockPrograms = stats.lastBlock.programs || {};
    (window as any).cachedBlockTokens = stats.lastBlock.tokenVolumes || {};

    console.log('💾 Cached data:', {
      windowPrograms: Object.keys((window as any).cachedWindowPrograms).length,
      blockPrograms: Object.keys((window as any).cachedBlockPrograms).length
    });

    // Update leaderboards based on current mode
    updateLeaderboards();
  }
}

// Helper to update leaderboards based on mode
function updateLeaderboards() {
  const windowPrograms = (window as any).cachedWindowPrograms || {};
  const windowTokens = (window as any).cachedWindowTokens || {};
  const blockPrograms = (window as any).cachedBlockPrograms || {};
  const blockTokens = (window as any).cachedBlockTokens || {};

  if (leaderboardMode === 'window') {
    hud.updateProgramStats(windowPrograms, 'Top Programs (60s window)');
    hud.updateTokenStats(windowTokens, 'Top Tokens (60s window)');
  } else {
    hud.updateProgramStats(blockPrograms, 'Top Programs (last block)');
    hud.updateTokenStats(blockTokens, 'Top Tokens (last block)');
  }
}

// Hotkey controls
document.addEventListener('keydown', (e) => {
  // Particle shapes (1-5)
  if (e.key === '1') {
    currentShape = 'cube';
    scene.setParticleShape(currentShape);
    hud.showNotification('Shape: Cube', 1000);
  }
  if (e.key === '2') {
    currentShape = 'octahedron';
    scene.setParticleShape(currentShape);
    hud.showNotification('Shape: Octahedron', 1000);
  }
  if (e.key === '3') {
    currentShape = 'tetrahedron';
    scene.setParticleShape(currentShape);
    hud.showNotification('Shape: Tetrahedron', 1000);
  }
  if (e.key === '4') {
    currentShape = 'sphere';
    scene.setParticleShape(currentShape);
    hud.showNotification('Shape: Sphere', 1000);
  }
  if (e.key === '5') {
    currentShape = 'torus';
    scene.setParticleShape(currentShape);
    hud.showNotification('Shape: Torus', 1000);
  }

  // Focus modes
  if (e.key.toLowerCase() === 'f') {
    currentMode = 'free';
    scene.setFocusMode(currentMode);
    hud.updateMode('free');
    hud.showNotification('Mode: Free', 1000);
  }
  if (e.key.toLowerCase() === 'p') {
    currentMode = 'program';
    scene.setFocusMode(currentMode);
    hud.updateMode('program');
    hud.showNotification('Mode: Program', 1000);
  }
  if (e.key.toLowerCase() === 't') {
    currentMode = 'token';
    scene.setFocusMode(currentMode);
    hud.updateMode('token');
    hud.showNotification('Mode: Token', 1000);
  }
  if (e.key.toLowerCase() === 'v') {
    currentMode = 'volume';
    scene.setFocusMode(currentMode);
    hud.updateMode('volume');
    hud.showNotification('Mode: Volume', 1000);
  }

  // Size adjustment
  if (e.key === '+' || e.key === '=') {
    scene.adjustParticleSize(0.2);
    hud.showNotification('Size: +', 1000);
  }
  if (e.key === '-' || e.key === '_') {
    scene.adjustParticleSize(-0.2);
    hud.showNotification('Size: -', 1000);
  }

  // Leaderboard mode toggle
  if (e.key.toLowerCase() === 'l') {
    leaderboardMode = leaderboardMode === 'window' ? 'block' : 'window';
    const mode = leaderboardMode === 'window' ? '60s Window' : 'Last Block';
    hud.showNotification(`Leaderboards: ${mode}`, 2000);
    updateLeaderboards();
  }
});

// Utility
function formatNumber(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

// Set initial mode
scene.setParticleShape('cube');
scene.setFocusMode('volume');

console.log('🚀 Solana Block Visualizer initialized');
console.log('📝 Controls:');
console.log('  1-5: Change particle shape');
console.log('  F: Free mode | P: Program mode | T: Token mode | V: Volume mode');
console.log('  +/-: Adjust particle size');
console.log('  L: Toggle leaderboards (60s window / last block)');
