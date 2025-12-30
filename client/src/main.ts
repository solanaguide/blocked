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
let lastTpsUpdate = Date.now();

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

    // Update TPS every second
    const now = Date.now();
    if (now - lastTpsUpdate > 1000) {
      hud.updateTPS(tradesThisSecond);
      tradesThisSecond = 0;
      lastTpsUpdate = now;
    }
  }

  if (message.type === 'block_complete') {
    const block = message as BlockCompleteMessage;
    console.log(`Block ${block.slot} complete: ${block.trades} trades, $${block.volume.toFixed(2)}`);

    hud.updateBlockStats(block.trades, block.volume);

    hud.showNotification(
      `Block ${block.slot} | ${block.trades} trades | $${formatNumber(block.volume)}`,
      2000
    );
  }

  if (message.type === 'stats') {
    const stats = message as StatsMessage;

    // Update program leaderboard
    hud.updateProgramStats(stats.window.programs);

    // Update token stats (would need to track in server)
    // For now, just show placeholder
  }
}

// Hotkey controls
document.addEventListener('keydown', (e) => {
  // Particle shapes (1-5)
  // if (e.key === '1') {
  //   currentShape = 'cube';
  //   // scene.setParticleShape(currentShape);
  //   hud.showNotification('Shape: Cube', 1000);
  // }
  // if (e.key === '2') {
  //   currentShape = 'octahedron';
  //   // scene.setParticleShape(currentShape);
  //   hud.showNotification('Shape: Octahedron', 1000);
  // }
  // if (e.key === '3') {
  //   currentShape = 'tetrahedron';
  //   // scene.setParticleShape(currentShape);
  //   hud.showNotification('Shape: Tetrahedron', 1000);
  // }
  // if (e.key === '4') {
  //   currentShape = 'sphere';
  //   // scene.setParticleShape(currentShape);
  //   hud.showNotification('Shape: Sphere', 1000);
  // }
  // if (e.key === '5') {
  //   currentShape = 'torus';
  //   // scene.setParticleShape(currentShape);
  //   hud.showNotification('Shape: Torus', 1000);
  // }

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
});

// Utility
function formatNumber(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

// Set initial mode
// scene.setParticleShape('cube');
scene.setFocusMode('volume');

console.log('🚀 Solana Block Visualizer initialized');
console.log('📝 Controls:');
console.log('  1-5: Change particle shape');
console.log('  F: Free mode | P: Program mode | T: Token mode | V: Volume mode');
console.log('  +/-: Adjust particle size');
