import { SceneManager } from './core/SceneManager';
import { DataProcessor } from './data/DataProcessor';
import { BlockVisualization } from './visualizations/BlockVisualization';
import { FrequencyBars } from './visualizations/FrequencyBars';
import { WaveformHorizon } from './visualizations/WaveformHorizon';
import { HUD } from './hud/HUD';
import type { WSMessage, BatchMessage, BlockCompleteMessage, StatsMessage } from '../../shared/types';
import type { FocusMode, ParticleShape } from './types';

// Initialize DataProcessor and SceneManager
const container = document.getElementById('canvas-container')!;
const dataProcessor = new DataProcessor(50); // 50ms grace period
const sceneManager = new SceneManager(container, dataProcessor);
const hud = new HUD();

// Register visualizations
sceneManager.registerScene('blocks', () => new BlockVisualization());
sceneManager.registerScene('frequency', () => new FrequencyBars());
sceneManager.registerScene('waveform', () => new WaveformHorizon());

// Start with blocks visualization
sceneManager.switchScene('blocks');

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
let leaderboardMode: 'window' | 'block' = 'block'; // Toggle between 60s window and last block
let chartMode: 'persecond' | 'perblock' = 'persecond'; // Toggle between per-second and per-block charts

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

    // Process trades through DataProcessor
    for (const trade of batch.batch) {
      dataProcessor.processTrade(trade);
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

    // Update SPS and charts every second
    const now = Date.now();
    if (now - lastTpsUpdate > 1000) {
      hud.updateSPS(tradesThisSecond);

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

    // Add to block log instead of showing notification
    hud.addBlockLogEntry(block.slot, block.trades, block.volume);
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
  const activeScene = sceneManager.getActiveScene();

  // Particle shapes (1-5)
  if (e.key === '1') {
    currentShape = 'cube';
    if (activeScene?.setParticleShape) activeScene.setParticleShape(currentShape);
    hud.showNotification('Shape: Cube', 1000);
  }
  if (e.key === '2') {
    currentShape = 'octahedron';
    if (activeScene?.setParticleShape) activeScene.setParticleShape(currentShape);
    hud.showNotification('Shape: Octahedron', 1000);
  }
  if (e.key === '3') {
    currentShape = 'tetrahedron';
    if (activeScene?.setParticleShape) activeScene.setParticleShape(currentShape);
    hud.showNotification('Shape: Tetrahedron', 1000);
  }
  if (e.key === '4') {
    currentShape = 'sphere';
    if (activeScene?.setParticleShape) activeScene.setParticleShape(currentShape);
    hud.showNotification('Shape: Sphere', 1000);
  }
  if (e.key === '5') {
    currentShape = 'torus';
    if (activeScene?.setParticleShape) activeScene.setParticleShape(currentShape);
    hud.showNotification('Shape: Torus', 1000);
  }

  // Focus modes
  if (e.key.toLowerCase() === 'f') {
    currentMode = 'free';
    if (activeScene?.setFocusMode) activeScene.setFocusMode(currentMode);
    hud.updateMode('free');
    hud.showNotification('Mode: Free', 1000);
  }
  if (e.key.toLowerCase() === 'p') {
    currentMode = 'program';
    if (activeScene?.setFocusMode) activeScene.setFocusMode(currentMode);
    hud.updateMode('program');
    hud.showNotification('Mode: Program', 1000);
  }
  if (e.key.toLowerCase() === 't') {
    currentMode = 'token';
    if (activeScene?.setFocusMode) activeScene.setFocusMode(currentMode);
    hud.updateMode('token');
    hud.showNotification('Mode: Token', 1000);
  }
  if (e.key.toLowerCase() === 'v') {
    currentMode = 'volume';
    if (activeScene?.setFocusMode) activeScene.setFocusMode(currentMode);
    hud.updateMode('volume');
    hud.showNotification('Mode: Volume', 1000);
  }

  // Size adjustment
  if (e.key === '+' || e.key === '=') {
    if (activeScene?.adjustParticleSize) activeScene.adjustParticleSize(0.2);
    hud.showNotification('Size: +', 1000);
  }
  if (e.key === '-' || e.key === '_') {
    if (activeScene?.adjustParticleSize) activeScene.adjustParticleSize(-0.2);
    hud.showNotification('Size: -', 1000);
  }

  // Scene switching (NEW!)
  if (e.key === '[') {
    sceneManager.previousScene();
    hud.showNotification(`Scene: ${sceneManager.getActiveSceneName()}`, 2000);
  }
  if (e.key === ']') {
    sceneManager.nextScene();
    hud.showNotification(`Scene: ${sceneManager.getActiveSceneName()}`, 2000);
  }

  // Auto-cycle toggle (NEW!)
  if (e.key.toLowerCase() === 'a') {
    const isAutoCycling = !(sceneManager as any).autoCycle;
    sceneManager.setAutoCycle(isAutoCycling, 30000);
    hud.showNotification(isAutoCycling ? 'Auto-cycle: ON' : 'Auto-cycle: OFF', 2000);
  }

  // Leaderboard mode toggle
  if (e.key.toLowerCase() === 'l') {
    leaderboardMode = leaderboardMode === 'window' ? 'block' : 'window';
    const mode = leaderboardMode === 'window' ? '60s Window' : 'Last Block';
    hud.showNotification(`Leaderboards: ${mode}`, 2000);
    updateLeaderboards();
  }

  // Chart mode toggle
  if (e.key.toLowerCase() === 'c') {
    chartMode = chartMode === 'persecond' ? 'perblock' : 'persecond';
    const mode = chartMode === 'persecond' ? 'Per Second' : 'Per Block';
    hud.showNotification(`Charts: ${mode}`, 2000);
    hud.setChartMode(chartMode);
  }
});

// Utility
function formatNumber(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

// Set initial mode for BlockVisualization
const initialScene = sceneManager.getActiveScene();
if (initialScene?.setParticleShape) initialScene.setParticleShape('cube');
if (initialScene?.setFocusMode) initialScene.setFocusMode('volume');

console.log('🚀 Solana Block Visualizer initialized');
console.log('📝 Controls:');
console.log('  1-5: Change particle shape');
console.log('  F: Free mode | P: Program mode | T: Token mode | V: Volume mode');
console.log('  +/-: Adjust particle size');
console.log('  L: Toggle leaderboards (60s window / last block)');
console.log('  C: Toggle charts (per second / per block)');
console.log('  [/]: Previous/Next visualization scene');
console.log('  A: Toggle auto-cycle');
