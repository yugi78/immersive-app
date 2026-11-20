import { Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetRole } from '../config/types';

/** Rendu clay : mat, non métallique, la texture bakée (AO) porte le modelé. */
function toClay(mat: Material) {
  if (mat instanceof MeshStandardMaterial) {
    mat.roughness = 1;
    mat.metalness = 0;
  }
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
    if (!(o instanceof Mesh) || Array.isArray(o.material)) {
      if (o instanceof Mesh) leftovers.push(o);
      return;
    }
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const list = groups.get(o.material) ?? [];
    list.push(g);
    groups.set(o.material, list);
  });

  const out = new Group();
  out.name = root.name;
  for (const [mat, geos] of groups) {
    const indexed = geos.every((g) => g.index);
    const homogeneous = indexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g));
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
  if (role === 'scan') return root;
  root.traverse((o) => {
    if (o instanceof Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(toClay);
  });
  return role === 'clay' || role === 'clay-cut' ? mergeByMaterial(root) : root;
}
