# Multi-Scene Architecture Refactoring Plan

## Executive Summary

Refactor the current monolithic visualization into a Winamp-style multi-scene architecture with hot-swappable visualizations.

**Current State**: Single scene with tightly coupled data processing and rendering
**Target State**: Multiple independent visualizations with shared data layer

---

## Key Problems with Current Architecture

1. **Scene owns everything**: Camera, renderer, animation loop, data processing all in one class
2. **No separation**: Business logic (slot detection, grace period) mixed with rendering
3. **Cannot swap**: Switching visualizations would require complete reload
4. **Tightly coupled**: ParticleSystem and BlockBuilder bound to Scene
5. **HUD is hardcoded**: Different visualizations can't have different HUD layouts

---

## Proposed Architecture Overview

```
Data Flow:
WebSocket → DataProcessor → SceneManager → Active Visualization
                         └→ HUDManager → Scene-specific HUD
```

### Core Components

1. **DataProcessor** (NEW): Handles all WebSocket logic, slot detection, grace period
2. **SceneManager** (NEW): Manages scene registry, hot-swapping, auto-cycling
3. **IVisualization** (NEW): Interface all scenes implement
4. **BaseVisualization** (NEW): Abstract base class with THREE.js setup
5. **HUDManager** (NEW): Scene-aware HUD controller

---

## Migration Strategy (7 Phases)

### Phase 1: Extract Data Processing ✅ **COMPLETE**
**Goal**: Separate data logic without breaking current scene
- ✅ Created DataProcessor.ts with slot detection, grace period, trade buffering
- ✅ Updated Scene.ts to use DataProcessor
- ✅ DataProcessor handles all slot tracking and timing logic

### Phase 2: Create Base Abstractions ✅ **COMPLETE**
**Goal**: Build foundation in parallel
- ✅ Created IVisualization interface with lifecycle methods
- ✅ Created IHUDConfig interface for scene-specific HUD
- ✅ Created BaseVisualization abstract class with THREE.js setup
- ✅ Created SceneManager for registration and hot-swapping

### Phase 3: Refactor to BlockVisualization ✅ **COMPLETE**
**Goal**: Convert Scene.ts to new architecture
- ✅ Created BlockVisualization extending BaseVisualization
- ✅ Ported all rendering logic from Scene.ts
- ✅ Implements particle falling, block building, sweeping

### Phase 4: Switch to SceneManager ✅ **COMPLETE**
**Goal**: Use new architecture in main.ts
- ✅ Replaced Scene with SceneManager in main.ts
- ✅ Registered BlockVisualization as 'blocks' scene
- ✅ Updated hotkeys to use active scene
- ✅ Added [ and ] keys for scene switching
- ✅ Added A key for auto-cycle toggle

### Phase 5: Add HUDManager (Optional) ⚡
**Goal**: Make HUD scene-aware
- HUD panels adapt to active scene
- Each scene declares its HUD needs

### Phase 6: Second Visualization 🎯
**Goal**: Prove architecture works
- Create WinampVisualization (or another)
- Test hot-swapping between scenes

### Phase 7: Cleanup & Polish 🧹
**Goal**: Remove old code
- Delete old Scene.ts
- Add auto-cycle feature
- Document architecture

---

## New Directory Structure

```
client/src/
├── core/                          # Core abstractions
│   ├── IVisualization.ts
│   ├── BaseVisualization.ts
│   └── SceneManager.ts
│
├── data/                          # Data processing layer
│   └── DataProcessor.ts
│
├── visualizations/                # All visualizations
│   ├── BlockVisualization.ts
│   ├── WinampVisualization.ts
│   ├── configs/                   # HUD configs
│   └── shared/                    # Shared utilities
│       ├── ParticleSystem.ts
│       ├── BlockBuilder.ts
│       └── Environment.ts
│
├── hud/                           # Scene-aware HUD
│   ├── HUD.ts
│   └── HUDManager.ts
│
└── main.ts                        # Orchestrator
```

---

## Key Benefits

✅ **Hot-swappable scenes** - Switch visualizations without reload
✅ **Independent development** - Add scenes without touching existing code
✅ **Data/rendering separation** - Clean architecture
✅ **Scene-specific HUDs** - Each scene declares its UI needs
✅ **Auto-cycling** - Screensaver mode
✅ **Testability** - Isolated scenes, mockable data

---

## How to Add a New Visualization

```typescript
// 1. Create MyVisualization.ts
export class MyVisualization extends BaseVisualization {
  getName() { return 'My Viz'; }

  onTrade(trade, slot) {
    // Your custom rendering
  }

  // ... implement other methods
}

// 2. Register in main.ts
sceneManager.registerScene('my-viz', () => new MyVisualization());
```

That's it! 🎉

---

## Next Steps

1. Review this plan
2. Start with Phase 1 (extract DataProcessor)
3. Incrementally refactor without breaking existing functionality
4. Each phase can be tested independently

---

## Success Criteria

- [ ] Can switch between 2+ visualizations with hotkey
- [ ] No data loss during scene switching
- [ ] Each scene is isolated (editing one doesn't break another)
- [ ] Auto-cycle mode works
- [ ] HUD adapts to active scene
- [ ] Can add new visualizations easily
