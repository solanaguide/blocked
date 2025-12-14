# SOLANA BLOCKS LIVE

Real-time 3D visualization of Solana blocks being built, with vaporwave/outrun aesthetic.

## Features

- **Real-time Trade Visualization**: Trades fly in as 3D particles toward the center
- **Block Formation**: Dramatic block assembly and explosion animations every 350ms
- **Multiple Particle Shapes**: Cube, Octahedron, Tetrahedron, Sphere, Torus (hotkey switchable)
- **Focus Modes**: Color/size by Volume, Program, Token, or Free mode
- **Vaporwave Aesthetic**: Neon grid, gradient backgrounds, 1980s outrun vibes
- **Live Stats & Charts**: Real-time HUD with volume, TPS, program/token leaderboards

## Architecture

```
Redis PubSub (trade:executed)
  → WebSocket Server (50ms batching)
    → Web Worker (data processing)
      → Main Thread (Three.js + D3.js rendering)
```

## Installation

```bash
npm install
```

## Running

Make sure your Redis indexer is running on port 16379, then:

```bash
npm run dev
```

This will start:
- WebSocket server on `ws://localhost:8080/ws`
- Client dev server on `http://localhost:3000`

## Controls

| Key | Action |
|-----|--------|
| `1-5` | Switch particle shape |
| `F` | Free mode (white particles) |
| `P` | Program mode (color by DEX) |
| `T` | Token mode (color by token) |
| `V` | Volume mode (heat map) |
| `+/-` | Adjust particle size |

## Performance

- Target: 60fps with 2000-5000 active particles
- Network: ~50 KB/s (50ms batching + compression)
- Instanced rendering for optimal GPU usage
- Web Worker for off-thread data processing

## Data Flow

1. **Redis PubSub** sends `trade:executed` messages
2. **WebSocket Server** batches trades every 50ms and strips unnecessary fields
3. **Web Worker** receives batches and forwards to main thread
4. **Particle System** spawns particles with instanced rendering
5. **Block Builder** creates dramatic block formation/explosion every 350ms
6. **HUD** updates stats, charts, and leaderboards in real-time

## Tech Stack

- **Backend**: Node.js, Express, ws, ioredis
- **Frontend**: Three.js, D3.js, TypeScript, Vite
- **Rendering**: Instanced meshes, custom shaders, post-processing

## Customization

### Colors

Edit program/token colors in `client/src/scene/ParticleSystem.ts`:

```typescript
private programColors: Map<string, number> = new Map([
  ['JUP', 0xb026ff],  // Change Jupiter color
  ...
]);
```

### Block Duration

Adjust in `server/config.ts`:

```typescript
batchInterval: 50  // ms between batches
```

### Particle Lifetime

Edit in `client/src/scene/ParticleSystem.ts`:

```typescript
maxLifetime: 5000  // 5 seconds
```

## Development

```bash
npm run dev:server  # Start WebSocket server only
npm run dev:client  # Start Vite dev server only
npm run build       # Build for production
```

## Troubleshooting

**No trades appearing?**
- Check Redis is running on port 16379
- Verify indexer is publishing to `trade:executed` channel
- Open browser console for connection status

**Low FPS?**
- Press `-` to reduce particle size
- Lower maxInstances in ParticleSystem.ts
- Check GPU usage in browser DevTools

**WebSocket not connecting?**
- Check server is running on port 8080
- Verify no firewall blocking WebSocket connections
- Check browser console for errors

## License

MIT
