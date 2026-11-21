import { Box3Helper, Color, DoubleSide, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, Timer } from 'three';
import { defaultConfig, type SceneConfig } from './config/types';
import { loadAssets } from './loaders/assets';
import { createCutaway } from './cutaway/cutaway';
import { createMist } from './scene/mist';
import { createClayGrade } from './scene/clayGrade';
import { createDof } from './scene/dof';
import { withBase } from './url';
import { createScanLod } from './loaders/scanLod';
import { isMobile } from './scene/renderer';
import { createIntro } from './scene/intro';
import { createCamera, createOrbit } from './scene/orbit';
import { computeReference, type SceneReference } from './scene/reference';
import { prepareAsset } from './scene/prepare';
import { createRenderer } from './scene/renderer';
import { createProgress } from './ui/progress';
import './ui/viewer.css';

/** Fond de repérage des fuites (mode debug). */
const LEAK_BACKGROUND = new Color('#ff00ff');

export interface ViewerOptions {
  config?: SceneConfig;
  /** Affiche la bounding box de référence (aussi activable via ?debug dans l'URL). */
  debug?: boolean;
  /** Démarre directement en vue orbitale, sans l'animation d'ouverture (back-office). */
  skipIntro?: boolean;
}

export type CutawaySettings = SceneConfig['cutaway'];
export type MistSettings = SceneConfig['mist'];
export type ClaySettings = SceneConfig['clay'];
export type DofSettings = SceneConfig['dof'];

export interface Viewer {
  reference: SceneReference;
  /** Remonte (ou abaisse) le point de focus par rapport au centre de la bbox, en mètres. */
  setFocusHeightOffset(meters: number): void;
  /** Modifie les réglages de découpe à chaud. */
  setCutaway(patch: Partial<CutawaySettings>): void;
  /** Modifie la brume d'arrière-plan à chaud. */
  setMist(patch: Partial<MistSettings>): void;
  /** Modifie le réglage colorimétrique commun aux maquettes clay, à chaud. */
  setClay(patch: Partial<ClaySettings>): void;
  /** Modifie le flou de profondeur de champ à chaud (dont l'activation). */
  setDof(patch: Partial<DofSettings>): void;
  dispose(): void;
}

export async function createViewer(container: HTMLElement, opts: ViewerOptions = {}): Promise<Viewer> {
  const cfg = opts.config ?? defaultConfig;
  const debug = opts.debug ?? new URLSearchParams(location.search).has('debug');

  const { renderer, scene } = createRenderer(container, cfg.renderer);
  renderer.domElement.style.visibility = 'hidden';
  // Fond affiché pendant le chargement = couleur du ciel (brume).
  container.style.background = cfg.mist.color;
  const progress = createProgress(container);

  let assets;
  try {
    // URL de scene.json écrites depuis la racine : préfixées par la base du site.
    const items = cfg.assets.items.map((item) => ({ ...item, url: withBase(item.url) }));
    assets = await loadAssets(items, renderer, withBase(cfg.assets.decoders.basisTranscoderPath), {
      // 75 % pour la maquette, 25 % pour les tuiles du scan (chargées ensuite).
      onProgress: (r) => progress.set(r * 0.75),
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
  const reference = computeReference(refAsset.root, cfg.focus.heightOffset);
  if (debug) {
    scene.add(new Box3Helper(reference.box, new Color('#e8590c')));
    // Repère du point de focus (partage le Vector3 : suit les réglages à chaud).
    const marker = new Mesh(new SphereGeometry(1.5, 16, 12), new MeshBasicMaterial({ color: '#e8590c', depthTest: false }));
    marker.renderOrder = 999;
    marker.position.copy(reference.focus);
    marker.onBeforeRender = () => marker.position.copy(reference.focus);
    scene.add(marker);
    console.info('[viewer] référence', {
      center: reference.center.toArray(),
      groundY: reference.groundY,
      size: reference.size.toArray(),
    });
  }

  // Découpe + faces arrière en couleur de coupe : maquette du Panthéon et scan ;
  // jamais le sol ni la ville.
  const cutaway = createCutaway(cfg.cutaway);
  for (const a of assets) {
    if (a.item.role === 'clay-cut' || a.item.role === 'scan') cutaway.apply(a.root);
  }

  // Tranche de coupe (sol) : matériau uni qui partage l'objet Color de la coupe,
  // donc suit « Couleur de coupe » en direct. Jamais découpée.
  const cutFill = new MeshBasicMaterial({ name: 'cut-fill', side: DoubleSide });
  cutFill.color = cutaway.uniforms.uCutColor.value;
  for (const a of assets) {
    if (a.item.role !== 'cut-fill') continue;
    a.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      o.material = cutFill;
    });
  }

  // Brume d'arrière-plan centrée sur le Panthéon (distance horizontale au centre
  // de la bbox). Appliquée après la découpe, avec laquelle elle se chaîne.
  // Réglage colorimétrique commun à la ville, au Panthéon et au sol (uniforms
  // partagés). Ni le scan ni la tranche de coupe. Appliqué après la découpe.
  const clayGrade = createClayGrade(cfg.clay);
  for (const a of assets) {
    if (a.item.role === 'context' || a.item.role === 'clay' || a.item.role === 'clay-cut') clayGrade.apply(a.root);
  }

  const mist = createMist(cfg.mist, reference.center);
  for (const a of assets) mist.apply(a.root);

  // Debug : fond de scène en couleur vive pour repérer les fuites (jours entre la
  // maquette et le scan). Aussi activable d'emblée avec ?debug&leaks.
  // Le ciel (fond de scène) prend toujours la couleur de la brume : la ville
  // lointaine s'y fond sans silhouette. Même objet Color, mis à jour par setMist.
  const background = new Color(cfg.mist.color);
  scene.background = background;
  const setLeakBackground = (on: boolean) => {
    scene.background = on ? LEAK_BACKGROUND : background;
  };
  if (debug && new URLSearchParams(location.search).has('leaks')) setLeakBackground(true);

  // Position orbitale de départ = fin de l'intro.
  const camera = createCamera(cfg.camera, reference, container.clientWidth / container.clientHeight);
  const orbitStart = camera.position.clone();
  const orbit = createOrbit(camera, renderer.domElement, cfg.orbit, reference);
  const intro = createIntro(camera, opts.skipIntro ? { ...cfg.intro, durationMs: 0 } : cfg.intro, reference, orbitStart);

  // Scan des plafonds : tuiles à LOD de texture, placées par scanTransform ;
  // elles reçoivent le même cylindre de découpe et la même couleur de coupe.
  let scan: Awaited<ReturnType<typeof createScanLod>>;
  try {
    scan = await createScanLod({
      manifestUrl: withBase(cfg.scan.manifest),
      transform: cfg.scanTransform.matrix,
      maxLevel: cfg.scan.maxLevel,
      budgetMB: isMobile() ? cfg.scan.budgetMB.mobile : cfg.scan.budgetMB.desktop,
      lodBias: cfg.scan.lodBias,
      downgradeDelayMs: cfg.scan.downgradeDelayMs,
      renderer,
      camera,
      onProgress: (r) => progress.set(0.75 + r * 0.25),
    });
  } catch (err) {
    console.error('[viewer] échec du chargement du scan', err);
    progress.error('Impossible de charger le scan.');
    throw err;
  }
  cutaway.apply(scan.root);
  scene.add(scan.root);

  // Debug : compteur des niveaux de texture chargés.
  if (debug) {
    const hud = document.createElement('div');
    hud.className = 'pv-hud';
    container.appendChild(hud);
    setInterval(() => {
      const s = scan.stats();
      hud.textContent = `scan · ${Object.entries(s.perLevel).map(([l, n]) => `${l}px×${n}`).join(' · ')} · ${s.textureMB} Mo · ${s.loading} en cours`;
    }, 500);
  }

  // Flou de profondeur de champ (désactivable) ; moins d'échantillons sur mobile.
  const dof = createDof(renderer, cfg.dof, isMobile() ? 16 : 32);

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
    // Délai plafonné : évite un saut de l'intro après un onglet mis en pause.
    frame(Math.min(timer.getDelta(), 0.1));
  });

  function frame(delta: number) {
    if (!intro.done) {
      if (intro.update(delta)) orbit.start();
    } else {
      orbit.update(delta);
    }
    cutaway.update(camera.position, orbit.controls.target);
    camera.updateMatrixWorld();
    scan.update();
    // Mise au point automatique : sur la cible d'orbite, suit le zoom.
    dof.render(scene, camera, camera.position.distanceTo(orbit.controls.target));
  }

  renderer.domElement.style.visibility = '';
  progress.hide();

  if (debug) Object.assign(window, { __viewer: { scene, camera, renderer, controls: orbit.controls, reference, cutaway, setLeakBackground, intro, frame, scan, dof } });

  let focusOffset = cfg.focus.heightOffset;

  return {
    reference,
    setFocusHeightOffset(meters) {
      const dy = meters - focusOffset;
      focusOffset = meters;
      // On translate cible et caméra ensemble : le cadrage suit, sans saut de distance.
      reference.focus.y += dy;
      orbit.controls.target.y += dy;
      camera.position.y += dy;
    },
    setCutaway(patch) {
      cutaway.set(patch);
    },
    setMist(patch) {
      mist.set(patch);
      background.set(mist.settings.color);
    },
    setDof(patch) {
      dof.set(patch);
    },
    setClay(patch) {
      clayGrade.set(patch);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      timer.dispose();
      orbit.dispose();
      scan.dispose();
      dof.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
