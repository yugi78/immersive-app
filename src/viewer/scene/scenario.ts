import { CatmullRomCurve3, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { OrbitMode, PassageId, ScenarioConfig, ScenarioPoint } from '../config/types';
import { easeInOut, Path } from '../tour/path';
import { createIntro } from './intro';
import type { SceneReference } from './reference';

/**
 * Scénario de l'expérience (content.json → scenario) :
 *
 *   ACCUEIL   intro → boucle d'attente → premier mode, une fois (raccords doux entre eux)
 *   MODES     vue extérieure (orbite) ou visite guidée ; le visiteur en change avec les
 *             boutons de l'interface
 *   PASSAGES  orbite → visite et visite → orbite : mouvement standard (raccord, entrée
 *             ou sortie de la visite) ou trajet point par point
 *
 * Toucher pendant l'intro (si interruptible) ou la boucle d'attente mène au premier mode
 * (la vue extérieure démarre SUR PLACE : sa cible glisse vers le focus). En vue
 * extérieure, l'inactivité déclenche la rotation automatique ou la boucle d'attente.
 */

export type ScenarioState = 'intro' | 'blend' | 'loop' | 'passage' | 'control' | 'paused';
/** Partie de l'expérience en cours (découpe, back-office). */
export type ScenarioPart = 'intro' | 'loop' | 'orbit' | 'tour' | PassageId | 'blend';

const v3 = (p: readonly number[]) => new Vector3(p[0], p[1], p[2]);
const lookQuat = (from: Vector3, target: Vector3, up: Vector3) =>
  new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(from, target, up));

/** Vue de départ de la vue extérieure, autour du focus. */
export function homePose(orbit: Pick<OrbitMode, 'start'>, focus: Vector3) {
  const az = MathUtils.degToRad(orbit.start.azimuthDeg);
  const el = MathUtils.degToRad(orbit.start.elevationDeg);
  const position = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
    .multiplyScalar(orbit.start.distance)
    .add(focus);
  return { position, target: focus.clone() };
}

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
  /** Back-office : vue extérieure immédiate (pas d'accueil), pas de boucle sur inactivité hors aperçu. */
  skip?: boolean;
  /** Vol libre du back-office en cours (l'orbite reste alors coupée). */
  flying?: () => boolean;
  /** Visite guidée : démarrer sur une œuvre (entrée animée depuis la caméra), sortie animée, arrêt immédiat. */
  tour: { start(work: number): void; stop(): void; cancel(): void; jump(work: number): void; readonly active: boolean };
  /** Réglages de l'orbite (distances, rotation…). */
  applyOrbit: (o: OrbitMode) => void;
  /** Appelé une fois, quand le visiteur peut agir (fin ou interruption de l'accueil). */
  onReady: () => void;
}

export function createScenario(o: Options) {
  const { camera, controls, reference } = o;
  let state: ScenarioState = 'control';
  let part: ScenarioPart = 'orbit';
  let ready = false;
  /** Point regardé pendant un trajet, une boucle ou un raccord (découpe, mise au point). */
  const lookTarget = reference.focus.clone();
  /** Back-office : la boucle d'attente sur inactivité n'a lieu que pendant un aperçu. */
  let previewing = !o.skip;
  /** Boucle d'attente lancée par l'inactivité : un geste ramène à la vue extérieure (et non au premier mode). */
  let loopFromIdle = false;

  let sky: ReturnType<typeof createIntro> | null = null;
  let way: { path: Path; look: Vector3; nextLook: Vector3 | null; duration: number; time: number; done: () => void } | null = null;
  let loop: { path: ReturnType<typeof createLoopPath>; time: number } | null = null;
  let blend: { fromPos: Vector3; toPos: Vector3; fromQ: Quaternion; toQ: Quaternion; fromTgt: Vector3; toTgt: Vector3; time: number; duration: number; then: () => void } | null = null;
  /** Après une prise en main sur place : la cible d'orbite glisse vers le focus. */
  let retarget = false;
  let idleTimer: number | undefined;

  const cfg = () => o.config();
  const loopOk = () => cfg().loop.enabled && cfg().loop.points.length >= 3;
  const orbitPose = () => homePose(cfg().orbit, reference.focus);

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

  // ---- Poses de départ --------------------------------------------------------------

  const loopPose = () => {
    const p = cfg().loop.points[0];
    return p ? { position: v3(p.position), target: v3(p.target) } : null;
  };
  /** Départ de ce qui suit l'intro : la boucle d'attente, ou le premier mode. */
  const afterIntroPose = () => (loopOk() ? loopPose() : cfg().firstMode === 'orbit' ? orbitPose() : null);

  function introPose() {
    const i = cfg().intro;
    if (i.style === 'sky') {
      const tmp = new PerspectiveCamera();
      createIntro(tmp, i, reference, orbitPose().position);
      return { position: tmp.position.clone(), target: reference.focus.clone() };
    }
    if (i.waypoints.length) return { position: v3(i.waypoints[0]), target: i.look ? v3(i.look) : reference.focus.clone() };
    return afterIntroPose() ?? orbitPose();
  }

  // ---- Raccords et trajets ------------------------------------------------------------

  /** Raccord doux de la pose courante vers une pose (position + point regardé). */
  function blendTo(to: { position: Vector3; target: Vector3 }, then: () => void) {
    const fromQ = camera.quaternion.clone();
    const toQ = lookQuat(to.position, to.target, camera.up);
    const near = camera.position.distanceTo(to.position) < 0.05 && fromQ.angleTo(toQ) < 0.01;
    const duration = near ? 0 : Math.max(cfg().blend.durationMs, 0) / 1000;
    controls.enabled = false;
    controls.autoRotate = false;
    if (duration === 0) {
      camera.position.copy(to.position);
      camera.quaternion.copy(toQ);
      lookTarget.copy(to.target);
      then();
      return;
    }
    const fromTgt = camera.position.clone().add(camera.getWorldDirection(new Vector3()).multiplyScalar(camera.position.distanceTo(to.target)));
    blend = { fromPos: camera.position.clone(), toPos: to.position.clone(), fromQ, toQ, fromTgt, toTgt: to.target.clone(), time: 0, duration, then };
    state = 'blend';
    part = 'blend';
  }

  /**
   * Trajet point par point (intro ou passage) : position le long du tracé à vitesse
   * constante sur la durée totale ; regard sur `look`, qui glisse vers `nextLook` en
   * fin de trajet quand on arrive directement au départ de la suite.
   */
  function playWay(pts: Vector3[], look: Vector3, nextLook: Vector3 | null, durationMs: number, done: () => void) {
    if (pts.length < 2) {
      if (pts[0]) camera.position.copy(pts[0]);
      return done();
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.enabled = false;
    controls.autoRotate = false;
    way = { path: new Path(pts), look, nextLook, duration: reduced ? 0 : Math.max(durationMs, 1) / 1000, time: 0, done };
    placeWay(0);
  }
  function placeWay(e: number) {
    if (!way) return;
    way.path.at(e, camera.position);
    lookTarget.copy(way.look);
    if (way.nextLook) lookTarget.lerp(way.nextLook, MathUtils.smoothstep(e, 0.6, 1));
    camera.lookAt(lookTarget);
  }

  // ---- Accueil -------------------------------------------------------------------------

  function runIntro() {
    const i = cfg().intro;
    state = 'intro';
    part = 'intro';
    if (i.style === 'sky') {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      sky = createIntro(camera, reduced ? { ...i, durationMs: 0 } : i, reference, orbitPose().position);
      lookTarget.copy(reference.focus);
      return;
    }
    const next = i.endAtNext ? afterIntroPose() : null;
    const pts = [...i.waypoints.map(v3), ...(next ? [next.position] : [])];
    playWay(pts, i.look ? v3(i.look) : reference.focus.clone(), next?.target ?? null, i.durationMs, afterIntro);
  }

  function afterIntro() {
    sky = null;
    way = null;
    markReady();
    if (loopOk()) startLoop(false);
    else goFirstMode();
  }

  /** Boucle d'attente (raccord depuis la pose courante). */
  function startLoop(fromIdle: boolean) {
    clearIdle();
    stopMotion();
    loopFromIdle = fromIdle;
    const pose = loopPose();
    if (!pose) return goFirstMode();
    blendTo(pose, () => {
      markReady();
      loop = { path: createLoopPath(cfg().loop.points), time: 0 };
      state = 'loop';
      part = 'loop';
    });
  }

  /** Premier mode après l'accueil. `onSpot` : la vue extérieure démarre là où est la caméra. */
  function goFirstMode(onSpot = false) {
    stopMotion();
    markReady();
    if (cfg().firstMode === 'tour') return startTourNow(cfg().tour.startWork);
    if (onSpot) return takeOver();
    blendTo(orbitPose(), () => enterOrbit(reference.focus));
  }

  // ---- Modes ---------------------------------------------------------------------------

  /** Vue extérieure : l'orbite démarre, l'inactivité est surveillée. */
  function enterOrbit(target: Vector3) {
    stopMotion();
    state = 'control';
    part = 'orbit';
    o.applyOrbit(cfg().orbit);
    controls.target.copy(target);
    controls.enabled = !o.flying?.();
    controls.autoRotate = false;
    controls.update();
    markReady();
    clearIdle();
    if (cfg().orbit.idle.action === 'rotate') controls.autoRotate = true;
    else if (cfg().orbit.idle.action === 'loop') scheduleIdle();
  }

  /** Vue extérieure sur place (geste pendant l'intro ou la boucle). */
  function takeOver() {
    const d = camera.position.distanceTo(reference.focus);
    const target = camera.position.clone().add(camera.getWorldDirection(new Vector3()).multiplyScalar(d));
    enterOrbit(target);
    controls.autoRotate = false;
    clearIdle();
    retarget = true;
  }

  /** Visite guidée : le module de visite pilote la caméra, le scénario s'efface. */
  function startTourNow(work: number) {
    clearIdle();
    stopMotion();
    state = 'paused';
    part = 'tour';
    markReady();
    o.tour.start(Math.max(0, work));
  }

  // ---- Passages --------------------------------------------------------------------------

  /** Vue extérieure → visite guidée (bouton « Visite guidée », clic sur une œuvre). */
  function enterTour(work: number) {
    const p = cfg().passages['orbit>tour'];
    clearIdle();
    stopMotion();
    if (p.kind !== 'path' || !p.waypoints.length) return startTourNow(work);
    // Le trajet part de la caméra ; la visite enchaîne depuis son dernier point.
    state = 'passage';
    part = 'orbit>tour';
    playWay([camera.position.clone(), ...p.waypoints.map(v3)], p.look ? v3(p.look) : reference.focus.clone(), null, p.durationMs, () => startTourNow(work));
  }

  /** Visite guidée → vue extérieure (bouton du monument). */
  function leaveTour() {
    const p = cfg().passages['tour>orbit'];
    if (p.kind !== 'path' || !p.waypoints.length) {
      // Mouvement standard : la sortie animée de la visite, puis resume().
      o.tour.stop();
      return;
    }
    o.tour.cancel();
    clearIdle();
    stopMotion();
    state = 'passage';
    part = 'tour>orbit';
    const home = orbitPose();
    playWay([camera.position.clone(), ...p.waypoints.map(v3), home.position], p.look ? v3(p.look) : reference.focus.clone(), home.target, p.durationMs, () => enterOrbit(reference.focus));
  }

  // ---- Inactivité, interaction ---------------------------------------------------------------

  function clearIdle() {
    window.clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  function scheduleIdle() {
    clearIdle();
    const idle = cfg().orbit.idle;
    if (state !== 'control' || idle.action === 'none') return;
    idleTimer = window.setTimeout(() => {
      if (state !== 'control') return;
      if (o.busy()) return scheduleIdle();
      if (idle.action === 'rotate') controls.autoRotate = true;
      else if (idle.action === 'loop' && previewing && loopOk()) startLoop(true);
    }, Math.max(idle.afterMs, 0));
  }

  // L'utilisateur manipule l'orbite → on attend la fin pour décompter l'inactivité.
  const onStart = () => {
    controls.autoRotate = false;
    clearIdle();
  };
  const onEnd = () => scheduleIdle();
  controls.addEventListener('start', onStart);
  controls.addEventListener('end', onEnd);

  // Geste : écouté en phase de capture, avant l'orbite, pour que le même geste fasse
  // déjà tourner la vue quand il donne la main.
  const onInput = () => {
    if (o.flying?.()) return;
    if (state === 'loop') {
      if (loopFromIdle) takeOver();
      else goFirstMode(true);
    } else if (state === 'intro' && cfg().intro.interruptible) goFirstMode(true);
    else if (state === 'blend' && ready) takeOver();
  };
  o.dom.addEventListener('pointerdown', onInput, { capture: true });
  o.dom.addEventListener('wheel', onInput, { capture: true, passive: true });

  /** Lance l'accueil (ou, en back-office, la vue extérieure). */
  function begin() {
    if (o.skip) {
      const h = orbitPose();
      camera.position.copy(h.position);
      camera.lookAt(h.target);
      return enterOrbit(h.target);
    }
    const i = cfg().intro;
    const pose = i.enabled ? introPose() : (afterIntroPose() ?? orbitPose());
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    lookTarget.copy(pose.target);
    if (i.enabled) runIntro();
    else afterIntro();
  }

  function update(delta: number) {
    if (sky) {
      if (sky.update(delta)) afterIntro();
    } else if (way) {
      way.time += delta;
      const t = way.duration > 0 ? Math.min(way.time / way.duration, 1) : 1;
      placeWay(easeInOut(t));
      if (t >= 1) {
        const done = way.done;
        way = null;
        done();
      }
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

  /** Découpe de la partie en cours (formes) et, pour un raccord ou un trajet de passage, son avancement (fondu). */
  function cutNow(): { ids: string[]; progress: number | null } {
    const c = cfg();
    switch (part) {
      case 'intro':
        return { ids: c.intro.cut, progress: null };
      case 'loop':
        return { ids: c.loop.cut, progress: null };
      case 'orbit':
        return { ids: c.orbit.cut, progress: null };
      case 'blend':
        return { ids: c.blend.cut, progress: blend ? Math.min(blend.time / blend.duration, 1) : 1 };
      case 'orbit>tour':
      case 'tour>orbit':
        return { ids: c.passages[part].cut, progress: way && way.duration > 0 ? Math.min(way.time / way.duration, 1) : 1 };
      default:
        return { ids: [], progress: null };
    }
  }

  return {
    get state() {
      return state;
    },
    /** Partie de l'expérience en cours. */
    get part() {
      return part;
    },
    /** Trajet, boucle, raccord ou passage en cours : le scénario pilote la caméra. */
    get driving() {
      return state === 'intro' || state === 'loop' || state === 'blend' || state === 'passage';
    },
    lookTarget,
    cutNow,
    begin,
    update,
    enterTour,
    leaveTour,
    /** Pose où la sortie standard de la visite ramène la caméra : la vue de départ de la vue extérieure. */
    exitPose: orbitPose,
    /** Visite guidée, carte… : le scénario s'efface (plus de minuterie, plus de pilotage). */
    pause() {
      clearIdle();
      stopMotion();
      controls.autoRotate = false;
      state = 'paused';
      if (part !== 'tour') part = 'tour';
    },
    /** Fin de la sortie standard de la visite : vue extérieure. */
    resume() {
      enterOrbit(reference.focus);
    },
    /** Rejoue l'accueil (aperçu du back-office). */
    replay() {
      clearIdle();
      stopMotion();
      previewing = true;
      if (o.tour.active) o.tour.cancel();
      const i = cfg().intro;
      const pose = i.enabled ? introPose() : (afterIntroPose() ?? orbitPose());
      camera.position.copy(pose.position);
      camera.lookAt(pose.target);
      if (i.enabled) runIntro();
      else afterIntro();
    },
    /** Joue la boucle d'attente (aperçu). */
    playLoop() {
      previewing = true;
      if (o.tour.active) o.tour.cancel();
      startLoop(true);
    },
    /** Joue un passage (aperçu) : depuis la vue de départ, ou depuis la première œuvre. */
    playPassage(id: PassageId) {
      previewing = true;
      if (id === 'orbit>tour') {
        if (o.tour.active) o.tour.cancel();
        const h = orbitPose();
        camera.position.copy(h.position);
        camera.lookAt(h.target);
        enterOrbit(h.target);
        enterTour(cfg().tour.startWork);
      } else {
        clearIdle();
        stopMotion();
        state = 'paused';
        part = 'tour';
        o.tour.jump(cfg().tour.startWork);
        // Laisse la visite se poser sur l'œuvre, puis sort.
        window.setTimeout(leaveTour, 400);
      }
    },
    /** Retour à la vue extérieure (fin de l'aperçu). */
    goHome() {
      if (o.skip) previewing = false;
      if (o.tour.active) o.tour.cancel();
      stopMotion();
      blendTo(orbitPose(), () => enterOrbit(reference.focus));
    },
    /** Caméra placée à la main (back-office) : vue extérieure immédiate, sans rotation ni minuterie. */
    placeAt(target: Vector3) {
      if (o.skip) previewing = false;
      stopMotion();
      clearIdle();
      state = 'control';
      part = 'orbit';
      controls.autoRotate = false;
      controls.target.copy(target);
      controls.enabled = !o.flying?.();
      markReady();
    },
    /** Départ de la vue extérieure et de la suite de l'intro (repères du back-office). */
    poses: () => ({ orbit: orbitPose(), afterIntro: afterIntroPose() }),
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
