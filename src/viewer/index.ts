import { Box3Helper, Color, MathUtils, Timer } from 'three';
import { defaultConfig, type SceneConfig } from './config/types';
import { loadAssets } from './loaders/assets';
import { addLighting } from './scene/lighting';
import { createCamera, createOrbit } from './scene/orbit';
import { computeReference, type SceneReference } from './scene/reference';
import { prepareAsset } from './scene/prepare';
import { createRenderer } from './scene/renderer';
import { createProgress } from './ui/progress';

export interface ViewerOptions {
  config?: SceneConfig;
  /** Affiche la bounding box de référence (aussi activable via ?debug dans l'URL). */
  debug?: boolean;
}

export interface Viewer {
  reference: SceneReference;
  dispose(): void;
}

export async function createViewer(container: HTMLElement, opts: ViewerOptions = {}): Promise<Viewer> {
  const cfg = opts.config ?? defaultConfig;
  const debug = opts.debug ?? new URLSearchParams(location.search).has('debug');

  const { renderer, scene } = createRenderer(container, cfg.renderer);
  renderer.domElement.style.visibility = 'hidden';
  const progress = createProgress(container);

  let assets;
  try {
    assets = await loadAssets(cfg.assets.items, renderer, cfg.assets.decoders.basisTranscoderPath, {
      onProgress: progress.set,
    });
  } catch (err) {
    console.error('[viewer] échec du chargement', err);
    progress.error('Impossible de charger la maquette.');
    throw err;
  }

  for (const a of assets) {
    a.root = prepareAsset(a.root, a.item.role);
    scene.add(a.root);
  }

  // 1. Référence : bbox du Panthéon → cible d'orbite, centre de découpe, hauteur du sol.
  const refAsset = assets.find((a) => a.item.id === cfg.assets.reference.id);
  if (!refAsset) throw new Error(`Asset de référence introuvable : ${cfg.assets.reference.id}`);
  const reference = computeReference(refAsset.root);
  if (debug) {
    scene.add(new Box3Helper(reference.box, new Color('#e8590c')));
    console.info('[viewer] référence', {
      center: reference.center.toArray(),
      groundY: reference.groundY,
      size: reference.size.toArray(),
    });
  }

  addLighting(scene, cfg.lighting, reference.center);

  const camera = createCamera(cfg.camera, reference, container.clientWidth / container.clientHeight);
  const orbit = createOrbit(camera, renderer.domElement, cfg.orbit, reference);

  // Compile les shaders avant d'afficher pour éviter un à-coup à la première image.
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    // En portrait, on conserve le champ horizontal de `fov` pour garder le Panthéon cadré.
    camera.fov =
      camera.aspect < 1
        ? MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(cfg.camera.fov) / 2) / camera.aspect))
        : cfg.camera.fov;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();

  // Compile les shaders avant d'afficher pour éviter un à-coup à la première image.
  await renderer.compileAsync(scene, camera);

  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const timer = new Timer();
  timer.connect(document);
  renderer.setAnimationLoop((t) => {
    timer.update(t);
    orbit.update(timer.getDelta());
    renderer.render(scene, camera);
  });

  renderer.domElement.style.visibility = '';
  progress.hide();

  if (debug) Object.assign(window, { __viewer: { scene, camera, renderer, controls: orbit.controls, reference } });

  return {
    reference,
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      timer.dispose();
      orbit.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
