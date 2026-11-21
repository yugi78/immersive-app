import { useSyncExternalStore } from 'react';
import type { Viewer } from '../viewer';

/**
 * Lien entre les champs Puck et l'aperçu 3D : les champs sur mesure (points,
 * gizmo, pointage, aperçus) accèdent au viewer créé par l'aperçu.
 */
let viewer: Viewer | null = null;
let gizmoKey: string | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const bridge = {
  get viewer() {
    return viewer;
  },
  setViewer(v: Viewer | null) {
    viewer = v;
    // Inspection depuis la console du navigateur (back-office, dev uniquement).
    Object.assign(window, { __adminViewer: v });
    gizmoKey = null;
    notify();
  },
  get gizmoKey() {
    return gizmoKey;
  },
  setGizmoKey(k: string | null) {
    gizmoKey = k;
    notify();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** Viewer courant (null tant que l'aperçu charge). */
export const useViewer = () => useSyncExternalStore(bridge.subscribe, () => viewer);
/** Repère actuellement attaché au gizmo. */
export const useGizmoKey = () => useSyncExternalStore(bridge.subscribe, () => gizmoKey);
