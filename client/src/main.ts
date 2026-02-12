import { SceneManager } from './core/SceneManager';
import { DataProcessor } from './data/DataProcessor';
import { BlockVisualization } from './visualizations/BlockVisualization';
import { FrequencyBars } from './visualizations/FrequencyBars';
import { WaveformHorizon } from './visualizations/WaveformHorizon';
import { TokenGalaxy } from './visualizations/TokenGalaxy';
import { LightningNetwork } from './visualizations/LightningNetwork';
import { VRTunnel } from './visualizations/VRTunnel';
import { HeatmapGrid } from './visualizations/HeatmapGrid';
import { ParticleNebula } from './visualizations/ParticleNebula';
import { DoubleSidedEQ } from './visualizations/DoubleSidedEQ';
import { StackedBars3D } from './visualizations/StackedBars3D';
import { TradeStream } from './visualizations/TradeStream';
import { NyanTrade } from './visualizations/NyanTrade';
import { ECGMonitor } from './visualizations/ECGMonitor';
import { EconomicPulse } from './visualizations/EconomicPulse';
import { BlockStack3D } from './visualizations/BlockStack3D';
import { RevenueTracker } from './visualizations/RevenueTracker';
import { VolumeFlow } from './visualizations/VolumeFlow';
import { HUD } from './hud/HUD';
import { Legend } from './hud/Legend';
import { PanelManager } from './hud/PanelManager';
import { createSceneGestureHandler } from './utils/TouchGestureHandler';
import type { WSMessage, BlockMessage } from '../../shared/types';
import type { FocusMode, ParticleShape } from './types';

// Initialize DataProcessor and SceneManager
const container = document.getElementById('canvas-container')!;
const dataProcessor = new DataProcessor();
const sceneManager = new SceneManager(container, dataProcessor);
const hud = new HUD();
const legend = new Legend();
const panelManager = new PanelManager();

// Wire up camera offset for mobile bottom sheet
panelManager.setOnCameraOffset((offsetY) => {
  sceneManager.setCameraOffset(offsetY);
});

// Helper to update legend when scene changes
function updateLegendForScene() {
  const activeScene = sceneManager.getActiveScene();
  if (activeScene && activeScene.getLegend) {
    const items = activeScene.getLegend();
    legend.update(items);
  }
}

// Expose sceneManager globally for Playwright visual tests
declare global {
  interface Window {
    sceneManager: SceneManager;
  }
}
(window as any).sceneManager = sceneManager;

// Register visualizations
sceneManager.registerScene('blocks', () => new BlockVisualization());
sceneManager.registerScene('frequency', () => new FrequencyBars());
sceneManager.registerScene('waveform', () => new WaveformHorizon());
sceneManager.registerScene('galaxy', () => new TokenGalaxy());
sceneManager.registerScene('lightning', () => new LightningNetwork());
sceneManager.registerScene('tunnel', () => new VRTunnel());
sceneManager.registerScene('heatmap', () => new HeatmapGrid());
sceneManager.registerScene('nebula', () => new ParticleNebula());
sceneManager.registerScene('doublesidedeq', () => new DoubleSidedEQ());
sceneManager.registerScene('stackedbars', () => new StackedBars3D());
sceneManager.registerScene('tradestream', () => new TradeStream());
sceneManager.registerScene('nyantrade', () => new NyanTrade());
sceneManager.registerScene('ecg', () => new ECGMonitor());
sceneManager.registerScene('pulse', () => new EconomicPulse());
sceneManager.registerScene('blockstack', () => new BlockStack3D());
sceneManager.registerScene('revenue', () => new RevenueTracker());
sceneManager.registerScene('volumeflow', () => new VolumeFlow());

// Start with blocks visualization
sceneManager.switchScene('blocks');

// Initialize touch gesture handler for mobile scene navigation
const touchGestureHandler = createSceneGestureHandler(
  container,
  () => {
    // Swipe right -> previous scene
    sceneManager.previousScene();
    updateLegendForScene();
    hud.showNotification(`Scene: ${sceneManager.getActiveSceneName()}`, 2000);
  },
  () => {
    // Swipe left -> next scene
    sceneManager.nextScene();
    updateLegendForScene();
    hud.showNotification(`Scene: ${sceneManager.getActiveSceneName()}`, 2000);
  },
  () => {
    // Swipe up -> open bottom sheet
    panelManager.showSheet('half');
  }
);

// Update legend on initial load
updateLegendForScene();

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
let latestTokenNames: Record<string, string> = {};
let latestTokenImages: Record<string, string> = {};

// Handle worker messages
worker.onmessage = (event) => {
  const { type, data } = event.data;

  if (type === 'connected') {
    hud.showNotification('Connected to Solana stream', 2000);
  }

  if (type === 'disconnected') {
    hud.showNotification('Disconnected - reconnecting...', 2000);
  }

  if (type === 'ws_message') {
    handleWSMessage(data);
  }
};

function handleWSMessage(message: WSMessage) {
  // Now we only handle 'block' messages - trades are bundled inside
  if (message.type === 'block') {
    const block = message as BlockMessage;

    // Process block data FIRST - creates the new forming block so trades
    // and tx-type particles all spawn into the same block
    dataProcessor.processBlock(block);
    hud.updateBlockData(block);
    hud.updateCurrentSlot(block.slot);

    // Process bundled trades AFTER block (forming block now exists for this slot)
    if (block.trades && block.trades.length > 0) {
      for (const trade of block.trades) {
        dataProcessor.processTrade(trade);
        tradesThisSecond++;
        volumeThisSecond += trade.vu;

        // Show notification for mega trades
        if (trade.vu > 1000000) {
          const a = latestTokenNames[trade.ta] || trade.ta;
          const b = latestTokenNames[trade.tb] || trade.tb;
          hud.showNotification(
            `Mega Trade: ${a}/${b} $${(trade.vu / 1000000).toFixed(2)}M`,
            3000
          );
        }
      }
    }
    currentSlot = block.slot;

    // Accumulate token metadata from server (persists across blocks)
    if (block.tokenNames) {
      latestTokenNames = { ...latestTokenNames, ...block.tokenNames };
    }
    if (block.tokenImages) {
      latestTokenImages = { ...latestTokenImages, ...block.tokenImages };
    }

    // Update top programs and tokens leaderboards
    const programVolumes = dataProcessor.getProgramVolumes();
    const tokenVolumes = dataProcessor.getTokenVolumes();
    hud.updateProgramStats(Object.fromEntries(programVolumes));
    hud.updateTokenStats(Object.fromEntries(tokenVolumes), undefined, latestTokenNames);

    // Add block log entry
    hud.addBlockLogEntry(block.slot, block.trades?.length || 0, block.swapVolumeUsd);

    // Update SPS display every second
    const now = Date.now();
    if (now - lastTpsUpdate > 1000) {
      hud.updateSPS(tradesThisSecond);
      hud.addChartDataPoint(tradesThisSecond, volumeThisSecond);
      tradesThisSecond = 0;
      volumeThisSecond = 0;
      lastTpsUpdate = now;
    }
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

  // Scene switching
  if (e.key === '[') {
    sceneManager.previousScene();
    updateLegendForScene();
    hud.showNotification(`Scene: ${sceneManager.getActiveSceneName()}`, 2000);
  }
  if (e.key === ']') {
    sceneManager.nextScene();
    updateLegendForScene();
    hud.showNotification(`Scene: ${sceneManager.getActiveSceneName()}`, 2000);
  }

  // Legend toggle (L key)
  if (e.key.toLowerCase() === 'l') {
    updateLegendForScene();
    const visible = legend.toggle();
    hud.showNotification(visible ? 'Legend: ON' : 'Legend: OFF', 1000);
  }

  // Auto-cycle toggle
  if (e.key.toLowerCase() === 'a') {
    const isAutoCycling = !(sceneManager as any).autoCycle;
    sceneManager.setAutoCycle(isAutoCycling, 30000);
    hud.showNotification(isAutoCycling ? 'Auto-cycle: ON' : 'Auto-cycle: OFF', 2000);
  }

  // Chart mode toggle
  if (e.key.toLowerCase() === 'c') {
    hud.showNotification('Charts toggled', 2000);
  }

  // Vote particles toggle (G for Golden votes)
  if (e.key.toLowerCase() === 'g') {
    const scene = sceneManager.getActiveScene();
    if (scene && 'toggleVoteParticles' in scene) {
      const showVotes = (scene as any).toggleVoteParticles();
      hud.showNotification(showVotes ? 'Vote particles: ON' : 'Vote particles: OFF', 2000);
    }
  }

  // Bloom toggle (B key)
  if (e.key.toLowerCase() === 'b') {
    const scene = sceneManager.getActiveScene();
    if (scene && 'toggleBloom' in scene) {
      const bloomEnabled = (scene as any).toggleBloom();
      hud.showNotification(bloomEnabled ? 'Bloom: ON' : 'Bloom: OFF', 2000);
    }
  }
});

// Set initial mode for BlockVisualization
const initialScene = sceneManager.getActiveScene();
if (initialScene?.setParticleShape) initialScene.setParticleShape('cube');
if (initialScene?.setFocusMode) initialScene.setFocusMode('volume');
