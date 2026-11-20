import { Box3, Vector3, type Object3D } from 'three';

export interface SceneReference {
  /** Bounding box monde du Panthéon (cull_pantheon.glb). */
  box: Box3;
  /** Centre de la bbox : cible de l'orbite et centre du cylindre de découpe. */
  center: Vector3;
  /** min.y de la bbox : hauteur du sol. */
  groundY: number;
  /** Plus grande dimension horizontale, utile pour les distances de caméra. */
  size: Vector3;
}

/** Calcule la référence spatiale à partir de la maquette du Panthéon (pivot non centré). */
export function computeReference(pantheon: Object3D): SceneReference {
  pantheon.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(pantheon, true);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  return { box, center, groundY: box.min.y, size };
}
