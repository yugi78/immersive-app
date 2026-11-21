import { Box3, Vector3, type Object3D } from 'three';

export interface SceneReference {
  /** Bounding box monde du Panthéon (cull_pantheon.glb). */
  box: Box3;
  /** Centre de la bbox. */
  center: Vector3;
  /**
   * Point de focus = centre de la bbox décalé de (offsetX, heightOffset, offsetZ) mètres :
   * cible de l'orbite et extrémité de l'axe de découpe. Muté en place par le
   * back-office (setFocusOffset).
   */
  focus: Vector3;
  /** min.y de la bbox : hauteur du sol. */
  groundY: number;
  /** Plus grande dimension horizontale, utile pour les distances de caméra. */
  size: Vector3;
}

/** Calcule la référence spatiale à partir de la maquette du Panthéon (pivot non centré). */
export function computeReference(pantheon: Object3D, focusOffset: { x?: number; y?: number; z?: number } = {}): SceneReference {
  pantheon.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(pantheon, true);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const focus = center.clone();
  focus.add(new Vector3(focusOffset.x ?? 0, focusOffset.y ?? 0, focusOffset.z ?? 0));
  return { box, center, focus, groundY: box.min.y, size };
}
