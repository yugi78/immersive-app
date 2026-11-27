import { CatmullRomCurve3, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ControlStep, PathStep, ScenarioConfig, ScenarioPoint, ScenarioStep } from '../config/types';
import { firstControl, stepById, tourStepOf } from '../config/scenario';
import { easeInOut, Path } from '../tour/path';
import { createIntro } from './intro';
import type { SceneReference } from './reference';

/**
 * Scénario : enchaîne les ÉTAPES décrites dans content.json → scenario.
 *
 * - Trajet (une fois), boucle d'attente (en boucle), prise en main (orbite), visite
 *   guidée. Chaque étape dit où aller à la fin, si le visiteur touche, après une
 *   inactivité ; la visite, où mène son bouton de sortie.
 * - Entre deux étapes : raccord doux (position interpolée, regard qui pivote), sauf si
 *   la caméra est déjà au départ de l'étape suivante.
 * - Toucher pendant une boucle (ou un trajet interruptible) mène à l'étape prévue ; si
 *   c'est une prise en main, elle démarre SUR PLACE (sa cible glisse vers le focus).
 * - La visite guidée suspend le scénario ; à sa sortie, la caméra rejoint le départ de
 *   l'étape de sortie et le scénario reprend.
 */

export type ScenarioState = 'intro' | 'blend' | 'loop' | 'control' | 'paused';

const v3 = (p: readonly number[]) => new Vector3(p[0], p[1], p[2]);
const lookQuat = (from: Vector3, target: Vector3, up: Vector3) =>
  new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(from, target, up));

/** Vue de départ d'une prise en main, autour du focus. */
export function homePose(control: Pick<ControlStep, 'start'>, focus: Vector3) {
  const az = MathUtils.degToRad(control.start.azimuthDeg);
  const el = MathUtils.degToRad(control.start.elevationDeg);
  const position = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
    .multiplyScalar(control.start.distance)
    .add(focus);
  return { position, target: focus.clone() };
}

/** Vue de départ par défaut (scénario sans prise en main). */
const FALLBACK_START = { start: { distance: 120, azimuthDeg: 200, elevationDeg: 25 } };

/**
 * Boucle de points : positions et points regardés sur deux splines Catmull-Rom
 * fermées, chaque segment parcouru dans la durée de son point d'arrivée.
 */
function createLoopPath(points: ScenarioPoint[]) {
  const n = points.length;
  const pos = points.map((p) => v3(p.position));
  const tgt = points.map((p) => v3(p.target));
  const usable = n >= 3;
  const posCurve = usable ? new CatmullRomCurve3(pos, true, 'centripetal') : null;
  const tgtCurve = usable ? new CatmullRomCurve3(tgt, true, 'centripetal') : null;
  const durations = Array.from({ length: usable ? n : 0 }, (_, i) => Math.max(points[(i + 1) % n].durationMs, 1) / 1000);
  const total = durations.reduce((a, b) => a + b, 0);
  function at(time: number, outPos: Vector3, outTgt: Vector3) {
    if (!posCurve || !tgtCurve) {
      if (n) {
        outPos.copy(pos[0]);
        outTgt.copy(tgt[0]);
      }
      return;
    }
    let t = ((time % total) + total) % total;
    let i = 0;
    while (i < n - 1 && t > durations[i]) t -= durations[i++];
    const g = (i + Math.min(t / durations[i], 1)) / n;
    posCurve.getPoint(g, outPos);
    tgtCurve.getPoint(g, outTgt);
  }
  return { at };
}

interface Options {
  camera: PerspectiveCamera;
  dom: HTMLElement;
  controls: OrbitControls;
  reference: SceneReference;
  config: () => ScenarioConfig;
  /** Visite, carte ou vol libre en cours : l'inactivité ne déclenche rien. */
  busy: () => boolean;
  /** Back-office : prise en main immédiate (pas d'ouverture), pas d'enchaînement sur inactivité hors aperçu. */
  skip?: boolean;
  /** Vol libre du back-office en cours (l'orbite reste alors coupée). */
  flying?: () => boolean;
  /** Lance la visite guidée sur une œuvre. */
  startTour: (work: number) => void;
  /** Réglages de l'orbite d'une prise en main (distances, rotation…). */
  applyControl: (step: ControlStep) => void;
  /** Appelé une fois, quand le visiteur peut agir (fin ou interruption de l'ouverture). */
  onReady: () => void;
}

export function createScenario(o: Options) {
  const { camera, controls, reference } = o;
  let state: ScenarioState = 'control';
  let ready = false;
  /** Étape courante (celle en cours, ou visée par le raccord). */
  let current: ScenarioStep | null = null;
  /** Point regardé pendant un trajet, une boucle ou un raccord (découpe, mise au point). */
  const lookTarget = reference.focus.clone();
  /** Back-office : les enchaînements sur inactivité n'ont lieu que pendant un aperçu. */
  let previewing = !o.skip;

  let sky: ReturnType<typeof createIntro> | null = null;
  let way: { path: Path; look: Vector3; nextLook: Vector3 | null; duration: number; time: number } | null = null;
  let loop: { path: ReturnType<typeof createLoopPath>; time: number } | null = null;
  let blend: { fromPos: Vector3; toPos: Vector3; fromQ: Quaternion; toQ: Quaternion; fromTgt: Vector3; toTgt: Vector3; time: number; duration: number; then: () => void } | null = null;
  /** Après une prise en main sur place : la cible d'orbite glisse vers le focus. */
  let retarget = false;
  let idleTimer: number | undefined;

  const cfg = () => o.config();
  const step = (id: string) => stepById(cfg(), id);

  function markReady() {
    if (ready) return;
    ready = true;
    o.onReady();
  }
  function stopMotion() {
    blend = null;
    sky = null;
    way = null;
    loop = null;
    retarget = false;
  }

  // ---- Poses de départ des étapes ------------------------------------------------

  /** Départ d'une prise en main (ou de la vue par défaut). */
  const controlPose = (s: ControlStep | null) => homePose(s ?? firstControl(cfg()) ?? FALLBACK_START, reference.focus);

  /** Pose d'arrivée d'un trajet « du ciel » : le départ de l'étape suivante si c'est une prise en main. */
  function skyEnd(s: PathStep) {
    const next = step(s.onEnd);
    return next?.kind === 'control' ? controlPose(next) : controlPose(null);
  }

  /** Position et point regardé au début d'une étape (null : pas de pose propre, ex. visite). */
  function startPose(s: ScenarioStep | null, depth = 0): { position: Vector3; target: Vector3 } | null {
    if (!s) return controlPose(null);
    switch (s.kind) {
      case 'control':
        return controlPose(s);
      case 'loop':
        return s.points.length ? { position: v3(s.points[0].position), target: v3(s.points[0].target) } : null;
      case 'path': {
        if (s.style === 'sky') {
          const tmp = new PerspectiveCamera();
          createIntro(tmp, s, reference, skyEnd(s).position);
          return { position: tmp.position.clone(), target: reference.focus.clone() };
        }
        if (s.waypoints.length) return { position: v3(s.waypoints[0]), target: s.look ? v3(s.look) : reference.focus.clone() };
        // Trajet vide : le départ de la suite.
        return depth < 4 ? startPose(step(s.onEnd), depth + 1) : null;
      }
      case 'tour':
        return null;
    }
  }

  // ---- Raccords ---------------------------------------------------------------------

  /** Raccord doux de la pose courante vers une pose (position + point regardé). */
  function blendTo(toPos: Vector3, toTgt: Vector3, then: () => void) {
    const fromQ = camera.quaternion.clone();
    const toQ = lookQuat(toPos, toTgt, camera.up);
    const near = camera.position.distanceTo(toPos) < 0.05 && fromQ.angleTo(toQ) < 0.01;
    const duration = near ? 0 : Math.max(cfg().blendMs, 0) / 1000;
    if (duration === 0) {
      camera.position.copy(toPos);
      camera.quaternion.copy(toQ);
      lookTarget.copy(toTgt);
      then();
      return;
    }
    const fromTgt = camera.position.clone().add(camera.getWorldDirection(new Vector3()).multiplyScalar(camera.position.distanceTo(toTgt)));
    blend = { fromPos: camera.position.clone(), toPos: toPos.clone(), fromQ, toQ, fromTgt, toTgt: toTgt.clone(), time: 0, duration, then };
    state = 'blend';
  }

  // ---- Entrée dans une étape ------------------------------------------------------------

  /**
   * Va à l'étape `id`. `onSpot` : une prise en main démarre là où est la caméra.
   * `placed` : la caméra est déjà au départ de l'étape (pas de raccord).
   */
  function goTo(id: string, opts: { onSpot?: boolean; placed?: boolean } = {}): void {
    clearIdle();
    stopMotion();
    const s = step(id) ?? firstControl(cfg());
    current = s;
    if (!s) {
      // Aucun scénario utilisable : prise en main par défaut.
      const h = controlPose(null);
      camera.position.copy(h.position);
      camera.lookAt(h.target);
      return enterControl(null, h.target);
    }
    if (s.kind === 'tour') {
      markReady();
      state = 'paused';
      o.startTour(Math.max(0, s.startWork));
      return;
    }
    if (s.kind === 'control' && opts.onSpot) return takeOver(s);
    const pose = startPose(s);
    const run = (): void => runStep(s);
    if (!pose || opts.placed) return run();
    controls.enabled = false;
    controls.autoRotate = false;
    blendTo(pose.position, pose.target, run);
  }

  /** Lance une étape, la caméra étant à son départ. */
  function runStep(s: ScenarioStep): void {
    blend = null;
    current = s;
    switch (s.kind) {
      case 'control':
        return enterControl(s, reference.focus);
      case 'loop': {
        markReady();
        controls.enabled = false;
        controls.autoRotate = false;
        if (s.points.length < 3) return goTo(s.onTouch, { onSpot: true });
        loop = { path: createLoopPath(s.points), time: 0 };
        state = 'loop';
        loop.path.at(0, camera.position, lookTarget);
        camera.lookAt(lookTarget);
        return;
      }
      case 'path':
        return runPath(s);
      case 'tour':
        return goTo(s.id);
    }
  }

  function runPath(s: PathStep): void {
    controls.enabled = false;
    controls.autoRotate = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    state = 'intro';
    if (s.style === 'sky') {
      sky = createIntro(camera, reduced ? { ...s, durationMs: 0 } : s, reference, skyEnd(s).position);
      lookTarget.copy(reference.focus);
      return;
    }
    const pts = s.waypoints.map((p) => v3(p));
    const next = s.endAtNext ? startPose(step(s.onEnd)) : null;
    if (next) pts.push(next.position);
    if (!pts.length) return endPath(s);
    way = {
      path: new Path(pts),
      look: s.look ? v3(s.look) : reference.focus.clone(),
      nextLook: next?.target ?? null,
      duration: reduced ? 0 : Math.max(s.durationMs, 1) / 1000,
      time: 0,
    };
    placeWay(0);
  }

  /**
   * Pose du trajet point par point à l'avancement e (0–1, déjà lissé) : position le
   * long du tracé à vitesse constante ; regard sur le point visé, qui glisse vers celui
   * de l'étape suivante en fin de trajet quand on y arrive directement.
   */
  function placeWay(e: number) {
    if (!way) return;
    way.path.at(e, camera.position);
    lookTarget.copy(way.look);
    if (way.nextLook) lookTarget.lerp(way.nextLook, MathUtils.smoothstep(e, 0.6, 1));
    camera.lookAt(lookTarget);
  }

  /** Fin d'un trajet : la suite (sans raccord si on y est déjà). */
  function endPath(s: PathStep): void {
    sky = null;
    way = null;
    markReady();
    const next = step(s.onEnd);
    const placed = s.style === 'sky' ? !next || next.kind === 'control' : s.endAtNext;
    goTo(s.onEnd, { placed });
  }

  /** Prise en main : l'orbite démarre, l'inactivité est surveillée. */
  function enterControl(s: ControlStep | null, target: Vector3): void {
    stopMotion();
    state = 'control';
    if (s) o.applyControl(s);
    controls.target.copy(target);
    controls.enabled = !o.flying?.();
    controls.autoRotate = false;
    controls.update();
    markReady();
    clearIdle();
    if (s?.idle.action === 'rotate') controls.autoRotate = true;
    else if (s?.idle.action === 'goto') scheduleIdle();
  }

  /** Prise en main sur place (interaction pendant une boucle ou un trajet). */
  function takeOver(s: ControlStep) {
    const d = camera.position.distanceTo(reference.focus);
    const target = camera.position.clone().add(camera.getWorldDirection(new Vector3()).multiplyScalar(d));
    current = s;
    enterControl(s, target);
    controls.autoRotate = false;
    clearIdle();
    retarget = true;
  }

  function clearIdle() {
    window.clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  function scheduleIdle() {
    clearIdle();
    const s = current;
    if (state !== 'control' || s?.kind !== 'control' || s.idle.action === 'none') return;
    idleTimer = window.setTimeout(() => {
      if (state !== 'control' || current !== s) return;
      if (o.busy()) return scheduleIdle();
      if (s.idle.action === 'rotate') controls.autoRotate = true;
      else if (s.idle.action === 'goto' && previewing && s.idle.step) goTo(s.idle.step);
    }, Math.max(s.idle.afterMs, 0));
  }

  // Inactivité : l'utilisateur manipule l'orbite → on attend la fin pour décompter.
  const onStart = () => {
    controls.autoRotate = false;
    clearIdle();
  };
  const onEnd = () => scheduleIdle();
  controls.addEventListener('start', onStart);
  controls.addEventListener('end', onEnd);

  // Interaction : écoutée en phase de capture, avant l'orbite, pour que le même geste
  // fasse déjà tourner la vue quand il donne la main.
  const onInput = () => {
    const s = current;
    if (!s) return;
    if (state === 'loop' && s.kind === 'loop') goTo(s.onTouch, { onSpot: true });
    else if (state === 'intro' && s.kind === 'path' && s.interruptible) goTo(s.onTouch, { onSpot: true });
    else if (state === 'blend' && ready) {
      // Raccord en cours : la main est donnée sur place (prise en main visée, ou la première).
      const c = s.kind === 'control' ? s : firstControl(cfg());
      if (c) takeOver(c);
    }
  };
  o.dom.addEventListener('pointerdown', onInput, { capture: true });
  o.dom.addEventListener('wheel', onInput, { capture: true, passive: true });

  /** Place la caméra au départ de la première étape, sans la lancer. */
  function placeAtFirst() {
    const pose = startPose(step(cfg().first));
    if (!pose) return;
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    lookTarget.copy(pose.target);
  }

  /** Lance le scénario (ou, en back-office, la première prise en main). */
  function begin() {
    if (o.skip) {
      const c = firstControl(cfg());
      const h = controlPose(c);
      camera.position.copy(h.position);
      camera.lookAt(h.target);
      current = c;
      return enterControl(c, h.target);
    }
    placeAtFirst();
    goTo(cfg().first, { placed: true });
  }

  function update(delta: number) {
    if (state === 'intro' && current?.kind === 'path') {
      const s = current;
      if (sky) {
        if (sky.update(delta)) endPath(s);
      } else if (way) {
        way.time += delta;
        const t = way.duration > 0 ? Math.min(way.time / way.duration, 1) : 1;
        placeWay(easeInOut(t));
        if (t >= 1) endPath(s);
      } else endPath(s);
    } else if (state === 'loop' && loop) {
      loop.time += delta;
      loop.path.at(loop.time, camera.position, lookTarget);
      camera.lookAt(lookTarget);
    } else if (state === 'blend' && blend) {
      blend.time += delta;
      const k = Math.min(blend.time / blend.duration, 1);
      const e = easeInOut(k);
      camera.position.lerpVectors(blend.fromPos, blend.toPos, e);
      camera.quaternion.slerpQuaternions(blend.fromQ, blend.toQ, e);
      lookTarget.lerpVectors(blend.fromTgt, blend.toTgt, e);
      if (k >= 1) {
        const then = blend.then;
        blend = null;
        then();
      }
    } else if (state === 'control' && retarget) {
      // La cible d'orbite rejoint le focus en douceur (la vue pivote sans saut).
      controls.target.lerp(reference.focus, 1 - Math.exp(-2.5 * delta));
      if (controls.target.distanceTo(reference.focus) < 0.05) retarget = false;
    }
  }

  /** Étape de sortie de la visite guidée (bouton du monument). */
  const exitStep = () => {
    const t = tourStepOf(cfg());
    return (t && step(t.exit)) ?? firstControl(cfg());
  };

  return {
    get state() {
      return state;
    },
    /** Étape courante (découpe, back-office). */
    get step() {
      return current;
    },
    /** Trajet, boucle ou raccord en cours : le scénario pilote la caméra. */
    get driving() {
      return state === 'intro' || state === 'loop' || state === 'blend';
    },
    /** Avancement du raccord en cours (0–1), -1 hors raccord. */
    get blendProgress() {
      return state === 'blend' && blend ? Math.min(blend.time / blend.duration, 1) : -1;
    },
    lookTarget,
    begin,
    update,
    /** Pose où la visite guidée ramène la caméra à sa sortie (départ de l'étape de sortie). */
    exitPose() {
      return startPose(exitStep()) ?? controlPose(null);
    },
    /** Étape de sortie de la visite (découpe pendant l'entrée et la sortie de la visite). */
    exitStep,
    /** Visite guidée, carte… : le scénario s'efface (plus de minuterie, plus de pilotage). */
    pause() {
      clearIdle();
      stopMotion();
      controls.autoRotate = false;
      state = 'paused';
    },
    /** Fin de la visite : on reprend à l'étape de sortie, la caméra étant à son départ. */
    resume() {
      const s = exitStep();
      if (s) goTo(s.id, { placed: true });
      else enterControl(null, reference.focus);
    },
    /** Rejoue le scénario depuis la première étape (aperçu du back-office). */
    replay() {
      clearIdle();
      previewing = true;
      placeAtFirst();
      goTo(cfg().first, { placed: true });
    },
    /** Joue une étape seule (aperçu du back-office). */
    playStep(id: string) {
      previewing = true;
      goTo(id);
    },
    /** Retour à la première prise en main (fin de l'aperçu). */
    goHome() {
      if (o.skip) previewing = false;
      goTo(firstControl(cfg())?.id ?? '');
    },
    /** Caméra placée à la main (back-office) : prise en main immédiate, sans rotation ni minuterie. */
    placeAt(target: Vector3) {
      if (o.skip) previewing = false;
      stopMotion();
      clearIdle();
      state = 'control';
      controls.autoRotate = false;
      controls.target.copy(target);
      controls.enabled = !o.flying?.();
      markReady();
    },
    /** Départ d'une étape (repères du back-office). */
    startPose: (id: string) => startPose(step(id)),
    dispose() {
      clearIdle();
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      o.dom.removeEventListener('pointerdown', onInput, { capture: true });
      o.dom.removeEventListener('wheel', onInput, { capture: true });
    },
  };
}

export type Scenario = ReturnType<typeof createScenario>;
