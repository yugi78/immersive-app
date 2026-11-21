import {
  DoubleSide,
  PerspectiveCamera,
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
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

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
  /** Dossier du transcodeur Basis (textures .ktx2). */
  basisTranscoderPath: string;
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

/**
 * Réessaie une requête qui échoue (ex. 503 passagère de GitHub Pages juste après
 * un déploiement, cache encore froid), avec une attente croissante.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries) throw err;
      const wait = 400 * 2 ** (i - 1) + Math.random() * 200;
      console.info(`[scan] ${what} : échec (essai ${i}/${tries}), nouvel essai dans ${Math.round(wait)} ms`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
}

/** Exécute `fn` sur chaque élément avec au plus `limit` tâches simultanées. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Requêtes simultanées au chargement initial (évite les 503 des hébergeurs statiques). */
const INITIAL_CONCURRENCY = 8;

/**
 * Mémoire GPU d'une texture avec mipmaps. RGBA8 pour le JPEG (4 o/px) ; pour le
 * KTX2 ETC1S, transcodé en format compressé GPU (0,5 à 1 o/px), on compte 1 o/px.
 */
let bytesPerPixel = 4;
const textureBytes = (size: number) => (size * size * bytesPerPixel * 4) / 3;

/**
 * Scan des plafonds en tuiles avec LOD de texture.
 * - Toutes les tuiles (géométrie + texture minimale) sont chargées au départ.
 * - Toutes les ~150 ms, chaque tuile reçoit un niveau cible selon la taille à l'écran de sa
 *   sphère englobante, dans la limite du budget mémoire (priorité aux plus grandes à l'écran).
 * - Montée immédiate, descente après `downgradeDelayMs` ; anciennes textures libérées.
 */
export async function createScanLod(opts: ScanLodOptions) {
  const baseUrl = opts.manifestUrl.slice(0, opts.manifestUrl.lastIndexOf('/') + 1);
  const manifest: ScanManifest = await withRetry('manifest', async () => {
    const res = await fetch(opts.manifestUrl);
    if (!res.ok) throw new Error(`${opts.manifestUrl} : HTTP ${res.status}`);
    return res.json();
  });
  const levels = manifest.levels.filter((l) => l <= opts.maxLevel).sort((a, b) => a - b);
  const minLevel = levels[0];

  const root = new Group();
  root.name = 'scan-lod';
  root.matrixAutoUpdate = false;
  root.matrix.fromArray(opts.transform);
  root.updateMatrixWorld(true);

  const anisotropy = Math.min(4, opts.renderer.capabilities.getMaxAnisotropy());
  const imageLoader = new ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
  // Textures .ktx2 (ETC1S) : transcodées dans des workers, sans décodage sur le thread principal.
  const isKtx2 = manifest.tiles.some((t) => Object.values(t.textures).some((f) => f.endsWith('.ktx2')));
  const ktx2Loader = isKtx2 ? new KTX2Loader().setTranscoderPath(opts.basisTranscoderPath).detectSupport(opts.renderer) : null;
  if (isKtx2) bytesPerPixel = 1;

  async function loadTexture(file: string) {
    if (file.endsWith('.ktx2') && ktx2Loader) {
      // Couleur sRGB lue dans le fichier ; flipY toujours faux pour une texture compressée.
      const tex = await withRetry(file, () => ktx2Loader.loadAsync(baseUrl + file));
      tex.anisotropy = anisotropy;
      return tex as Texture;
    }
    const bitmap = await withRetry(file, () => imageLoader.loadAsync(baseUrl + file));
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

  // Géométrie compressée meshopt (EXT_meshopt_compression) ; sans effet sur les GLB non compressés.
  const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let done = 0;
  // Une tuile qui échoue malgré les nouveaux essais est ignorée (trou local dans
  // le scan) plutôt que de faire échouer tout le chargement.
  const loadedTiles = await mapPool(manifest.tiles, INITIAL_CONCURRENCY, async (t): Promise<TileState | null> => {
    try {
      const [gltf, base] = await Promise.all([
        withRetry(t.geometry, () => gltfLoader.loadAsync(baseUrl + t.geometry)),
        loadTexture(t.textures[String(minLevel)]),
      ]);
      let geometry: BufferGeometry | undefined;
      // Transformation du nœud dans le GLB : identité pour les tuiles brutes, et
      // déquantification (échelle + translation) pour les tuiles quantifiées.
      const nodeMatrix = new Matrix4();
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (o instanceof Mesh) {
          geometry = o.geometry;
          nodeMatrix.copy(o.matrixWorld);
        }
      });
      if (!geometry) throw new Error(`tuile ${t.id} sans géométrie`);
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: base, side: DoubleSide }));
      mesh.name = t.id;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(nodeMatrix);
      root.add(mesh);

      const min = new Vector3(...t.bbox.min);
      const max = new Vector3(...t.bbox.max);
      const sphere = new Sphere(min.clone().add(max).multiplyScalar(0.5), min.distanceTo(max) / 2).applyMatrix4(root.matrixWorld);
      return { id: t.id, mesh, textures: t.textures, sphere, base, hi: null, level: minLevel, loading: null, wantLowerSince: 0, screenPx: 0 };
    } catch (err) {
      console.warn(`[scan] tuile ${t.id} ignorée`, err);
      return null;
    } finally {
      opts.onProgress?.(++done / manifest.tiles.length);
    }
  });
  const tiles = loadedTiles.filter((t): t is TileState => t !== null);
  if (tiles.length === 0) throw new Error('aucune tuile du scan n’a pu être chargée');
  if (tiles.length < manifest.tiles.length) {
    console.warn(`[scan] ${manifest.tiles.length - tiles.length} tuile(s) sur ${manifest.tiles.length} indisponibles`);
  }
  root.updateMatrixWorld(true);

  const frustum = new Frustum();
  const projView = new Matrix4();
  const budget = opts.budgetMB * 1024 * 1024;
  // Téléchargements de textures HD simultanés (en arrière-plan, après l’affichage).
  const MAX_CONCURRENT = 6;
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

  // Caméra virtuelle placée à la destination d'une transition (visite guidée).
  const aheadCam = new PerspectiveCamera();
  const aheadFrustum = new Frustum();

  /**
   * Choisit le niveau de chaque tuile pour la caméra donnée (appelé à chaque image).
   * `lookahead` : destination d'une transition ; les tuiles vues depuis là passent
   * en haute définition en priorité, avant même l'arrivée.
   */
  function update(cam: PerspectiveCamera, lookahead?: { position: Vector3; target: Vector3 } | null, now = performance.now()) {
    if (now - lastUpdate < 150) return;
    lastUpdate = now;
    projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    const viewH = opts.renderer.domElement.height; // pixels réels (pixelRatio inclus)
    const k = viewH / (2 * Math.tan((cam.fov * Math.PI) / 360));
    if (lookahead) {
      aheadCam.fov = cam.fov;
      aheadCam.aspect = cam.aspect;
      aheadCam.near = cam.near;
      aheadCam.far = cam.far;
      aheadCam.updateProjectionMatrix();
      aheadCam.position.copy(lookahead.position);
      aheadCam.lookAt(lookahead.target);
      aheadCam.updateMatrixWorld();
      projView.multiplyMatrices(aheadCam.projectionMatrix, aheadCam.matrixWorldInverse);
      aheadFrustum.setFromProjectionMatrix(projView);
    }

    // 1. Taille à l'écran (px) de chaque tuile, qu'elle soit dans le champ ou non :
    //    une tuile proche hors champ garde sa définition si le budget le permet
    //    (pas de rechargement en orbite).
    // 2. Budget servi par paliers : d'abord les tuiles dans le champ (et celles de la
    //    destination d'une transition), puis les autres ; à palier égal, les plus
    //    grandes à l'écran. Sans ces paliers, à l'intérieur du Panthéon, les tuiles
    //    qui entourent la caméra (hors champ, mais énormes à l'écran) prenaient tout
    //    le budget et l'œuvre regardée restait en 256.
    const tier = new Map<TileState, number>();
    for (const t of tiles) {
      const d = Math.max(cam.position.distanceTo(t.sphere.center) - t.sphere.radius, 0.01);
      t.screenPx = ((2 * t.sphere.radius) / d) * k;
      let level = frustum.intersectsSphere(t.sphere) ? 2 : 0;
      if (lookahead && aheadFrustum.intersectsSphere(t.sphere)) {
        const da = Math.max(lookahead.position.distanceTo(t.sphere.center) - t.sphere.radius, 0.01);
        t.screenPx = Math.max(t.screenPx, ((2 * t.sphere.radius) / da) * k);
        level = Math.max(level, 1);
      }
      tier.set(t, level);
    }
    const order = [...tiles].sort((a, b) => tier.get(b)! - tier.get(a)! || b.screenPx - a.screenPx);
    let used = 0;
    for (const t of order) {
      const wanted = t.screenPx * opts.lodBias;
      let i = levels.findIndex((l) => l >= wanted);
      if (i < 0) i = levels.length - 1;
      // Hors budget : niveau inférieur (pas forcément la moitié, ex. 2048 → 256).
      while (i > 0 && used + textureBytes(levels[i]) > budget) i--;
      const level = levels[i];
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
      ktx2Loader?.dispose();
      root.removeFromParent();
    },
  };
}
