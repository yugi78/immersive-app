import { Box3, Matrix3, Matrix4, Mesh, MeshBasicMaterial, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Vérification du placement du scan (mode debug) : scan.glb affiché en fil de
 * fer par-dessus les tuiles, et comparaison numérique des bounding boxes.
 * scan.glb est chargé tel quel : la transformation de son nœud le place.
 */
export async function loadScanTemplate(url: string): Promise<Object3D> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const wire = new MeshBasicMaterial({ color: '#00b7ff', wireframe: true, transparent: true, opacity: 0.35, depthTest: false });
  gltf.scene.traverse((o) => {
    if (o instanceof Mesh) {
      o.material = wire;
      o.renderOrder = 1000;
    }
  });
  gltf.scene.name = 'scan-template';
  return gltf.scene;
}

const fmt = (v: Vector3) => v.toArray().map((n) => Number(n.toFixed(4)));

/** Bbox des meshes de `root` dans le repère `frameInverse` (bbox de géométrie transformée). */
function boxInFrame(root: Object3D, frameInverse: Matrix4) {
  const box = new Box3();
  const m = new Matrix4();
  const tmp = new Box3();
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    m.multiplyMatrices(frameInverse, o.matrixWorld);
    box.union(tmp.copy(o.geometry.boundingBox!).applyMatrix4(m));
  });
  return box;
}

/**
 * Compare, dans le repère local du scan (celui de `scanRoot`, avant scanTransform),
 * la bbox de la géométrie de scan.glb et celle des tuiles du scan.
 */
export function compareScanBoxes(template: Object3D, scanRoot: Object3D) {
  scanRoot.updateWorldMatrix(true, false);
  const toWorld = scanRoot.matrixWorld;
  const toLocal = toWorld.clone().invert();
  const ref = boxInFrame(template, toLocal);
  const tiles = boxInFrame(scanRoot, toLocal);
  const dMin = tiles.min.clone().sub(ref.min);
  const dMax = tiles.max.clone().sub(ref.max);
  const dCenter = tiles.getCenter(new Vector3()).sub(ref.getCenter(new Vector3()));
  const rows = [
    { label: 'scan.glb (référence)', min: fmt(ref.min), max: fmt(ref.max) },
    {
      label: 'tuiles LOD',
      min: fmt(tiles.min),
      max: fmt(tiles.max),
      'Δmin': fmt(dMin),
      'Δmax': fmt(dMax),
      'écart max (m local)': Number(Math.max(...[...dMin.toArray(), ...dMax.toArray()].map(Math.abs)).toFixed(4)),
      'Δcentre monde (m)': fmt(dCenter.clone().applyMatrix3(new Matrix3().setFromMatrix4(toWorld))),
    },
  ];
  console.table(rows);
  return rows;
}
