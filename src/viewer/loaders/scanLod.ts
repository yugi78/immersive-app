import {
  DoubleSide,
  Frustum,
  Group,
  ImageBitmapLoader,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  Sphere,
  Texture,
  Vector3,
  type BufferGeometry,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** manifest.json produit par scripts/scan_lod/build_tiles.py */
interface ScanManifest {
  tileMax: number;
  levels: number[];
  tiles: {
    id: string;
    geometry: string;
    bbox: { min: [number, number, number]; max: [number, number, number] };
    textures: Record<string, string>;
  }[];
}

export interface ScanLodOptions {
  manifestUrl: string;
  /** Matrice monde du gabarit scan.glb (scanTransform) : place le repère local du scan. */
  transform: number[];
  /** Niveau de texture maximal autorisé (px), sur tous les appareils. */
  maxLevel: number;
  /** Budget mémoire GPU des textures au-dessus du niveau de base (Mo). */
  budgetMB: number;
  /** > 1 : monte de niveau plus tôt ; < 1 : plus tard. */
  lodBias: number;
  /** Délai avant de redescendre de niveau (évite le clignotement en orbite). */
  downgradeDelayMs: number;
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  onProgress?: (ratio: number) => void;
}

interface TileState {
  id: string;
  mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  textures: Record<string, string>;
  sphere: Sphere; // monde
  base: Texture; // niveau minimal, toujours résident
  hi: Texture | null; // niveau courant > base
  level: number;
  loading: number | null;
  wantLowerSince: number;
  screenPx: number;
}

/** Mémoire GPU d'une texture RGBA8 avec mipmaps. */
const textureBytes = (size: number) => (size * size * 4 * 4) / 3;

/**
 * Scan des plafonds en tuiles avec LOD de texture.
 * - Toutes les tuiles (géométrie + texture minimale) sont chargées au départ.
 * - Toutes les ~150 ms, chaque tuile reçoit un niveau cible selon la taille à l'écran de sa
 *   sphère englobante, dans la limite du budget mémoire (priorité aux plus grandes à l'écran).
 * - Montée immédiate, descente après `downgradeDelayMs` ; anciennes textures libérées.
 */
export async function createScanLod(opts: ScanLodOptions) {
  const baseUrl = opts.manifestUrl.slice(0, opts.manifestUrl.lastIndexOf('/') + 1);
  const manifest: ScanManifest = await (await fetch(opts.manifestUrl)).json();
  const levels = manifest.levels.filter((l) => l <= opts.maxLevel).sort((a, b) => a - b);
  const minLevel = levels[0];

  const root = new Group();
  root.name = 'scan-lod';
  root.matrixAutoUpdate = false;
  root.matrix.fromArray(opts.transform);
  root.updateMatrixWorld(true);

  const anisotropy = Math.min(4, opts.renderer.capabilities.getMaxAnisotropy());
  const imageLoader = new ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });

  async function loadTexture(file: string) {
    const bitmap = await imageLoader.loadAsync(baseUrl + file);
    const tex = new Texture(bitmap as unknown as HTMLImageElement);
    tex.flipY = false; // convention glTF
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = true;
    return tex;
  }
  function disposeTexture(tex: Texture) {
    tex.dispose();
    (tex.image as ImageBitmap | undefined)?.close?.();
  }

  const gltfLoader = new GLTFLoader();
  let done = 0;
  const tiles: TileState[] = await Promise.all(
    manifest.tiles.map(async (t) => {
      const [gltf, base] = await Promise.all([
        gltfLoader.loadAsync(baseUrl + t.geometry),
        loadTexture(t.textures[String(minLevel)]),
      ]);
      let geometry: BufferGeometry | undefined;
      gltf.scene.traverse((o) => {
        if (o instanceof Mesh) geometry = o.geometry;
      });
      if (!geometry) throw new Error(`tuile ${t.id} sans géométrie`);
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: base, side: DoubleSide }));
      mesh.name = t.id;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);

      const min = new Vector3(...t.bbox.min);
      const max = new Vector3(...t.bbox.max);
      const sphere = new Sphere(min.clone().add(max).multiplyScalar(0.5), min.distanceTo(max) / 2).applyMatrix4(root.matrixWorld);
      opts.onProgress?.(++done / manifest.tiles.length);
      return { id: t.id, mesh, textures: t.textures, sphere, base, hi: null, level: minLevel, loading: null, wantLowerSince: 0, screenPx: 0 };
    }),
  );
  root.updateMatrixWorld(true);

  const frustum = new Frustum();
  const projView = new Matrix4();
  const budget = opts.budgetMB * 1024 * 1024;
  const MAX_CONCURRENT = 3;
  let inFlight = 0;
  let lastUpdate = 0;

  function setLevel(tile: TileState, level: number) {
    if (level === minLevel) {
      if (tile.hi) disposeTexture(tile.hi);
      tile.hi = null;
      tile.mesh.material.map = tile.base;
      tile.level = minLevel;
      return;
    }
    if (inFlight >= MAX_CONCURRENT || tile.loading !== null) return;
    tile.loading = level;
    inFlight++;
    loadTexture(tile.textures[String(level)])
      .then((tex) => {
        if (tile.loading !== level) return disposeTexture(tex); // cible changée entre-temps
        const old = tile.hi;
        tile.hi = tex;
        tile.mesh.material.map = tex;
        tile.level = level;
        if (old) disposeTexture(old);
      })
      .catch((err) => console.warn(`[scan] texture ${tile.id}@${level}`, err))
      .finally(() => {
        if (tile.loading === level) tile.loading = null;
        inFlight--;
      });
  }

  function update(now = performance.now()) {
    if (now - lastUpdate < 150) return;
    lastUpdate = now;
    const cam = opts.camera;
    projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    const viewH = opts.renderer.domElement.height; // pixels réels (pixelRatio inclus)
    const k = viewH / (2 * Math.tan((cam.fov * Math.PI) / 360));

    // 1. Taille à l'écran (px) et niveau souhaité de chaque tuile.
    for (const t of tiles) {
      const visible = frustum.intersectsSphere(t.sphere);
      const d = Math.max(cam.position.distanceTo(t.sphere.center) - t.sphere.radius, 0.01);
      t.screenPx = visible ? ((2 * t.sphere.radius) / d) * k : 0;
    }
    // 2. Budget : les plus grandes à l'écran servies en premier.
    const order = [...tiles].sort((a, b) => b.screenPx - a.screenPx);
    let used = 0;
    for (const t of order) {
      const wanted = t.screenPx * opts.lodBias;
      let level = levels.find((l) => l >= wanted) ?? levels[levels.length - 1];
      while (level > minLevel && used + textureBytes(level) > budget) level /= 2;
      if (level > minLevel) used += textureBytes(level);

      if (level > t.level) {
        t.wantLowerSince = 0;
        if (t.loading !== level) setLevel(t, level);
      } else if (level < t.level) {
        if (!t.wantLowerSince) t.wantLowerSince = now;
        if (now - t.wantLowerSince >= opts.downgradeDelayMs) {
          t.wantLowerSince = 0;
          t.loading = null;
          setLevel(t, level);
        }
      } else {
        t.wantLowerSince = 0;
      }
    }
  }

  function stats() {
    const perLevel: Record<number, number> = {};
    let bytes = 0;
    for (const t of tiles) {
      perLevel[t.level] = (perLevel[t.level] ?? 0) + 1;
      bytes += textureBytes(minLevel) + (t.level > minLevel ? textureBytes(t.level) : 0);
    }
    return { perLevel, textureMB: Math.round(bytes / 1048576), loading: inFlight };
  }

  return {
    root,
    tiles,
    levels,
    update,
    stats,
    dispose() {
      for (const t of tiles) {
        if (t.hi) disposeTexture(t.hi);
        disposeTexture(t.base);
        t.mesh.geometry.dispose();
        t.mesh.material.dispose();
      }
      root.removeFromParent();
    },
  };
}
