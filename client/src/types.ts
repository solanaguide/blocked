import * as THREE from 'three';

export type FocusMode = 'free' | 'program' | 'token' | 'volume';
export type ParticleShape = 'cube' | 'octahedron' | 'tetrahedron' | 'sphere' | 'torus';

export interface Particle {
  id: string;
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
}

export interface BlockData {
  slot: number;
  trades: number;
  volume: number;
  timestamp: number;
  particles: Particle[];
}
