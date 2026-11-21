import {
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TourConfig, Vec3 } from '../config/types';
import { Path } from '../tour/path';
import type { Tour } from '../tour/tour';
import { createFly } from './fly';

export interface EditorContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  tour: Tour;
  /** Objets visés par le pointage (scan des plafonds). */
  pickTargets: Object3D[];
}

const COLORS = { hub: '#f59f00', focus: '#e03131', point: '#1c7ed6', active: '#ffffff', path: '#1c7ed6' };

/**
 * Outils d'édition de la visite (back-office uniquement, chargés à la demande) :
 * vol libre, repères (point central, focus, points caméra, tracés), gizmo de
 * déplacement, pointage sur le scan, capture de la caméra, aperçus.
 */
export function createEditorTools(ctx: EditorContext) {
  const { scene, camera, renderer, controls, tour } = ctx;
  const dom = renderer.domElement;

  // ---- Repères -------------------------------------------------------------
  const helpers = new Group();
  helpers.name = 'tour-helpers';
  scene.add(helpers);
  const sphere = new SphereGeometry(1, 16, 12);
  const mat = (color: string, opacity = 1) =>
    new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity });
  const mats = { hub: mat(COLORS.hub), focus: mat(COLORS.focus), point: mat(COLORS.point), active: mat(COLORS.active) };
  const lineMat = new LineBasicMaterial({ color: COLORS.path, depthTest: false, transparent: true, opacity: 0.8 });
  const markers = new Map<string, Mesh>();

  function marker(key: string, pos: Vec3, kind: keyof typeof mats, radius: number) {
    const m = new Mesh(sphere, key === gizmoKey ? mats.active : mats[kind]);
    m.scale.setScalar(radius);
    m.position.set(...pos);
    m.renderOrder = 1000;
    m.name = key;
    helpers.add(m);
    markers.set(key, m);
  }

  function keysOf(cfg: TourConfig) {
    return ['hub', ...cfg.works.flatMap((w, i) => [`focus:${i}`, ...w.cameraPoints.map((_, j) => `cam:${i}:${j}`)])].join('|');
  }
  let builtKeys = '';
  const lines: Line[] = [];

  function pathLine(points: Vec3[]) {
    return new BufferGeometry().setFromPoints(new Path(points.map((p) => new Vector3(...p))).sample(80));
  }

  /**
   * Met à jour les repères. Même structure (mêmes points) : positions mises à jour
   * en place, pour ne pas casser un glisser de gizmo en cours ; sinon reconstruits.
   */
  function setHelpers(cfg: TourConfig, visible: boolean) {
    helpers.visible = visible;
    const keys = keysOf(cfg);
    if (keys === builtKeys) {
      markers.get('hub')!.position.set(...cfg.hub.position);
      cfg.works.forEach((w, i) => {
        markers.get(`focus:${i}`)!.position.set(...w.focus);
        w.cameraPoints.forEach((p, j) => markers.get(`cam:${i}:${j}`)!.position.set(...p));
      });
      for (const l of lines) l.geometry.dispose();
      let k = 0;
      cfg.works.forEach((w) => {
        if (w.cameraPoints.length >= 2) lines[k++].geometry = pathLine(w.cameraPoints);
      });
      return;
    }
    builtKeys = keys;
    lines.length = 0;
    for (const o of [...helpers.children]) {
      helpers.remove(o);
      if (o instanceof Line) o.geometry.dispose();
    }
    markers.clear();
    marker('hub', cfg.hub.position, 'hub', 0.45);
    cfg.works.forEach((w, i) => {
      marker(`focus:${i}`, w.focus, 'focus', 0.35);
      w.cameraPoints.forEach((p, j) => marker(`cam:${i}:${j}`, p, 'point', 0.22));
      if (w.cameraPoints.length >= 2) {
        const line = new Line(pathLine(w.cameraPoints), lineMat);
        line.renderOrder = 999;
        helpers.add(line);
        lines.push(line);
      }
    });
    // Le gizmo suit le repère recréé (ou se détache si le point a disparu).
    if (gizmoKey && markers.has(gizmoKey)) {
      markers.get(gizmoKey)!.material = mats.active;
      gizmo.attach(markers.get(gizmoKey)!);
    } else if (gizmoKey) {
      detachGizmo();
    }
  }

  // ---- Gizmo (TransformControls) --------------------------------------------
  const gizmo = new TransformControls(camera, dom);
  gizmo.setSize(0.8);
  scene.add(gizmo.getHelper());
  let gizmoKey: string | null = null;
  let gizmoMove: ((v: Vec3) => void) | null = null;
  gizmo.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value && !fly.enabled && !tour.active;
  });
  gizmo.addEventListener('objectChange', () => {
    const o = gizmo.object;
    if (o && gizmoMove) gizmoMove(o.position.toArray().map((x) => Math.round(x * 100) / 100) as Vec3);
  });

  function attachGizmo(key: string, onMove: (v: Vec3) => void) {
    const m = markers.get(key);
    if (!m) return false;
    if (gizmoKey && markers.get(gizmoKey)) markers.get(gizmoKey)!.material = mats[kindOf(gizmoKey)];
    gizmoKey = key;
    gizmoMove = onMove;
    m.material = mats.active;
    gizmo.attach(m);
    return true;
  }
  function detachGizmo(key?: string) {
    if (key && key !== gizmoKey) return;
    if (gizmoKey && markers.get(gizmoKey)) markers.get(gizmoKey)!.material = mats[kindOf(gizmoKey)];
    gizmoKey = null;
    gizmoMove = null;
    gizmo.detach();
  }
  const kindOf = (key: string): keyof typeof mats => (key === 'hub' ? 'hub' : key.startsWith('focus') ? 'focus' : 'point');

  // ---- Pointage sur le scan -------------------------------------------------
  const raycaster = new Raycaster();
  let pickResolve: ((v: Vec3 | null) => void) | null = null;
  const onPick = (e: PointerEvent) => {
    if (!pickResolve || e.button !== 0) return;
    e.stopPropagation();
    const r = dom.getBoundingClientRect();
    const ndc = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(ctx.pickTargets, true)[0];
    finishPick(hit ? (hit.point.toArray().map((x) => Math.round(x * 100) / 100) as Vec3) : null);
  };
  const onPickKey = (e: KeyboardEvent) => e.key === 'Escape' && finishPick(null);
  function finishPick(v: Vec3 | null) {
    const res = pickResolve;
    pickResolve = null;
    dom.style.cursor = '';
    window.removeEventListener('keydown', onPickKey);
    res?.(v);
  }
  dom.addEventListener('pointerdown', onPick, { capture: true });

  // ---- Vol libre --------------------------------------------------------------
  const fly = createFly(camera, dom);
  const ahead = new Vector3();
  function setFly(on: boolean, speed: number) {
    fly.setSpeed(speed);
    if (on === fly.enabled) return;
    fly.setEnabled(on);
    if (on) {
      tour.cancel();
      controls.enabled = false;
      controls.autoRotate = false;
    } else {
      // Retour à l'orbite autour d'un point situé devant la caméra.
      camera.getWorldDirection(ahead);
      controls.target.copy(camera.position).addScaledVector(ahead, 20);
      controls.enabled = true;
      controls.update();
    }
  }

  // ---- Aperçus ------------------------------------------------------------------
  let saved: { position: Vector3; quaternion: Quaternion; fly: boolean } | null = null;
  function savePose() {
    if (!saved) saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fly: fly.enabled };
    fly.setEnabled(false);
    controls.enabled = false;
  }
  function stopPreview() {
    const pose = saved;
    saved = null;
    tour.cancel();
    if (!pose) return;
    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion);
    fly.setEnabled(pose.fly);
    controls.enabled = !pose.fly;
    if (!pose.fly) controls.update();
  }
  // Visite quittée autrement (bouton ✕ : retour animé à l'orbite) : l'aperçu est terminé.
  const offTour = tour.onChange((s) => {
    if (s.state === 'idle') saved = null;
  });

  return {
    /** Le vol libre pilote-t-il la caméra (et la découpe doit-elle être éteinte) ? */
    get flying() {
      return fly.enabled;
    },
    get previewing() {
      return saved !== null;
    },
    /** Chaque image : vol libre ; pas d'autoRotate tant qu'un point est au gizmo. */
    update(dt: number) {
      fly.update(dt);
      if (gizmoKey) controls.autoRotate = false;
    },
    setHelpers,
    setFly,
    attachGizmo,
    detachGizmo,
    get gizmoKey() {
      return gizmoKey;
    },
    /** Position actuelle de la caméra (arrondie au cm). */
    capture: (): Vec3 => camera.position.toArray().map((x) => Math.round(x * 100) / 100) as Vec3,
    /** Prochain clic sur le scan → point touché (Échap : annulé). */
    pick(): Promise<Vec3 | null> {
      finishPick(null);
      dom.style.cursor = 'crosshair';
      window.addEventListener('keydown', onPickKey);
      return new Promise((res) => (pickResolve = res));
    },
    /** Joue le parcours d'une œuvre (boucle), depuis son premier point. */
    previewWork(i: number) {
      savePose();
      tour.jumpTo(i);
    },
    /** Joue la transition de l'œuvre `from` vers l'œuvre `to` (via le point central). */
    previewTransition(from: number, to: number) {
      savePose();
      tour.jumpTo(from);
      tour.goTo(to);
    },
    stopPreview,
    dispose() {
      offTour();
      finishPick(null);
      dom.removeEventListener('pointerdown', onPick, { capture: true });
      gizmo.detach();
      gizmo.dispose();
      fly.dispose();
      scene.remove(helpers, gizmo.getHelper());
    },
  };
}

export type EditorTools = ReturnType<typeof createEditorTools>;
