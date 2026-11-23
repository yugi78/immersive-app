import {
  Box3,
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three';

/** Plan de la mini-carte : image en vue de dessus et emprise au sol (x, z) en mètres. */
export interface MinimapImage {
  /** Image du plan (+x vers la droite, +z vers le bas), couleurs inversées (effet « rayon X »). */
  canvas: HTMLCanvasElement;
  minX: number;
  minZ: number;
  sizeX: number;
  sizeZ: number;
}

/**
 * Rend une fois, au chargement, la vue de dessus orthogonale des maquettes
 * données (sol du Panthéon + tranche de coupe), puis inverse les couleurs.
 * Les matériaux sont de simples copies (texture d'origine, sans brume ni
 * découpe) : la scène affichée n'est pas modifiée.
 */
export function renderMinimap(renderer: WebGLRenderer, roots: Object3D[], area: Box3, px = 768, margin = 3): MinimapImage {
  const box = area.clone().expandByVector(new Vector3(margin, 0, margin));
  const sizeX = box.max.x - box.min.x;
  const sizeZ = box.max.z - box.min.z;
  const w = Math.round(sizeX >= sizeZ ? px : (px * sizeX) / sizeZ);
  const h = Math.round(sizeX >= sizeZ ? (px * sizeZ) / sizeX : px);

  const scene = new Scene();
  const mats = new Map<Material, MeshBasicMaterial>();
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!(o instanceof Mesh) || Array.isArray(o.material)) return;
      const src = o.material as MeshBasicMaterial;
      if (!mats.has(src)) mats.set(src, new MeshBasicMaterial({ map: src.map ?? null, color: src.map ? 0xffffff : src.color, side: 2 }));
      const m = new Mesh(o.geometry, mats.get(src)!);
      m.matrixAutoUpdate = false;
      m.matrix.copy(o.matrixWorld);
      scene.add(m);
    });
  }

  // Caméra au-dessus, regard vers le bas : +x à droite, +z vers le bas de l'image.
  // Caméra à l'origine (x, z) : son repère est aligné sur le monde, left/right en x,
  // top/bottom en -z (le haut de l'image correspond à min z).
  const cam = new OrthographicCamera(box.min.x, box.max.x, -box.min.z, -box.max.z, 0.1, 2000);
  cam.position.set(0, box.max.y + 500, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();

  const rt = new WebGLRenderTarget(w, h, { samples: 4 });
  rt.texture.colorSpace = SRGBColorSpace;
  const prevTarget = renderer.getRenderTarget();
  const prevAlpha = renderer.getClearAlpha();
  const prevColor = renderer.getClearColor(new Color());
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const pixels = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  rt.dispose();
  mats.forEach((m) => m.dispose());

  // Pixels lus de bas en haut : on retourne l'image, puis couleurs inversées sur fond noir.
  const raw = document.createElement('canvas');
  raw.width = w;
  raw.height = h;
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  raw.getContext('2d')!.putImageData(img, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  // Négatif contrasté : murs (coupe) blancs, sol et parvis sombres, comme un scan aux rayons X.
  g.filter = 'grayscale(1) invert(1) brightness(0.7) contrast(2.2)';
  g.drawImage(raw, 0, 0);
  g.filter = 'none';
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);

  return { canvas, minX: box.min.x, minZ: box.min.z, sizeX, sizeZ };
}
