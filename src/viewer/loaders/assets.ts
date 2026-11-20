import { LoadingManager, type Object3D, type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AssetItem } from '../config/types';

export interface LoadedAsset {
  item: AssetItem;
  root: Object3D;
}

export interface LoadCallbacks {
  onProgress?: (ratio: number) => void;
}

/** Vérifie qu'un asset optionnel existe avant de l'ajouter au chargement. */
async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    // Le serveur de dev peut renvoyer une page HTML 200 pour un fichier absent.
    return res.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

/**
 * Charge tous les GLB via un LoadingManager unique : la promesse ne se résout
 * qu'une fois tous les assets prêts. Les assets ne sont jamais recentrés ni
 * rééchelonnés (origine et échelle communes à la scène Blender).
 */
export async function loadAssets(
  items: AssetItem[],
  renderer: WebGLRenderer,
  basisTranscoderPath: string,
  { onProgress }: LoadCallbacks = {},
): Promise<LoadedAsset[]> {
  const available: AssetItem[] = [];
  for (const item of items) {
    if (!item.optional || (await exists(item.url))) available.push(item);
    else console.info(`[viewer] asset optionnel absent, ignoré : ${item.url}`);
  }

  const manager = new LoadingManager();
  // Progression pondérée par octets reçus, plus fluide que le comptage d'items.
  const bytes = new Map<string, { loaded: number; total: number }>();
  const report = () => {
    let loaded = 0;
    let total = 0;
    for (const b of bytes.values()) {
      loaded += b.loaded;
      total += b.total;
    }
    if (total > 0) onProgress?.(Math.min(loaded / total, 1));
  };

  const ktx2 = new KTX2Loader(manager).setTranscoderPath(basisTranscoderPath).detectSupport(renderer);
  const gltf = new GLTFLoader(manager).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);

  const loaded = await Promise.all(
    available.map(
      (item) =>
        new Promise<LoadedAsset>((resolve, reject) => {
          bytes.set(item.url, { loaded: 0, total: 1 });
          gltf.load(
            item.url,
            (res) => {
              const b = bytes.get(item.url)!;
              b.loaded = b.total;
              report();
              res.scene.name = item.id;
              resolve({ item, root: res.scene });
            },
            (e) => {
              if (e.lengthComputable) bytes.set(item.url, { loaded: e.loaded, total: e.total });
              report();
            },
            reject,
          );
        }),
    ),
  );

  ktx2.dispose();
  onProgress?.(1);
  return loaded;
}
