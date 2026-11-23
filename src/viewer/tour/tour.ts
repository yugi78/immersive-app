import { MathUtils, Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TourBounds, TourConfig, TourWork } from '../config/types';
import { easeInOut, Path } from './path';

export type TourState = 'idle' | 'enter' | 'loop' | 'transit' | 'exit';

export interface TourStatus {
  state: TourState;
  /** Œuvre courante (ou visée pendant une transition), -1 hors visite. */
  index: number;
  work: TourWork | null;
  /** Pause demandée (bouton) ou prise en main de la caméra. */
  paused: boolean;
  /** L'utilisateur tourne librement autour de l'œuvre (interface masquée). */
  userControl: boolean;
}

interface Phase {
  kind: Exclude<TourState, 'idle'>;
  path: Path;
  /** Durée en secondes (entrée, transition, sortie). */
  duration: number;
  elapsed: number;
  lookFrom: Vector3;
  lookTo: Vector3;
  /** Extrémité de la découpe au départ (entrée : cible d'orbite ; sortie : focus de l'œuvre). */
  cutFrom: Vector3;
  cutTo: Vector3;
  /** Boucle : distance parcourue sur la courbe (m) et montée en vitesse (0–1). */
  s: number;
  ramp: number;
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
/** Mise en vitesse de la boucle (s), depuis l'arrêt en fin d'entrée ou de transition. */
const RAMP_S = 1.5;
/** Retour en douceur sur le parcours après une prise en main (s). */
const RETURN_S = 1.4;

/**
 * Visite guidée : entrée depuis l'orbite, boucle fermée sur les points caméra de
 * chaque œuvre (1→2→3→1… à vitesse constante), transitions par le point central,
 * sortie vers l'orbite. Position : spline Catmull-Rom + easing doux. Rotation :
 * l'orientation suit en continu un point visé interpolé (focus → focus).
 *
 * Sur une œuvre, l'utilisateur peut prendre la main : orbite autour du focus,
 * limitée à la boîte de l'œuvre ; après `resumeDelayMs` d'inactivité, la caméra
 * revient en douceur sur le parcours, là où il s'était arrêté.
 */
export function createTour(opts: TourOptions) {
  const { camera } = opts;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let phase: Phase | null = null;
  let index = -1;
  let manualPause = false;
  const listeners = new Set<(s: TourStatus) => void>();

  // Sorties lues chaque image par le viewer.
  const lookTarget = new Vector3();
  const cutTarget = new Vector3();
  let cutScale = 0;

  // ---- Prise en main sur l'œuvre (orbite autour du focus) ----------------------
  const userOrbit = new OrbitControls(camera, opts.dom);
  userOrbit.enabled = false;
  userOrbit.enableDamping = true;
  userOrbit.dampingFactor = 0.1;
  userOrbit.enablePan = false;
  userOrbit.minDistance = 0.5;
  /** null : la visite pilote ; 'drag' : l'utilisateur a la main ; 'return' : retour au parcours. */
  let user: null | 'drag' | 'return' = null;
  let lastInteract = 0;
  let dragging = false;
  let ret = { t: 0, pos: new Vector3(), quat: new Quaternion() };
  // Prise en main seulement après un vrai glisser (quelques pixels) : un simple
  // tap (point d'intérêt, bouton sur mobile) ne masque pas l'interface.
  const DRAG_PX = 6;
  let press: { x: number; y: number } | null = null;
  const onPress = (e: PointerEvent) => {
    press = { x: e.clientX, y: e.clientY };
  };
  const onMove = (e: PointerEvent) => {
    if (!press || !dragging || user === 'drag') return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) {
      user = 'drag';
      emit();
    }
  };
  opts.dom.addEventListener('pointerdown', onPress, { capture: true });
  opts.dom.addEventListener('pointermove', onMove);
  userOrbit.addEventListener('start', () => {
    if (!phase || phase.kind !== 'loop') return;
    dragging = true;
  });
  userOrbit.addEventListener('end', () => {
    dragging = false;
    press = null;
    lastInteract = performance.now();
  });
  // La molette (zoom) ne déclenche pas start/end : on la compte comme une interaction.
  const onWheel = () => {
    if (!userOrbit.enabled) return;
    lastInteract = performance.now();
    if (user !== 'drag') {
      user = 'drag';
      emit();
    }
  };
  opts.dom.addEventListener('wheel', onWheel, { passive: true });

  const works = () => opts.config().works;
  const ms = (v: number) => (reduced ? Math.min(v, 600) : v) / 1000;

  function status(): TourStatus {
    return {
      state: phase?.kind ?? 'idle',
      index,
      work: works()[index] ?? null,
      paused: manualPause || user !== null,
      userControl: user === 'drag',
    };
  }
  function emit() {
    const s = status();
    for (const l of listeners) l(s);
  }

  function workStart(w: TourWork) {
    return w.cameraPoints.length ? v3(w.cameraPoints[0]) : v3(w.focus);
  }

  function makePhase(kind: Phase['kind'], path: Path, duration: number, look: [Vector3, Vector3], cut: [Vector3, Vector3]): Phase {
    return {
      kind,
      path,
      duration: Math.max(duration, 1e-3),
      elapsed: 0,
      lookFrom: look[0].clone(),
      lookTo: look[1].clone(),
      cutFrom: cut[0].clone(),
      cutTo: cut[1].clone(),
      s: 0,
      ramp: 0,
    };
  }

  function setUserOrbit(on: boolean) {
    userOrbit.enabled = on;
    user = null;
    dragging = false;
  }

  function startLoop(w: TourWork) {
    const pts = w.cameraPoints.map(v3);
    const f = v3(w.focus);
    phase = makePhase('loop', new Path(pts.length ? pts : [f], true), 0, [f, f], [f, f]);
    userOrbit.target.copy(f);
    setUserOrbit(true);
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
      phase = makePhase('enter', new Path([pos, workStart(w)]), ms(cfg.durations.enterMs), [from, focus], [cutFrom, focus]);
    } else if (phase.kind === 'exit') {
      return;
    } else {
      // Entre deux œuvres : par le point central, découpe éteinte.
      const path = new Path([pos, v3(cfg.hub.position), workStart(w)]);
      phase = makePhase('transit', path, ms(cfg.durations.betweenMs), [from, focus], [focus, focus]);
    }
    setUserOrbit(false);
    index = target;
    emit();
  }

  /** Place directement la caméra au début du parcours de l'œuvre `i` (aperçu éditeur). */
  function jumpTo(i: number) {
    const list = works();
    if (!list[i]) return;
    index = i;
    manualPause = false;
    startLoop(list[i]);
    camera.position.copy(workStart(list[i]));
    lookTarget.copy(v3(list[i].focus));
    camera.lookAt(lookTarget);
    camera.updateMatrixWorld();
    emit();
  }

  function stop() {
    if (!phase || phase.kind === 'exit') return;
    const h = opts.home();
    const focus = lookTarget.clone();
    phase = makePhase('exit', new Path([camera.position.clone(), h.position]), ms(opts.config().durations.exitMs), [focus, h.target], [focus, h.target]);
    manualPause = false;
    setUserOrbit(false);
    emit();
  }

  const qDesired = new Quaternion();
  const mLook = new Matrix4();
  const onPath = new Vector3();
  const local = new Vector3();
  const half = new Vector3();
  /** Ramène `p` dans la boîte orientée (repère local tourné autour de la verticale). */
  function clampToBox(p: Vector3, b: TourBounds) {
    const a = MathUtils.degToRad(b.rotationY ?? 0);
    local.set(p.x - b.center[0], p.y - b.center[1], p.z - b.center[2]).applyAxisAngle(UP, -a);
    half.set(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2);
    local.clamp(half.clone().negate(), half).applyAxisAngle(UP, a);
    p.set(local.x + b.center[0], local.y + b.center[1], local.z + b.center[2]);
  }

  /** Point du parcours de la boucle à la distance courante. */
  function loopPoint(p: Phase, out: Vector3) {
    const len = p.path.length;
    const u = len > 0 ? (((p.s % len) + len) % len) / len : 0;
    return p.path.at(Number.isFinite(u) ? u : 0, out);
  }

  /** Avance la visite ; renvoie true quand la sortie est terminée (rendre la main à l'orbite). */
  function update(dt: number): boolean {
    if (!phase) return false;
    const cfg = opts.config();
    let finished = false;

    if (phase.kind === 'loop') {
      const w = works()[index];
      lookTarget.copy(phase.lookTo);
      cutScale = 0;

      if (user === 'drag') {
        // L'utilisateur a la main : orbite autour du focus, limitée à la boîte de l'œuvre.
        userOrbit.update(dt);
        if (w?.bounds) {
          clampToBox(camera.position, w.bounds);
          camera.lookAt(userOrbit.target);
        }
        if (!dragging && performance.now() - lastInteract > cfg.resumeDelayMs) {
          // Retour vers le parcours, là où il s'était arrêté.
          user = 'return';
          ret = { t: 0, pos: camera.position.clone(), quat: camera.quaternion.clone() };
        }
        camera.updateMatrixWorld();
        return false;
      }
      if (user === 'return') {
        ret.t = Math.min(ret.t + dt / RETURN_S, 1);
        const e = easeInOut(ret.t);
        loopPoint(phase, onPath);
        camera.position.lerpVectors(ret.pos, onPath, e);
        mLook.lookAt(onPath, lookTarget, UP);
        qDesired.setFromRotationMatrix(mLook);
        camera.quaternion.slerpQuaternions(ret.quat, qDesired, e);
        camera.updateMatrixWorld();
        if (ret.t >= 1) {
          user = null;
          emit();
        }
        return false;
      }

      // Boucle fermée 1→2→…→n→1 à vitesse constante (mise en vitesse au départ).
      if (!manualPause && !reduced) {
        phase.ramp = Math.min(phase.ramp + dt / RAMP_S, 1);
        phase.s += (Number.isFinite(cfg.loopSpeed) ? cfg.loopSpeed : 0.8) * easeInOut(phase.ramp) * dt;
      }
      loopPoint(phase, camera.position);
    } else {
      if (!manualPause) phase.elapsed += dt;
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
          finished = true;
          emit();
        } else {
          startLoop(works()[index]);
          emit();
        }
      }
    }

    // Orientation : vise lookTarget, rattrapée en douceur (pas de saut aux points).
    mLook.lookAt(camera.position, lookTarget, UP);
    qDesired.setFromRotationMatrix(mLook);
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
    /** Pause demandée au bouton (le cycle des points d'intérêt s'arrête aussi). */
    get manualPaused() {
      return manualPause;
    },
    /** Destination à précharger en haute définition (position + point visé), ou null. */
    lookahead(): { position: Vector3; target: Vector3 } | null {
      if (!phase || phase.kind === 'exit') return null;
      const w = works()[index];
      if (!w) return null;
      const pts = w.cameraPoints;
      // En boucle : le point le plus éloigné du départ ; sinon le premier point de l'œuvre visée.
      const p = phase.kind === 'loop' && pts.length > 1 ? v3(pts[Math.floor(pts.length / 2)]) : workStart(w);
      return { position: p, target: v3(w.focus) };
    },
    start(i = 0) {
      manualPause = false;
      goTo(i);
    },
    goTo,
    jumpTo,
    next() {
      if (phase) goTo(index + 1);
    },
    prev() {
      if (phase) goTo(index - 1);
    },
    stop,
    togglePause() {
      if (!phase || phase.kind === 'exit') return;
      // Pendant une prise en main, le bouton relance directement le parcours.
      if (user === 'drag') {
        user = 'return';
        ret = { t: 0, pos: camera.position.clone(), quat: camera.quaternion.clone() };
        manualPause = false;
      } else {
        manualPause = !manualPause;
      }
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
      setUserOrbit(false);
      emit();
    },
    dispose() {
      opts.dom.removeEventListener('wheel', onWheel);
      opts.dom.removeEventListener('pointerdown', onPress, { capture: true });
      opts.dom.removeEventListener('pointermove', onMove);
      userOrbit.dispose();
      listeners.clear();
    },
  };
}

export type Tour = ReturnType<typeof createTour>;
