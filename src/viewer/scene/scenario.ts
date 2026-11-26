import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ScenarioConfig, ScenarioPoint } from '../config/types';
import { easeInOut } from '../tour/path';
import { createIntro } from './intro';
import type { SceneReference } from './reference';

/**
 * Scénario d'ouverture : enchaîne les étapes décrites dans content.json → scenario.
 *
 *   intro (une fois) ─raccord→ boucle d'attente (en boucle) ─raccord→ prise en main (orbite)
 *
 * - Chaque étape est optionnelle ; les raccords sont des transitions douces (position
 *   interpolée, regard qui pivote), comme entre deux œuvres.
 * - Toute interaction pendant la boucle (ou l'intro si elle est interruptible) donne la
 *   main SUR PLACE : l'orbite repart de la position courante, sa cible glisse vers le
 *   point de focus.
 * - Inactivité en prise en main (idle) : rien, rotation automatique ou retour à la boucle.
 * - La visite guidée (et la carte, le vol libre du back-office) suspend le scénario ;
 *   en fin de visite, on revient en prise en main.
 */

export type ScenarioState = 'intro' | 'blend' | 'loop' | 'control' | 'paused';

const v3 = (p: readonly number[]) => new Vector3(p[0], p[1], p[2]);
/** Départ doux, vitesse 1 à l'arrivée (raccord avec le segment suivant). */
const easeIn = (u: number) => u * u * (2 - u);
/** Vitesse 1 au départ, arrivée douce. */
const easeOut = (u: number) => 1 - easeIn(1 - u);
const lookQuat = (from: Vector3, target: Vector3, up: Vector3) =>
  new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(from, target, up));

/** Vue de départ de la prise en main (et de retour en fin de visite), autour du focus. */
export function homePose(control: ScenarioConfig['control'], focus: Vector3) {
  const az = MathUtils.degToRad(control.start.azimuthDeg);
  const el = MathUtils.degToRad(control.start.elevationDeg);
  const position = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
    .multiplyScalar(control.start.distance)
    .add(focus);
  return { position, target: focus.clone() };
}

/**
 * Trajet de caméra point par point : positions et points regardés sur deux splines
 * Catmull-Rom (centripètes), chaque segment parcouru dans la durée de son point
 * d'arrivée. Ouvert : départ et arrivée en douceur. Fermé : boucle sans arrêt.
 */
function createPointsPath(points: ScenarioPoint[], closed: boolean) {
  const n = points.length;
  const pos = points.map((p) => v3(p.position));
  const tgt = points.map((p) => v3(p.target));
  const usable = n >= (closed ? 3 : 2);
  const posCurve = usable ? new CatmullRomCurve3(pos, closed, 'centripetal') : null;
  const tgtCurve = usable ? new CatmullRomCurve3(tgt, closed, 'centripetal') : null;
  const segs = usable ? (closed ? n : n - 1) : 0;
  const durations = Array.from({ length: segs }, (_, i) => Math.max(points[(i + 1) % n].durationMs, 1) / 1000);
  const total = durations.reduce((a, b) => a + b, 0);

  /** Pose au temps `time` (s) ; renvoie false une fois l'extrémité atteinte (trajet ouvert). */
  function at(time: number, outPos: Vector3, outTgt: Vector3): boolean {
    if (!posCurve || !tgtCurve) {
      if (n) {
        outPos.copy(pos[0]);
        outTgt.copy(tgt[0]);
      }
      return false;
    }
    let t = closed ? ((time % total) + total) % total : Math.min(Math.max(time, 0), total);
    let i = 0;
    while (i < segs - 1 && t > durations[i]) t -= durations[i++];
    let u = Math.min(t / durations[i], 1);
    if (!closed) {
      if (segs === 1) u = easeInOut(u);
      else if (i === 0) u = easeIn(u);
      else if (i === segs - 1) u = easeOut(u);
    }
    const g = (i + u) / segs;
    posCurve.getPoint(g, outPos);
    tgtCurve.getPoint(g, outTgt);
    return closed || time < total;
  }
  return { at, usable: n > 0, first: () => ({ position: pos[0]?.clone(), target: tgt[0]?.clone() }) };
}

interface Options {
  camera: PerspectiveCamera;
  dom: HTMLElement;
  controls: OrbitControls;
  reference: SceneReference;
  config: () => ScenarioConfig;
  /** Visite, carte ou vol libre en cours : l'inactivité ne déclenche rien. */
  busy: () => boolean;
  /** Sans intro ni boucle (back-office) : prise en main immédiate. */
  skip?: boolean;
  /** Appelé une fois, à la fin de l'ouverture (fin ou interruption de l'intro). */
  onReady: () => void;
}

export function createScenario(o: Options) {
  const { camera, controls, reference } = o;
  let state: ScenarioState = 'control';
  let ready = false;
  /** Point regardé pendant l'intro, la boucle et les raccords (découpe, mise au point). */
  const lookTarget = reference.focus.clone();

  let sky: ReturnType<typeof createIntro> | null = null;
  let path: ReturnType<typeof createPointsPath> | null = null;
  let pathTime = 0;
  let blend: { fromPos: Vector3; toPos: Vector3; fromQ: Quaternion; toQ: Quaternion; fromTgt: Vector3; toTgt: Vector3; time: number; duration: number; then: () => void } | null = null;
  /** Après une prise en main sur place : la cible d'orbite glisse vers le focus. */
  let retarget = false;
  let idleTimer: number | undefined;

  const cfg = () => o.config();
  const loopUsable = () => cfg().loop.enabled && cfg().loop.points.length >= 3;

  function markReady() {
    if (ready) return;
    ready = true;
    o.onReady();
  }

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

  function startLoop() {
    clearIdle();
    controls.enabled = false;
    controls.autoRotate = false;
    path = createPointsPath(cfg().loop.points, true);
    const first = path.first();
    blendTo(first.position!, first.target!, () => {
      pathTime = 0;
      state = 'loop';
    });
  }

  /** Prise en main à la vue de départ (fin de l'ouverture, fin de visite). */
  function goHome() {
    const home = homePose(cfg().control, reference.focus);
    controls.enabled = false;
    blendTo(home.position, home.target, () => enterControl(home.target));
  }

  /** Prise en main : l'orbite démarre, l'inactivité est surveillée. */
  function enterControl(target = reference.focus) {
    blend = null;
    path = null;
    sky = null;
    state = 'control';
    controls.target.copy(target);
    controls.enabled = true;
    controls.autoRotate = false;
    controls.update();
    markReady();
    clearIdle();
    const idle = cfg().idle;
    if (idle.action === 'rotate') controls.autoRotate = true;
    else if (idle.action === 'loop') scheduleIdle();
  }

  /** Interaction pendant la boucle (ou une intro interruptible) : la main est donnée sur place. */
  function takeOver() {
    const d = camera.position.distanceTo(reference.focus);
    const target = camera.position.clone().add(camera.getWorldDirection(new Vector3()).multiplyScalar(d));
    blend = null;
    path = null;
    sky = null;
    state = 'control';
    controls.target.copy(target);
    controls.enabled = true;
    controls.autoRotate = false;
    retarget = true;
    markReady();
    clearIdle();
  }

  function clearIdle() {
    window.clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  function scheduleIdle() {
    clearIdle();
    const idle = cfg().idle;
    if (idle.action === 'none') return;
    idleTimer = window.setTimeout(() => {
      if (state !== 'control') return;
      if (o.busy()) return scheduleIdle();
      if (idle.action === 'rotate') controls.autoRotate = true;
      else if (idle.action === 'loop' && loopUsable()) startLoop();
    }, Math.max(idle.afterMs, 0));
  }

  // Inactivité : l'utilisateur manipule l'orbite → on attend la fin pour décompter.
  const onStart = () => {
    controls.autoRotate = false;
    clearIdle();
  };
  const onEnd = () => scheduleIdle();
  controls.addEventListener('start', onStart);
  controls.addEventListener('end', onEnd);

  // Interaction pendant l'ouverture : écoutée en phase de capture, avant l'orbite, pour
  // que le même geste fasse déjà tourner la vue.
  const onInput = () => {
    if (state === 'loop' || (state === 'blend' && ready) || (state === 'intro' && cfg().intro.interruptible)) takeOver();
  };
  o.dom.addEventListener('pointerdown', onInput, { capture: true });
  o.dom.addEventListener('wheel', onInput, { capture: true, passive: true });

  /** Lance l'ouverture (ou la prise en main directe). */
  function begin() {
    const c = cfg();
    const home = homePose(c.control, reference.focus);
    controls.enabled = false;
    if (o.skip || !c.intro.enabled) {
      camera.position.copy(home.position);
      camera.lookAt(home.target);
      if (!o.skip && loopUsable()) {
        markReady();
        startLoop();
      } else enterControl(home.target);
      return;
    }
    if (c.intro.kind === 'sky') {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      sky = createIntro(camera, reduced ? { ...c.intro, durationMs: 0 } : c.intro, reference, home.position);
      lookTarget.copy(reference.focus);
    } else {
      path = createPointsPath(c.intro.points, false);
      pathTime = 0;
      path.at(0, camera.position, lookTarget);
      camera.lookAt(lookTarget);
    }
    state = 'intro';
  }

  function afterIntro() {
    markReady();
    if (loopUsable()) startLoop();
    else goHome();
  }

  function update(delta: number) {
    if (state === 'intro') {
      if (sky) {
        if (sky.update(delta)) afterIntro();
      } else if (path) {
        pathTime += delta;
        const going = path.at(pathTime, camera.position, lookTarget);
        camera.lookAt(lookTarget);
        if (!going) afterIntro();
      } else afterIntro();
    } else if (state === 'loop' && path) {
      pathTime += delta;
      path.at(pathTime, camera.position, lookTarget);
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

  return {
    get state() {
      return state;
    },
    /** Intro, boucle ou raccord en cours : le scénario pilote la caméra. */
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
    /** Visite guidée, carte… : le scénario s'efface (plus de minuterie, plus de pilotage). */
    pause() {
      clearIdle();
      blend = null;
      path = null;
      sky = null;
      retarget = false;
      controls.autoRotate = false;
      if (state !== 'paused') state = 'paused';
    },
    /** Fin de visite : prise en main à la position courante (déjà à la vue de départ). */
    resume() {
      enterControl(reference.focus);
    },
    /** Rejoue l'ouverture depuis le début (aperçu du back-office). */
    replay() {
      clearIdle();
      ready = true;
      const c = cfg();
      if (c.intro.enabled) {
        const prevSkip = o.skip;
        o.skip = false;
        begin();
        o.skip = prevSkip;
      } else if (loopUsable()) startLoop();
      else goHome();
    },
    /** Retour à la vue de départ. */
    goHome,
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
