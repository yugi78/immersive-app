import {
  BufferAttribute,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetRole } from '../config/types';

/**
 * Les textures sont bakées pour un affichage unlit (sans ombrage) : on remplace
 * chaque matériau par un MeshBasicMaterial qui affiche la texture telle quelle.
 */
function toUnlit(mat: Material, role: AssetRole): MeshBasicMaterial {
  const src = mat as Material & { map?: MeshBasicMaterial['map']; color?: MeshBasicMaterial['color'] };
  const out = new MeshBasicMaterial({
    name: mat.name,
    map: src.map ?? null,
    color: src.map ? 0xffffff : (src.color ?? 0xffffff),
    // Maquette découpée en DoubleSide : ses faces arrière (épaisseur des murs coupés)
    // sont rendues en couleur de coupe par le shader de découpe.
    side: role === 'clay-cut' ? DoubleSide : mat.side,
    transparent: mat.transparent,
    alphaTest: mat.alphaTest,
  });
  mat.dispose();
  return out;
}

function convertMaterials(root: Object3D, role: AssetRole) {
  const cache = new Map<Material, MeshBasicMaterial>();
  const conv = (m: Material) => {
    let c = cache.get(m);
    if (!c) cache.set(m, (c = toUnlit(m, role)));
    return c;
  };
  root.traverse((o) => {
    if (o instanceof Mesh) o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

/**
 * Attributs en Float32 non normalisés : les GLB meshopt sont quantifiés (Int16
 * normalisé, entrelacé), qu'on ne peut ni transformer (applyMatrix4) ni fusionner tels quels.
 */
function toFloat(geo: BufferGeometry): BufferGeometry {
  const getters = ['getX', 'getY', 'getZ', 'getW'] as const;
  for (const [name, attr] of Object.entries(geo.attributes)) {
    if (attr instanceof BufferAttribute && attr.array instanceof Float32Array && !attr.normalized) continue;
    const { count, itemSize } = attr;
    const out = new Float32Array(count * itemSize);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = attr[getters[c]](i); // dénormalise
    }
    geo.setAttribute(name, new BufferAttribute(out, itemSize));
  }
  return geo;
}

/**
 * Fusionne tous les meshes partageant un même matériau en un seul, en appliquant
 * les transformations monde : limite les draw calls (cull_pantheon = 181 meshes).
 * Les coordonnées restent en mètres dans le repère d'origine, sans recentrage.
 */
function mergeByMaterial(root: Object3D): Object3D {
  root.updateWorldMatrix(true, true);
  const groups = new Map<Material, BufferGeometry[]>();
  const leftovers: Mesh[] = [];

  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (Array.isArray(o.material)) {
      leftovers.push(o);
      return;
    }
    const list = groups.get(o.material) ?? [];
    list.push(toFloat(o.geometry.clone()).applyMatrix4(o.matrixWorld));
    groups.set(o.material, list);
  });

  const out = new Group();
  out.name = root.name;
  for (const [mat, geos] of groups) {
    const homogeneous = geos.every((g) => g.index) ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(homogeneous, false);
    if (!merged) {
      console.warn(`[viewer] fusion impossible pour ${root.name}, meshes conservés`);
      return root;
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    out.add(new Mesh(merged, mat));
    geos.forEach((g) => g.dispose());
  }
  for (const m of leftovers) {
    const clone = m.clone();
    m.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    out.add(clone);
  }
  return out;
}

export function prepareAsset(root: Object3D, role: AssetRole): Object3D {
  convertMaterials(root, role);
  return role === 'clay' || role === 'clay-cut' || role === 'cut-fill' ? mergeByMaterial(root) : root;
}
