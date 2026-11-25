import { useSyncExternalStore } from 'react';
import type { Viewer } from '../viewer';

/**
 * Lien entre les champs Puck et l'aperçu 3D : les champs sur mesure (points,
 * gizmo, pointage, aperçus) accèdent au viewer créé par l'aperçu.
 */
let viewer: Viewer | null = null;
let gizmoKey: string | null = null;
let boundsWork: number | null = null;
/** Œuvres dont les champs sont affichés (dépliées), avec un compteur : Puck peut
 *  rendre un même champ deux fois. La dernière ouverte est l'œuvre active. */
const openWorks: number[] = [];
let activeWork: number | null = null;
/** Aperçu : largeur de bureau ou de téléphone (interface mobile du site). */
let device: 'desktop' | 'mobile' = 'desktop';
/** Sous-onglet ouvert pour chaque œuvre (Infos, Parcours, Points, Contenu). */
const workTabs = new Map<string, string>();
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
  /** Œuvre dont la boîte est en édition (poignées affichées). Puck peut rendre un
   *  même champ deux fois : l'état est donc partagé ici, pas dans le composant. */
  get boundsWork() {
    return boundsWork;
  },
  setBoundsWork(w: number | null) {
    boundsWork = w;
    notify();
  },
  /** À appeler au montage des champs d'une œuvre ; renvoie la fonction de démontage. */
  openWork(w: number) {
    openWorks.push(w);
    activeWork = w;
    notify();
    return () => {
      const k = openWorks.lastIndexOf(w);
      if (k >= 0) openWorks.splice(k, 1);
      activeWork = openWorks.length ? openWorks[openWorks.length - 1] : null;
      notify();
    };
  },
  get activeWork() {
    return activeWork;
  },
  workTab(id: string) {
    return workTabs.get(id) ?? 'infos';
  },
  setWorkTab(id: string, tab: string) {
    workTabs.set(id, tab);
    notify();
  },
  get device() {
    return device;
  },
  setDevice(d: 'desktop' | 'mobile') {
    device = d;
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
/** Œuvre dépliée dans la liste (repères affichés dans la 3D), ou null. */
export const useActiveWork = () => useSyncExternalStore(bridge.subscribe, () => activeWork);
/** Œuvre dont la boîte est en édition. */
export const useBoundsWork = () => useSyncExternalStore(bridge.subscribe, () => boundsWork);
/** Repère actuellement attaché au gizmo. */
export const useGizmoKey = () => useSyncExternalStore(bridge.subscribe, () => gizmoKey);
/** Largeur d'aperçu choisie dans l'en-tête. */
export const useDevice = () => useSyncExternalStore(bridge.subscribe, () => device);
/** Sous-onglet ouvert pour une œuvre. */
export const useWorkTab = (id: string) => useSyncExternalStore(bridge.subscribe, () => bridge.workTab(id));
