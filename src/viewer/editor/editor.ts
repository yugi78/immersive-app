import {
  Box3Helper,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  Euler,
  EdgesGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TourBounds, TourConfig, Vec3 } from '../config/types';
import type { SceneReference } from '../scene/reference';
import { Path } from '../tour/path';
import type { Tour } from '../tour/tour';
import { createFly } from './fly';

export interface EditorContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  tour: Tour;
  reference: SceneReference;
  /** Objets visés par le pointage (scan des plafonds). */
  pickTargets: Object3D[];
}

/** Ce qui est affiché dans la vue 3D, selon l'onglet Puck et l'œuvre ouverte. */
export interface EditorView {
  /** Onglet Puck courant (« Caméra orbitale », « Visite guidée »…). */
  tab: string;
  /** Œuvre dépliée dans la liste (points, tracé et boîte affichés), ou null. */
  activeWork: number | null;
  /** Interrupteur général des repères de la visite (onglet Debug). */
  tourHelpers: boolean;
}

export const TAB_ORBIT = 'Caméra orbitale';
export const TAB_TOUR = 'Visite guidée';

const COLORS = { hub: '#f59f00', focus: '#e03131', point: '#1c7ed6', bounds: '#2f9e44', orbit: '#e8590c', path: '#1c7ed6' };
const AXIS_COLORS = ['#e03131', '#2f9e44', '#1c7ed6'];
/** Taille à l'écran des repères (fraction de la hauteur de vue), constante quelle que soit la distance. */
const SIZE = { focus: 0.045, point: 0.032, hub: 0.04, orbit: 0.04, handle: 0.026, boxCenter: 0.03 };

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Pastille ronde avec un libellé centré (numéro), en sprite : toujours face à la
 * caméra, taille constante à l'écran (sizeAttenuation: false), visible à travers
 * les murs. `active` : contour blanc épais (repère attaché au gizmo).
 */
function badgeMaterial(color: string, label: string, active = false) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = active ? 14 : 6;
  g.strokeStyle = active ? '#ffffff' : 'rgba(255,255,255,0.85)';
  g.stroke();
  if (label) {
    g.fillStyle = '#ffffff';
    g.font = `700 ${label.length > 1 ? 58 : 70}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, s / 2, s / 2 + 4);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return new SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true });
}

/**
 * Outils d'édition (back-office uniquement, chargés à la demande) : vol libre,
 * repères (point central, focus numérotés, points caméra, tracés, boîtes de
 * limite, point de focus orbital), gizmo, pointage sur le scan, capture, aperçus.
 * Les repères ne s'affichent que dans l'onglet Puck qui les concerne.
 */
export function createEditorTools(ctx: EditorContext) {
  const { scene, camera, renderer, controls, tour, reference } = ctx;
  const dom = renderer.domElement;
  let view: EditorView = { tab: '', activeWork: null, tourHelpers: true };

  // ---- Repères de la visite ---------------------------------------------------
  const tourGroup = new Group();
  tourGroup.name = 'tour-helpers';
  scene.add(tourGroup);
  const lineMat = new LineBasicMaterial({ color: COLORS.path, depthTest: false, transparent: true, opacity: 0.85 });
  const boxGeo = new BoxGeometry(1, 1, 1);
  const boxEdges = new EdgesGeometry(boxGeo);
  const boxMat = new MeshBasicMaterial({ color: COLORS.bounds, transparent: true, opacity: 0.08, depthTest: false, depthWrite: false });
  const boxLineMat = new LineBasicMaterial({ color: COLORS.bounds, transparent: true, opacity: 0.9, depthTest: false });

  /** Repères pouvant recevoir le gizmo, par clé : hub, focus:i, cam:i:j, bounds:i, orbitFocus. */
  const markers = new Map<string, Object3D>();
  /** Sous-groupe par œuvre : points caméra, tracé et boîte (affichés si l'œuvre est ouverte). */
  const workGroups: Group[] = [];
  const badgeCache = new Map<string, SpriteMaterial>();
  const badge = (color: string, label: string, active: boolean) => {
    const k = `${color}|${label}|${active}`;
    if (!badgeCache.has(k)) badgeCache.set(k, badgeMaterial(color, label, active));
    return badgeCache.get(k)!;
  };

  function sprite(key: string, color: string, label: string, size: number, parent: Object3D, pos: Vec3) {
    const s = new Sprite(badge(color, label, false));
    s.userData = { color, label };
    s.scale.setScalar(size);
    s.position.set(...pos);
    s.renderOrder = 1000;
    s.name = key;
    parent.add(s);
    markers.set(key, s);
    return s;
  }
  function setActiveLook(key: string | null, on: boolean) {
    const o = key ? markers.get(key) : null;
    if (o instanceof Sprite) o.material = badge(o.userData.color, o.userData.label, on);
    if (o instanceof Group) boxLineMat.color.set(on ? '#ffffff' : COLORS.bounds);
  }

  function placeBox(g: Object3D, b: TourBounds) {
    g.position.set(...b.center);
    g.rotation.set(0, MathUtils.degToRad(b.rotationY ?? 0), 0);
    g.scale.set(...b.size);
  }
  const pathGeo = (points: Vec3[]) =>
    new BufferGeometry().setFromPoints(new Path(points.map((p) => new Vector3(...p)), true).sample(120));

  function keysOf(cfg: TourConfig) {
    return cfg.works.map((w) => `${w.cameraPoints.length}${w.bounds ? 'b' : ''}`).join('|');
  }
  let builtKeys = '';
  let lastCfg: TourConfig | null = null;

  /**
   * Met à jour les repères de la visite. Même structure : positions mises à jour
   * en place (un glisser de gizmo en cours n'est pas interrompu) ; sinon reconstruits.
   */
  function setHelpers(cfg: TourConfig) {
    lastCfg = cfg;
    const keys = keysOf(cfg);
    if (keys !== builtKeys) rebuild(cfg, keys);
    markers.get('hub')!.position.set(...cfg.hub.position);
    cfg.works.forEach((w, i) => {
      markers.get(`focus:${i}`)!.position.set(...w.focus);
      w.cameraPoints.forEach((p, j) => markers.get(`cam:${i}:${j}`)!.position.set(...p));
      const line = workGroups[i].getObjectByName('path') as Line | undefined;
      if (line) {
        line.geometry.dispose();
        line.geometry = pathGeo(w.cameraPoints);
      }
      const box = markers.get(`bounds:${i}`);
      if (box && w.bounds) placeBox(box, w.bounds);
    });
    placeHandles();
    applyView();
  }

  function rebuild(cfg: TourConfig, keys: string) {
    builtKeys = keys;
    for (const o of [...tourGroup.children]) {
      tourGroup.remove(o);
      o.traverse((c) => c instanceof Line && c.geometry.dispose());
    }
    for (const k of [...markers.keys()]) if (k !== 'orbitFocus') markers.delete(k);
    workGroups.length = 0;
    sprite('hub', COLORS.hub, 'C', SIZE.hub, tourGroup, cfg.hub.position);
    cfg.works.forEach((w, i) => {
      // Focus numéroté (n° de l'œuvre), toujours affiché dans l'onglet Visite.
      sprite(`focus:${i}`, COLORS.focus, String(i + 1), SIZE.focus, tourGroup, w.focus);
      const g = new Group();
      g.name = `work:${i}`;
      tourGroup.add(g);
      workGroups.push(g);
      w.cameraPoints.forEach((p, j) => sprite(`cam:${i}:${j}`, COLORS.point, String(j + 1), SIZE.point, g, p));
      if (w.cameraPoints.length >= 2) {
        const line = new Line(pathGeo(w.cameraPoints), lineMat);
        line.name = 'path';
        line.renderOrder = 999;
        g.add(line);
      }
      if (w.bounds) {
        const box = new Group();
        const fill = new Mesh(boxGeo, boxMat);
        const edges = new LineSegments(boxEdges, boxLineMat);
        fill.renderOrder = edges.renderOrder = 998;
        box.add(fill, edges);
        box.name = `bounds:${i}`;
        g.add(box);
        markers.set(`bounds:${i}`, box);
      }
    });
    // Le gizmo suit le repère recréé (ou se détache si le repère a disparu).
    if (gizmoKey && markers.has(gizmoKey)) {
      setActiveLook(gizmoKey, true);
      gizmo.attach(markers.get(gizmoKey)!);
    } else if (gizmoKey) {
      detachGizmo();
    }
  }

  // ---- Point de focus de l'orbite (onglet Caméra orbitale) ---------------------
  const orbitGroup = new Group();
  orbitGroup.name = 'orbit-helpers';
  scene.add(orbitGroup);
  orbitGroup.add(new Box3Helper(reference.box, new Color(COLORS.orbit)));
  const orbitFocus = sprite('orbitFocus', COLORS.orbit, '', SIZE.orbit, orbitGroup, reference.focus.toArray() as Vec3);
  orbitFocus.onBeforeRender = () => {
    // Suit les réglages à chaud, sauf pendant un glisser au gizmo.
    if (!(gizmo.dragging && gizmoKey === 'orbitFocus')) orbitFocus.position.copy(reference.focus);
  };

  // ---- Visibilité selon l'onglet -------------------------------------------------
  function applyView() {
    const inTour = view.tab === TAB_TOUR && view.tourHelpers;
    tourGroup.visible = inTour;
    workGroups.forEach((g, i) => (g.visible = i === view.activeWork));
    orbitGroup.visible = view.tab === TAB_ORBIT;
    placeHandles();
  }
  const visibleInScene = (o: Object3D | null) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return !!o;
  };

  // ---- Gizmo (TransformControls) --------------------------------------------
  const gizmo = new TransformControls(camera, dom);
  gizmo.setSize(0.8);
  scene.add(gizmo.getHelper());
  let gizmoKey: string | null = null;
  let gizmoMove: ((v: Vec3) => void) | null = null;
  let gizmoRotate: ((deg: number) => void) | null = null;
  const yaw = new Euler();
  gizmo.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value && !fly.enabled && !tour.active;
  });
  gizmo.addEventListener('objectChange', () => {
    const o = gizmo.object;
    if (!o) return;
    // Lacet lu en ordre YXZ : plage complète ±180° (l'ordre XYZ replie au-delà de 90°).
    if (gizmo.mode === 'rotate') gizmoRotate?.(r2(MathUtils.radToDeg(yaw.setFromQuaternion(o.quaternion, 'YXZ').y)));
    else gizmoMove?.(o.position.toArray().map(r2) as Vec3);
  });

  /**
   * Attache le gizmo au repère `key`. Déplacement : onMove(position).
   * Rotation (boîte) : opts.rotate(degrés), autour de la verticale seulement.
   */
  function attachGizmo(key: string, onMove: (v: Vec3) => void, opts: { rotate?: (deg: number) => void } = {}) {
    const m = markers.get(key);
    if (!m) return false;
    setActiveLook(gizmoKey, false);
    gizmoKey = key;
    gizmoMove = onMove;
    gizmoRotate = opts.rotate ?? null;
    const rotate = !!opts.rotate;
    gizmo.setMode(rotate ? 'rotate' : 'translate');
    gizmo.setSpace('world');
    gizmo.showX = gizmo.showZ = !rotate;
    gizmo.showY = true;
    setActiveLook(key, true);
    gizmo.attach(m);
    return true;
  }
  function detachGizmo(key?: string) {
    if (key && key !== gizmoKey) return;
    setActiveLook(gizmoKey, false);
    gizmoKey = null;
    gizmoMove = null;
    gizmoRotate = null;
    gizmo.detach();
  }

  // ---- Pointage sur le scan -------------------------------------------------
  const raycaster = new Raycaster();
  let pickResolve: ((v: Vec3 | null) => void) | null = null;
  const ndcOf = (e: PointerEvent) => {
    const r = dom.getBoundingClientRect();
    return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const onPick = (e: PointerEvent) => {
    if (!pickResolve || e.button !== 0) return;
    e.stopPropagation();
    raycaster.setFromCamera(ndcOf(e), camera);
    const hit = raycaster.intersectObjects(ctx.pickTargets, true)[0];
    finishPick(hit ? (hit.point.toArray().map(r2) as Vec3) : null);
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

  // ---- Poignées de la boîte : chaque face glisse le long de sa normale ---------
  const handles = new Group();
  handles.name = 'bounds-handles';
  scene.add(handles);
  // Une poignée par face : axe local (0 x, 1 y, 2 z) et côté (-1 / +1).
  const faces = [0, 1, 2].flatMap((axis) => [-1, 1].map((side) => ({ axis, side })));
  const handleSprites = faces.map(({ axis }) => {
    const s = new Sprite(badgeMaterial(AXIS_COLORS[axis], ''));
    s.scale.setScalar(SIZE.handle);
    s.renderOrder = 1001;
    handles.add(s);
    return s;
  });
  let boundsEdit: { work: number; onChange: (b: TourBounds) => void } | null = null;
  const editedBounds = () => (boundsEdit ? lastCfg?.works[boundsEdit.work]?.bounds : undefined);
  /** Axe local `axis` de la boîte, en repère monde (rotation autour de la verticale). */
  const axisDir = (b: TourBounds, axis: number) =>
    new Vector3().setComponent(axis, 1).applyAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(b.rotationY ?? 0));
  function placeHandles() {
    const b = editedBounds();
    handles.visible = !!b && view.tab === TAB_TOUR && view.tourHelpers && boundsEdit?.work === view.activeWork;
    if (!b) return;
    faces.forEach(({ axis, side }, k) => {
      handleSprites[k].position.set(...b.center).addScaledVector(axisDir(b, axis), (side * b.size[axis]) / 2);
    });
  }
  // Glisser une poignée : point de l'axe de la face le plus proche du rayon souris.
  let faceDrag: { k: number; origin: Vector3; dir: Vector3; start: number; bounds: TourBounds } | null = null;
  function axisParam(e: PointerEvent, origin: Vector3, dir: Vector3) {
    raycaster.setFromCamera(ndcOf(e), camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    const w0 = origin.clone().sub(o);
    const b = dir.dot(d);
    const denom = 1 - b * b;
    if (denom < 1e-6) return 0;
    return (b * d.dot(w0) - dir.dot(w0)) / denom;
  }
  const onHandleDown = (e: PointerEvent) => {
    const b = editedBounds();
    if (!b || !handles.visible || e.button !== 0 || pickResolve) return;
    raycaster.setFromCamera(ndcOf(e), camera);
    const hit = raycaster.intersectObjects(handleSprites, false)[0];
    if (!hit) return;
    e.stopImmediatePropagation();
    const k = handleSprites.indexOf(hit.object as Sprite);
    const dir = axisDir(b, faces[k].axis);
    const origin = handleSprites[k].position.clone();
    faceDrag = { k, origin, dir, start: axisParam(e, origin, dir), bounds: structuredClone(b) };
    controls.enabled = false;
    try {
      dom.setPointerCapture(e.pointerId);
    } catch {
      // Pointeur déjà relâché : le glisser s'arrêtera au prochain pointerup.
    }
  };
  const onHandleMove = (e: PointerEvent) => {
    if (!faceDrag || !boundsEdit) return;
    const { axis, side } = faces[faceDrag.k];
    const b0 = faceDrag.bounds;
    // Déplacement de la face le long de sa normale ; la face opposée reste en place.
    let delta = axisParam(e, faceDrag.origin, faceDrag.dir) - faceDrag.start;
    const size = Math.max(b0.size[axis] + side * delta, 0.2);
    delta = (size - b0.size[axis]) * side;
    const center = new Vector3(...b0.center).addScaledVector(faceDrag.dir, delta / 2);
    const next: TourBounds = { ...b0, center: center.toArray().map(r2) as Vec3, size: [...b0.size] as Vec3 };
    next.size[axis] = r2(size);
    boundsEdit.onChange(next);
  };
  const onHandleUp = () => {
    if (!faceDrag) return;
    faceDrag = null;
    controls.enabled = !fly.enabled && !tour.active;
  };
  dom.addEventListener('pointerdown', onHandleDown, { capture: true });
  dom.addEventListener('pointermove', onHandleMove);
  dom.addEventListener('pointerup', onHandleUp);

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
    /** Chaque image : vol libre ; pas d'autoRotate avec un gizmo ; gizmo masqué avec son repère. */
    update(dt: number) {
      fly.update(dt);
      if (gizmoKey) controls.autoRotate = false;
      gizmo.getHelper().visible = !!gizmo.object && visibleInScene(gizmo.object);
      gizmo.enabled = gizmo.getHelper().visible;
    },
    setHelpers,
    /** Onglet courant, œuvre ouverte, interrupteur des repères. */
    setView(next: Partial<EditorView>) {
      view = { ...view, ...next };
      applyView();
    },
    setFly,
    attachGizmo,
    detachGizmo,
    /** Affiche les poignées de la boîte de l'œuvre `work` ; null : masque. */
    editBounds(work: number | null, onChange?: (b: TourBounds) => void) {
      boundsEdit = work === null || !onChange ? null : { work, onChange };
      placeHandles();
    },
    /** Boîte englobant le focus et les points caméra de l'œuvre, avec une marge (m). */
    suggestBounds(work: number, margin = 2): TourBounds | null {
      const w = lastCfg?.works[work];
      if (!w) return null;
      const pts = [w.focus, ...w.cameraPoints];
      const min = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])) - margin);
      const max = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])) + margin);
      return {
        center: min.map((v, k) => r2((v + max[k]) / 2)) as Vec3,
        size: min.map((v, k) => r2(max[k] - v)) as Vec3,
        rotationY: 0,
      };
    },
    get gizmoKey() {
      return gizmoKey;
    },
    /** Position actuelle de la caméra (arrondie au cm). */
    capture: (): Vec3 => camera.position.toArray().map(r2) as Vec3,
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
      dom.removeEventListener('pointerdown', onHandleDown, { capture: true });
      dom.removeEventListener('pointermove', onHandleMove);
      dom.removeEventListener('pointerup', onHandleUp);
      gizmo.detach();
      gizmo.dispose();
      fly.dispose();
      scene.remove(tourGroup, orbitGroup, handles, gizmo.getHelper());
      for (const m of badgeCache.values()) {
        m.map?.dispose();
        m.dispose();
      }
    },
  };
}

export type EditorTools = ReturnType<typeof createEditorTools>;
