import {
  Box3,
  Color,
  MathUtils,
  Matrix4,
  OrthographicCamera,
  Plane,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { MapConfig, MapView } from '../config/types';

/** Calques de rendu : la carte ne montre que ce qui la concerne. */
export const LAYER_PLAN = 1; // sol + tranche de coupe (mini-carte)
export const LAYER_WALLS = 2; // carte : sol + maquette + scan, coupés par le plan de la vue

/** Marque des objets (et leurs descendants) comme visibles dans un calque de la carte. */
export function enableLayer(root: Object3D, layer: number) {
  root.traverse((o) => o.layers.enable(layer));
}

const UP = new Vector3(0, 1, 0);
const ZOOM_MIN = 1;
const ZOOM_MAX = 14;

/** Repère d'une vue : centre, axes de l'écran, profondeur et cadre (mètres). */
interface Frame {
  center: Vector3;
  right: Vector3;
  up: Vector3;
  forward: Vector3;
  width: number;
  height: number;
  /** Plan de coupe : passe par le centre, normal au regard ; on garde ce qui est au-delà. */
  clip: Plane;
}

/** Durée de la transition animée d'une vue à l'autre (s). */
const TRANSITION_S = 1.3;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Zone de l'écran (px) où cadrer la vue : la carte évite titres et vignettes. */
export interface SafeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MapViewOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  /** Emprise du Panthéon (cadre du plan). */
  box: Box3;
  config: () => MapConfig;
  mobile: () => boolean;
}

/**
 * Carte interactive : rendu orthogonal EN DIRECT de la scène principale (net à
 * tous les zooms, le scan se charge en haute définition à la demande).
 * Chaque vue est un POINT : un centre et un regard (plan : vers le bas ; murs :
 * horizontal ; plafonds : vers le haut). Le plan de coupe passe par le point,
 * perpendiculaire au regard ; tout ce qui est devant est coupé. D'une vue à
 * l'autre, la caméra glisse et pivote (position, orientation, cadre et plan de
 * coupe interpolés). Zoom (molette, pincement) et déplacement (glisser) amortis.
 */
export function createMapView(o: MapViewOptions) {
  const { renderer, scene } = o;
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.5, 4000);
  const bg = new Color();
  let active = false;
  let view = 0;
  let frame: Frame;
  let safe: SafeRect = { left: 0, top: 0, width: 1, height: 1 };

  // Zoom et décalage (mètres, dans le plan de l'écran) : cible et valeur amortie.
  const want = { zoom: 1, x: 0, y: 0 };
  const cur = { zoom: 1, x: 0, y: 0 };

  /** Emprise du Panthéon sur des axes d'écran donnés (cadre du plan et des plafonds). */
  function footprint(right: Vector3, up: Vector3) {
    const b = o.box;
    const c = b.getCenter(new Vector3());
    let w = 0;
    let h = 0;
    for (const x of [b.min.x, b.max.x])
      for (const z of [b.min.z, b.max.z]) {
        const d = new Vector3(x - c.x, 0, z - c.z);
        w = Math.max(w, Math.abs(d.dot(right)) * 2);
        h = Math.max(h, Math.abs(d.dot(up)) * 2);
      }
    return { w: w * 1.06, h: h * 1.06 };
  }

  function frameFor(v: MapView): Frame {
    const center = new Vector3(...v.center);
    let forward: Vector3;
    let up: Vector3;
    let width = Math.max(v.width, 1);
    let height = Math.max(v.height, 1);
    if (v.kind === 'wall') {
      const a = MathUtils.degToRad(v.yaw);
      forward = new Vector3(-Math.sin(a), 0, -Math.cos(a));
      up = UP.clone();
    } else {
      // Plan (regard vers le bas) ou plafonds (vers le haut) : haut de l'image = -z,
      // tourné selon l'orientation du plan (écran large / mobile).
      const cfg = o.config();
      const rot = MathUtils.degToRad(o.mobile() ? cfg.planRotationMobile : cfg.planRotationDesktop);
      forward = new Vector3(0, v.kind === 'ceiling' ? 1 : -1, 0);
      up = new Vector3(0, 0, -1).applyAxisAngle(UP, rot);
    }
    const right = new Vector3().crossVectors(forward, up).normalize();
    if (v.kind !== 'wall') ({ w: width, h: height } = footprint(right, up));
    return { center, right, up, forward, width, height, clip: new Plane().setFromNormalAndCoplanarPoint(forward, center) };
  }

  /** Vue de repli si la configuration est vide : plan au centre du Panthéon. */
  function fallback(): MapView {
    const c = o.box.getCenter(new Vector3());
    return { name: 'Plan', kind: 'plan', center: [c.x, o.box.min.y + 8, c.z], yaw: 0, width: 100, height: 100 };
  }

  function frameOf(i: number): Frame {
    const views = o.config()?.views ?? [];
    return frameFor(views[i] ?? views[0] ?? fallback());
  }

  /** Repère intermédiaire entre deux vues (t de 0 à 1) : glissement et rotation. */
  const qa = new Quaternion();
  const qb = new Quaternion();
  const mBasis = new Matrix4();
  const quatOf = (f: Frame, q: Quaternion) => q.setFromRotationMatrix(mBasis.makeBasis(f.right, f.up, f.forward.clone().negate()));
  function blend(a: Frame, b: Frame, t: number): Frame {
    quatOf(a, qa);
    quatOf(b, qb);
    const q = qa.slerp(qb, t);
    const right = new Vector3(1, 0, 0).applyQuaternion(q);
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    const forward = new Vector3(0, 0, -1).applyQuaternion(q);
    const center = a.center.clone().lerp(b.center, t);
    return {
      center,
      right,
      up,
      forward,
      width: MathUtils.lerp(a.width, b.width, t),
      height: MathUtils.lerp(a.height, b.height, t),
      clip: new Plane().setFromNormalAndCoplanarPoint(forward, center),
    };
  }
  let anim: { from: Frame; to: Frame; t: number } | null = null;

  /** Mètres par pixel CSS à zoom 1 : la vue entière tient dans la zone libre. */
  const baseScale = (f: Frame, r: SafeRect) => Math.max(f.width / Math.max(r.width, 1), f.height / Math.max(r.height, 1));

  /** Place une caméra orthogonale sur un repère, pour un écran w × h (px) et une zone libre. */
  function place(cam: OrthographicCamera, f: Frame, w: number, h: number, r: SafeRect, zoom: number, px: number, py: number) {
    const s = baseScale(f, r) / zoom;
    cam.left = (-w / 2) * s;
    cam.right = (w / 2) * s;
    cam.top = (h / 2) * s;
    cam.bottom = (-h / 2) * s;
    cam.zoom = 1;
    cam.updateProjectionMatrix();
    // Centre de la zone libre = centre de la vue + décalage utilisateur.
    const ox = px + (w / 2 - (r.left + r.width / 2)) * s;
    const oy = py + (r.top + r.height / 2 - h / 2) * s;
    cam.position.copy(f.center).addScaledVector(f.right, ox).addScaledVector(f.up, oy).addScaledVector(f.forward, -1500);
    cam.up.copy(f.up);
    cam.lookAt(cam.position.clone().add(f.forward));
    cam.updateMatrixWorld();
    cam.layers.set(LAYER_WALLS);
  }

  const size = () => ({ w: renderer.domElement.clientWidth || 1, h: renderer.domElement.clientHeight || 1 });

  /** Point du plan de l'écran (repère de la vue, mètres) sous un pixel, pour l'état `st`. */
  function screenToPlane(x: number, y: number, st: { zoom: number; x: number; y: number }) {
    const s = baseScale(frame, safe) / st.zoom;
    const cx = safe.left + safe.width / 2;
    const cy = safe.top + safe.height / 2;
    return { x: st.x + (x - cx) * s, y: st.y + (cy - y) * s };
  }

  function clampPan(st: { zoom: number; x: number; y: number }) {
    st.zoom = MathUtils.clamp(st.zoom, ZOOM_MIN, ZOOM_MAX);
    st.x = MathUtils.clamp(st.x, -frame.width / 2, frame.width / 2);
    st.y = MathUtils.clamp(st.y, -frame.height / 2, frame.height / 2);
  }

  function setView(i: number, animate = false) {
    const to = frameOf(i);
    if (animate && active && frame) {
      // Départ = la vue telle qu'affichée : décalage et zoom intégrés au repère.
      const from: Frame = {
        ...frame,
        center: frame.center.clone().addScaledVector(frame.right, cur.x).addScaledVector(frame.up, cur.y),
        width: frame.width / cur.zoom,
        height: frame.height / cur.zoom,
      };
      anim = { from, to, t: 0 };
      frame = from;
    } else {
      anim = null;
      frame = to;
    }
    view = i;
    want.zoom = cur.zoom = 1;
    want.x = cur.x = 0;
    want.y = cur.y = 0;
  }
  frame = frameOf(0);

  // ---- Rendu ------------------------------------------------------------------------
  function withMapState<T>(f: Frame, fn: () => T): T {
    const prevBg = scene.background;
    const prevClip = renderer.clippingPlanes;
    bg.set(o.config().background);
    scene.background = bg;
    renderer.clippingPlanes = [f.clip];
    try {
      return fn();
    } finally {
      scene.background = prevBg;
      renderer.clippingPlanes = prevClip;
    }
  }

  return {
    camera,
    get active() {
      return active;
    },
    get view() {
      return view;
    },
    /** Plan de coupe de la vue affichée, pour le LOD du scan. */
    get clip() {
      return frame.clip;
    },
    open(i = 0) {
      active = true;
      setView(i);
    },
    close() {
      active = false;
      renderer.clippingPlanes = [];
    },
    setView,
    /** Réglages modifiés (back-office) : recadre la vue courante sans changer le zoom. */
    refresh() {
      if (!active) return;
      if (anim) anim.to = frameOf(view);
      else frame = frameOf(view);
      clampPan(want);
    },
    /** Transition en cours entre deux vues (zoom et déplacement suspendus). */
    get animating() {
      return anim !== null;
    },
    setSafeRect(r: SafeRect) {
      safe = r;
    },
    /** Zoom autour d'un point de l'écran (facteur multiplicatif). */
    zoomAt(x: number, y: number, factor: number) {
      if (anim) return;
      const before = screenToPlane(x, y, want);
      want.zoom = MathUtils.clamp(want.zoom * factor, ZOOM_MIN, ZOOM_MAX);
      const after = screenToPlane(x, y, want);
      want.x += before.x - after.x;
      want.y += before.y - after.y;
      clampPan(want);
    },
    /** Déplacement de la vue (pixels écran) : suit le doigt / la souris. */
    panBy(dx: number, dy: number, immediate = false) {
      if (anim) return;
      const s = baseScale(frame, safe) / want.zoom;
      want.x -= dx * s;
      want.y += dy * s;
      clampPan(want);
      if (immediate) Object.assign(cur, want);
    },
    /** Centre la vue sur un point du monde, avec un zoom donné (animé). */
    focusOn(p: Vector3, zoom: number) {
      const d = p.clone().sub(frame.center);
      want.zoom = MathUtils.clamp(zoom, ZOOM_MIN, ZOOM_MAX);
      want.x = d.dot(frame.right);
      want.y = d.dot(frame.up);
      clampPan(want);
    },
    get zoom() {
      return want.zoom;
    },
    /** Amortit zoom et déplacement, puis place la caméra. */
    update(dt: number) {
      if (anim) {
        anim.t = Math.min(anim.t + dt / TRANSITION_S, 1);
        frame = anim.t >= 1 ? anim.to : blend(anim.from, anim.to, ease(anim.t));
        if (anim.t >= 1) anim = null;
      }
      const k = 1 - Math.exp(-14 * dt);
      cur.zoom += (want.zoom - cur.zoom) * k;
      cur.x += (want.x - cur.x) * k;
      cur.y += (want.y - cur.y) * k;
      const { w, h } = size();
      place(camera, frame, w, h, safe, cur.zoom, cur.x, cur.y);
    },
    render() {
      withMapState(frame, () => renderer.render(scene, camera));
    },
    /**
     * Position écran (px) d'un point du monde dans la vue courante, ou null s'il est
     * coupé (devant le plan de coupe) ou hors du cadre de la vue.
     */
    project(p: Vector3, out = new Vector3()): { x: number; y: number } | null {
      if (anim || frame.clip.distanceToPoint(p) < 0) return null;
      const d = p.clone().sub(frame.center);
      if (Math.abs(d.dot(frame.right)) > frame.width / 2 || Math.abs(d.dot(frame.up)) > frame.height / 2) return null;
      out.copy(p).project(camera);
      const { w, h } = size();
      return { x: ((out.x + 1) / 2) * w, y: ((1 - out.y) / 2) * h };
    },
    /**
     * Vignettes des vues : rendu ponctuel en basse résolution (vue entière),
     * dessiné dans les canvas donnés.
     */
    thumbnails(canvases: HTMLCanvasElement[]) {
      const cam = new OrthographicCamera(-1, 1, 1, -1, 0.5, 4000);
      const prevTarget = renderer.getRenderTarget();
      canvases.forEach((c, i) => {
        const f = frameOf(i);
        const w = c.width;
        const h = c.height;
        const rt = new WebGLRenderTarget(w, h, { samples: 4 });
        rt.texture.colorSpace = SRGBColorSpace;
        place(cam, f, w, h, { left: 4, top: 4, width: w - 8, height: h - 8 }, 1, 0, 0);
        withMapState(f, () => {
          renderer.setRenderTarget(rt);
          renderer.clear();
          renderer.render(scene, cam);
        });
        const px = new Uint8Array(w * h * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
        rt.dispose();
        const img = new ImageData(w, h);
        for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        c.getContext('2d')!.putImageData(img, 0, 0);
      });
      renderer.setRenderTarget(prevTarget);
    },
    /** Cadrage d'une vue depuis une caméra (back-office) : centre (position) et direction horizontale. */
    frameFromCamera(cam: { position: Vector3; getWorldDirection(v: Vector3): Vector3 }) {
      const dir = cam.getWorldDirection(new Vector3());
      const yaw = MathUtils.radToDeg(Math.atan2(-dir.x, -dir.z));
      return { center: cam.position.toArray().map((v) => Math.round(v * 100) / 100) as [number, number, number], yaw: Math.round(yaw * 10) / 10 };
    },
  };
}

export type MapViewer = ReturnType<typeof createMapView>;
