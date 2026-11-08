// Sahne modülleri arasında paylaşılan tipler. React bileşeni yalnız SceneDom, SceneOptions ve SceneApi'yi görür.
import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Kit } from './sceneKit';
import type { MovingParts, StationId } from './sceneStations';
import type { SceneTextures } from './sceneTextures';

export type { StationId };
export type SceneMode = 'assembled' | 'cutaway' | 'stations' | 'order';
export type SceneDom = {
  host: HTMLElement; canvasHost: HTMLElement; labels: HTMLElement; tooltip: HTMLElement; tooltipTitle: HTMLElement; tooltipText: HTMLElement;
};
export type SceneOptions = { embedded: boolean; onModeChange?: (mode: SceneMode) => void; onReady?: () => void; onStage?: (stage: number) => void };
export type SceneApi = { setMode: (mode: SceneMode, instant?: boolean) => void; focusStation: (id: StationId) => void; dispose: () => void };

export type StationDef = { id: StationId; name: string; step: number; output: string; pos: [number, number, number]; desc: string };
export type Station = StationDef & {
  order: number; group: THREE.Group; base: THREE.Vector3; glowMat: THREE.MeshStandardMaterial; label: HTMLDivElement; anchor: THREE.Vector3;
};
export type Ripple = { mesh: THREE.Mesh; age: number };
export type Packet = { group: THREE.Group; faces: THREE.Mesh[]; halo: THREE.Mesh; stage: number; phase: number };

export type LoopContext = {
  dom: SceneDom; opts: SceneOptions; renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  kit: Kit; T: SceneTextures; A: MovingParts; stations: Station[]; packets: Packet[]; path: THREE.CatmullRomCurve3; belt: THREE.Group; pipes: THREE.Group;
  updateBelt: (t: number) => void; at: (id: StationId) => THREE.Vector3; depoU: number; kasaU: number; bulutU: number;
  reduceMotion: boolean; embedded: boolean; W: () => number; H: () => number;
  ripples: Ripple[]; listen: (t: EventTarget, type: string, fn: (e: never) => void) => void; cleanups: Array<() => void>; env: THREE.WebGLRenderTarget;
};
