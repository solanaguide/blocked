import * as THREE from 'three';

export type FocusMode = 'free' | 'program' | 'token' | 'volume';
export type ParticleShape = 'cube' | 'octahedron' | 'tetrahedron' | 'sphere' | 'torus';
export type TxType = 'vote' | 'completed' | 'reverted' | 'jito' | 'trade';

export interface Particle {
  id: string;
  slot: number;  // Which slot/block does this particle belong to?
  mesh: THREE.InstancedMesh;
  instanceId: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  size: number;
  color: THREE.Color;
  rotation: THREE.Euler;
  rotationSpeed: THREE.Vector3;
  lifetime: number;
  maxLifetime: number;
  trade: import('../../shared/types').TradeMessage;
  locked: boolean;  // Is this particle locked into a block?
  lockedPosition: THREE.Vector3;  // Grid position when locked
}

export interface BlockData {
  slot: number;
  trades: number;
  volume: number;
  timestamp: number;
  particles: Particle[];
}
