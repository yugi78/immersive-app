import { MathUtils, Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { TourConfig, TourWork } from '../config/types';
import { createLookAround } from './lookAround';
import { easeInOut, Path } from './path';

export type TourState = 'idle' | 'enter' | 'loop' | 'transit' | 'exit';

export interface TourStatus {
  state: TourState;
  /** Œuvre courante (ou visée pendant une transition), -1 hors visite. */
  index: number;
  work: TourWork | null;
  /** Pause demandée (bouton) ou automatique (rotation manuelle). */
  paused: boolean;
}

interface Phase {
  kind: Exclude<TourState, 'idle'>;
  path: Path;
  /** Durée en secondes (aller simple pour la boucle). */
  duration: number;
  elapsed: number;
  lookFrom: Vector3;
  lookTo: Vector3;
  /** Extrémité de la découpe au départ (entrée : cible d'orbite ; sortie : focus de l'œuvre). */
  cutFrom: Vector3;
  cutTo: Vector3;
}

export interface TourOptions {
  camera: PerspectiveCamera;
  dom: HTMLElement;
  /** Réglages courants (modifiables à chaud depuis le back-office). */
  config: () => TourConfig;
  /** Vue orbitale par défaut : retour en fin de visite. */
  home: () => { position: Vector3; target: Vector3 };
  /** Cible d'orbite actuelle (point de départ de la découpe à l'entrée). */
  orbitTarget: () => Vector3;
}

const v3 = (a: [number, number, number]) => new Vector3(a[0], a[1], a[2]);
const smoothstep = (a: number, b: number, x: number) => MathUtils.smoothstep(x, a, b);
const UP = new Vector3(0, 1, 0);
/** Vitesse de rattrapage de l'orientation (1/s) : continue, sans saut aux points. */
const TURN_RATE = 6;

/**
 * Visite guidée : entrée depuis l'orbite, boucle aller-retour sur les points
 * caméra de chaque œuvre, transitions par le point central, sortie vers l'orbite.
 * Position : spline Catmull-Rom + easing doux. Rotation : l'orientation suit en
 * continu un point visé interpolé (focus → focus), jamais de lookAt brutal.
 */
export function createTour(opts: TourOptions) {
  const { camera } = opts;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let phase: Phase | null = null;
  let index = -1;
  let manualPause = false;
  let interactPause = false;
  let lastInteract = 0;
  const listeners = new Set<(s: TourStatus) => void>();

  const look = createLookAround(opts.dom, () => {
    if (!phase) return;
    lastInteract = performance.now();
    if (!interactPause) {
      interactPause = true;
      emit();
    }
  });

  // Sorties lues chaque image par le viewer.
  const lookTarget = new Vector3();
  const cutTarget = new Vector3();
  let cutScale = 0;

  const works = () => opts.config().works;
  const ms = (v: number) => (reduced ? Math.min(v, 600) : v) / 1000;

  function status(): TourStatus {
    return { state: phase?.kind ?? 'idle', index, work: works()[index] ?? null, paused: manualPause || interactPause };
  }
  function emit() {
    const s = status();
    for (const l of listeners) l(s);
  }

  function workStart(w: TourWork) {
    return w.cameraPoints.length ? v3(w.cameraPoints[0]) : v3(w.focus);
  }

  function makePhase(kind: Phase['kind'], points: Vector3[], duration: number, look: [Vector3, Vector3], cut: [Vector3, Vector3]): Phase {
    return {
      kind,
      path: new Path(points),
      duration: Math.max(duration, 1e-3),
      elapsed: 0,
      lookFrom: look[0].clone(),
      lookTo: look[1].clone(),
      cutFrom: cut[0].clone(),
      cutTo: cut[1].clone(),
    };
  }

  function startLoop(w: TourWork) {
    const pts = w.cameraPoints.map(v3);
    const f = v3(w.focus);
    const n = Math.max(pts.length, 1);
    phase = makePhase('loop', pts.length ? pts : [f], ms(opts.config().durations.segmentMs) * (n - 1), [f, f], [f, f]);
  }

  /** Va à l'œuvre `i` depuis la position courante. */
  function goTo(i: number) {
    const list = works();
    if (!list.length) return;
    const target = ((i % list.length) + list.length) % list.length;
    const w = list[target];
    const cfg = opts.config();
    const pos = camera.position.clone();
    const focus = v3(w.focus);
    const from = phase ? lookTarget.clone() : opts.orbitTarget().clone();

    if (!phase || phase.kind === 'enter') {
      // Depuis l'orbite (ou une entrée en cours) : découpe active, son extrémité
      // glisse vers le focus de l'œuvre pendant que la caméra entre.
      const cutFrom = phase ? cutTarget.clone() : opts.orbitTarget().clone();
      phase = makePhase('enter', [pos, workStart(w)], ms(cfg.durations.enterMs), [from, focus], [cutFrom, focus]);
    } else if (phase.kind === 'exit') {
      return;
    } else {
      // Entre deux œuvres : par le point central, découpe éteinte.
      phase = makePhase('transit', [pos, v3(cfg.hub.position), workStart(w)], ms(cfg.durations.betweenMs), [from, focus], [focus, focus]);
    }
    index = target;
    interactPause = false;
    emit();
  }

  function stop() {
    if (!phase || phase.kind === 'exit') return;
    const h = opts.home();
    const focus = lookTarget.clone();
    phase = makePhase('exit', [camera.position.clone(), h.position], ms(opts.config().durations.exitMs), [focus, h.target], [focus, h.target]);
    manualPause = false;
    interactPause = false;
    emit();
  }

  const qDesired = new Quaternion();
  const qOffset = new Quaternion();
  const mLook = new Matrix4();
  const tmp = new Vector3();

  /** Avance la visite ; renvoie true quand la sortie est terminée (rendre la main à l'orbite). */
  function update(dt: number): boolean {
    if (!phase) return false;
    const cfg = opts.config();

    // Reprise automatique après une rotation manuelle.
    if (interactPause && !look.dragging && performance.now() - lastInteract > cfg.resumeDelayMs) {
      interactPause = false;
      emit();
    }
    const paused = manualPause || interactPause;
    if (!paused) {
      phase.elapsed += dt;
      look.relax(dt);
    }

    let finished = false;
    if (phase.kind === 'loop') {
      // Aller-retour 1→n→1, ralenti seulement aux extrémités.
      const pass = Math.floor(phase.elapsed / phase.duration);
      const f = (phase.elapsed % phase.duration) / phase.duration;
      const u = reduced ? 0 : pass % 2 === 0 ? easeInOut(f) : 1 - easeInOut(f);
      phase.path.at(u, camera.position);
      lookTarget.copy(phase.lookTo);
      cutScale = 0;
    } else {
      const t = Math.min(phase.elapsed / phase.duration, 1);
      const e = easeInOut(t);
      phase.path.at(e, camera.position);
      lookTarget.lerpVectors(phase.lookFrom, phase.lookTo, e);
      cutTarget.lerpVectors(phase.cutFrom, phase.cutTo, e);
      if (phase.kind === 'enter') cutScale = 1 - smoothstep(cfg.cutFadeStart, 1, e);
      else if (phase.kind === 'exit') cutScale = smoothstep(0, 1 - cfg.cutFadeStart, e);
      else cutScale = 0;

      if (t >= 1) {
        if (phase.kind === 'exit') {
          phase = null;
          index = -1;
          look.reset();
          look.state.enabled = false;
          finished = true;
          emit();
        } else {
          startLoop(works()[index]);
          emit();
        }
      }
    }

    // Orientation : vise lookTarget (+ décalage du regard libre), rattrapée en douceur.
    mLook.lookAt(camera.position, lookTarget, UP);
    qDesired.setFromRotationMatrix(mLook);
    qOffset.setFromAxisAngle(UP, look.state.yaw);
    qDesired.premultiply(qOffset);
    qOffset.setFromAxisAngle(tmp.set(1, 0, 0), look.state.pitch);
    qDesired.multiply(qOffset);
    if (finished) camera.quaternion.copy(qDesired);
    else camera.quaternion.slerp(qDesired, 1 - Math.exp(-TURN_RATE * dt));
    camera.updateMatrixWorld();
    return finished;
  }

  return {
    get active() {
      return phase !== null;
    },
    get state() {
      return phase?.kind ?? 'idle';
    },
    lookTarget,
    cutTarget,
    get cutScale() {
      return cutScale;
    },
    status,
    update,
    /** Destination à précharger en haute définition (position + point visé), ou null. */
    lookahead(): { position: Vector3; target: Vector3 } | null {
      if (!phase || phase.kind === 'exit') return null;
      const w = works()[index];
      if (!w) return null;
      const pts = w.cameraPoints;
      // En boucle : l'autre extrémité du parcours ; sinon le premier point de l'œuvre visée.
      const p = phase.kind === 'loop' && pts.length > 1 ? v3(pts[pts.length - 1]) : workStart(w);
      return { position: p, target: v3(w.focus) };
    },
    start(i = 0) {
      look.state.enabled = true;
      manualPause = false;
      goTo(i);
    },
    goTo,
    next() {
      if (phase) goTo(index + 1);
    },
    prev() {
      if (phase) goTo(index - 1);
    },
    stop,
    togglePause() {
      if (!phase || phase.kind === 'exit') return;
      if (interactPause) interactPause = false;
      else manualPause = !manualPause;
      emit();
    },
    onChange(l: (s: TourStatus) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** Fin de visite immédiate (sans animation), ex. avant un aperçu dans l'éditeur. */
    cancel() {
      phase = null;
      index = -1;
      look.reset();
      look.state.enabled = false;
      emit();
    },
    dispose() {
      look.dispose();
      listeners.clear();
    },
  };
}

export type Tour = ReturnType<typeof createTour>;
