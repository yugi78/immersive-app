import { Box3Helper, Color, DoubleSide, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, Timer, Vector3 } from 'three';
import { defaultConfig, type AssetItem, type SceneConfig, type TourConfig, type UiConfig, type Vec3 } from './config/types';
import { loadAssets } from './loaders/assets';
import { createCutaway } from './cutaway/cutaway';
import { createMist } from './scene/mist';
import { createClayGrade } from './scene/clayGrade';
import { createScanGrade } from './scene/scanGrade';
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
import { createTour, type Tour } from './tour/tour';
import { createTourUi, type TourUi } from './ui/tourUi';
import { renderMinimap, type MinimapImage } from './ui/minimap';
import { createMapView, enableLayer, LAYER_PLAN, LAYER_WALLS } from './map/mapView';
import type { EditorTools } from './editor/editor';
import './ui/viewer.css';

/** Fond de repérage des fuites (mode debug). */
const LEAK_BACKGROUND = new Color('#ff00ff');

export interface ViewerOptions {
  config?: SceneConfig;
  /** Affiche la bounding box de référence (aussi activable via ?debug dans l'URL). */
  debug?: boolean;
  /** Démarre directement en vue orbitale, sans l'animation d'ouverture (back-office). */
  skipIntro?: boolean;
  /** Hash d'URL par œuvre (#slug) : lu au chargement et mis à jour en visite. Faux dans le back-office. */
  urlHash?: boolean;
  /** Outils d'édition de la visite (back-office) : vol libre, repères, gizmo, pointage, aperçus. */
  editor?: boolean;
}

export type CutawaySettings = SceneConfig['cutaway'];
export type MistSettings = SceneConfig['mist'];
export type ClaySettings = SceneConfig['clay'];
export type ScanGradeSettings = SceneConfig['scanGrade'];
export type DofSettings = SceneConfig['dof'];

export interface Viewer {
  reference: SceneReference;
  /** Décale le point de focus (cible d'orbite) depuis le centre de la bbox : [x, hauteur, z] en mètres. */
  setFocusOffset(offset: Vec3): void;
  /** Modifie les réglages de découpe à chaud. */
  setCutaway(patch: Partial<CutawaySettings>): void;
  /** Modifie la brume d'arrière-plan à chaud. */
  setMist(patch: Partial<MistSettings>): void;
  /** Modifie le réglage colorimétrique commun aux maquettes clay, à chaud. */
  setClay(patch: Partial<ClaySettings>): void;
  /** Modifie le réglage colorimétrique des textures du scan, à chaud. */
  setScanGrade(patch: Partial<ScanGradeSettings>): void;
  /** Modifie le flou de profondeur de champ à chaud (dont l'activation). */
  setDof(patch: Partial<DofSettings>): void;
  /** Remplace les données de la visite guidée à chaud (back-office). */
  setTour(tour: TourConfig): void;
  /** Remplace les réglages de l'interface publique à chaud (back-office). */
  setUi(ui: UiConfig): void;
  /** Visite guidée : démarrer, naviguer, quitter. */
  tour: Pick<Tour, 'start' | 'goTo' | 'next' | 'prev' | 'stop' | 'togglePause' | 'status' | 'onChange' | 'cancel'>;
  /** Carte interactive : ouvrir une vue (0 : plan, 1–4 : murs), fermer, cadrer une vue depuis la caméra. */
  map: { open(view?: number): void; close(): void; frameFromCamera(): { center: Vec3; yaw: number } };
  /** Outils d'édition (option `editor`), sinon null. */
  editor: EditorTools | null;
  /** Objets internes pour l'inspection (mode debug uniquement). */
  debug?: unknown;
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

  // Maquette et scan téléchargés EN PARALLÈLE : le scan ne dépend que de sa
  // propre matrice (scanTransform), pas de la maquette.
  // Progression : 75 % pour la maquette, 25 % pour les tuiles du scan.
  let assetsRatio = 0;
  let scanRatio = 0;
  const report = () => progress.set(assetsRatio * 0.75 + scanRatio * 0.25);

  // Scan des plafonds : tuiles à LOD de texture (256 px d'emblée, 2048 ensuite en
  // arrière-plan), placées par scanTransform ; elles reçoivent le même cylindre
  // de découpe et la même couleur de coupe que la maquette.
  const scanPromise = createScanLod({
    manifestUrl: withBase(cfg.scan.manifest),
    basisTranscoderPath: withBase(cfg.assets.decoders.basisTranscoderPath),
    transform: cfg.scanTransform.matrix,
    maxLevel: cfg.scan.maxLevel,
    budgetMB: isMobile() ? cfg.scan.budgetMB.mobile : cfg.scan.budgetMB.desktop,
    lodBias: cfg.scan.lodBias,
    downgradeDelayMs: cfg.scan.downgradeDelayMs,
    renderer,
    onProgress: (r) => {
      scanRatio = r;
      report();
    },
  });
  // Évite une « unhandled rejection » si la maquette échoue avant qu'on attende le scan.
  scanPromise.catch(() => {});

  let assets;
  try {
    // URL de scene.json écrites depuis la racine : préfixées par la base du site.
    const items = cfg.assets.items.map((item) => ({ ...item, url: withBase(item.url) }) as AssetItem);
    assets = await loadAssets(items, renderer, withBase(cfg.assets.decoders.basisTranscoderPath), {
      onProgress: (r) => {
        assetsRatio = r;
        report();
      },
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
  const focusCfg = { x: cfg.focus.offsetX ?? 0, y: cfg.focus.heightOffset, z: cfg.focus.offsetZ ?? 0 };
  const reference = computeReference(refAsset.root, focusCfg);
  // Repères bbox + focus (le back-office a les siens, déplaçables au gizmo).
  if (debug && !opts.editor) {
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

  let scan: Awaited<typeof scanPromise>;
  try {
    scan = await scanPromise;
  } catch (err) {
    console.error('[viewer] échec du chargement du scan', err);
    progress.error('Impossible de charger le scan.');
    throw err;
  }
  cutaway.apply(scan.root);
  // Calques de la carte : plan = sol + tranche ; vues de face = sol + maquette + scan.
  for (const a of assets) {
    if (a.item.id === 'sol' || a.item.role === 'cut-fill') enableLayer(a.root, LAYER_PLAN);
    if (a.item.id === 'sol' || a.item.role === 'clay-cut') enableLayer(a.root, LAYER_WALLS);
  }
  enableLayer(scan.root, LAYER_WALLS);
  // Couleur du scan (uniforms partagés par toutes les tuiles), après la découpe.
  const scanGrade = createScanGrade(cfg.scanGrade);
  scanGrade.apply(scan.root);
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

  // Visite guidée. La vue orbitale par défaut (retour en fin de visite) suit la
  // hauteur du focus réglée dans le back-office.
  const focusOffset = new Vector3(focusCfg.x, focusCfg.y, focusCfg.z);
  const focusOffset0 = focusOffset.clone();
  let tourCfg: TourConfig = structuredClone(cfg.tour);
  const home = () => ({
    position: orbitStart.clone().add(focusOffset).sub(focusOffset0),
    target: reference.focus.clone(),
  });
  const tour = createTour({
    camera,
    dom: renderer.domElement,
    config: () => tourCfg,
    home,
    orbitTarget: () => orbit.controls.target,
  });
  // En visite, l'orbite est coupée (la visite pilote la caméra).
  tour.onChange((s) => {
    if (s.state !== 'idle') {
      orbit.controls.enabled = false;
      orbit.controls.autoRotate = false;
    }
  });
  // Back-office : outils d'édition, chargés à la demande (absents du site public).
  const editorTools = opts.editor
    ? (await import('./editor/editor')).createEditorTools({
        scene,
        camera,
        renderer,
        controls: orbit.controls,
        tour,
        reference,
        pickTargets: [scan.root],
      })
    : null;
  let uiCfg: UiConfig = structuredClone(cfg.ui);
  let tourUi: TourUi | null = null;
  // Mini-carte : vue de dessus du sol et de la tranche, rendue une fois.
  let minimap: MinimapImage | null = null;
  try {
    const roots = assets.filter((a) => a.item.id === 'sol' || a.item.role === 'cut-fill').map((a) => a.root);
    if (roots.length) minimap = renderMinimap(renderer, roots, reference.box);
  } catch (err) {
    console.warn('[viewer] mini-carte indisponible', err);
  }
  // Carte interactive : rendu orthogonal en direct de la scène (plan, vues de face).
  // Version mobile selon la largeur du conteneur (même seuil que l'interface).
  const mapView = createMapView({ renderer, scene, box: reference.box, config: () => uiCfg.map, mobile: () => container.clientWidth <= 719 });
  // Commandes créées à la fin de l'intro (pas de visite pendant l'ouverture).
  function onIntroDone() {
    orbit.start();
    tourUi = createTourUi({
      container,
      tour,
      camera,
      works: () => tourCfg.works,
      hotspotIntervalMs: () => tourCfg.hotspotIntervalMs ?? 6000,
      ui: () => uiCfg,
      minimap,
      map: mapView,
      cut: cutaway.uniforms,
      hash: opts.urlHash ?? true,
    });
    const i = tourUi.initialIndex();
    if (i >= 0) tour.start(i);
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
    // Carte ouverte : la visite est en pause, seule la vue orthogonale est rendue.
    if (mapView.active) {
      mapView.update(delta);
      tourUi?.update(delta);
      cutaway.update(camera.position, orbit.controls.target, 0);
      if (mapView.view > 0) scan.update(mapView.camera, null, undefined, mapView.clip);
      mapView.render();
      return;
    }
    if (!intro.done) {
      if (intro.update(delta)) onIntroDone();
    } else if (tour.active) {
      // Fin de la sortie : la caméra est à la position orbitale par défaut.
      if (tour.update(delta)) {
        orbit.controls.target.copy(home().target);
        orbit.start();
      }
    } else if (editorTools?.flying) {
      // Vol libre : caméra pilotée par editorTools.update (ci-dessous).
    } else {
      orbit.update(delta);
    }
    editorTools?.update(delta);
    // Interface : points d'intérêt projetés avec la caméra de cette image.
    tourUi?.update(delta);
    // Découpe : extrémité et intensité pilotées par la visite (entrée / sortie) ;
    // éteinte en vol libre (on circule à l'intérieur).
    if (tour.active) cutaway.update(camera.position, tour.cutTarget, tour.cutScale);
    else if (editorTools?.flying) cutaway.update(camera.position, orbit.controls.target, 0);
    else cutaway.update(camera.position, orbit.controls.target);
    camera.updateMatrixWorld();
    // En transition, la destination est préchargée en haute définition.
    scan.update(camera, tour.active ? tour.lookahead() : null);
    // Mise au point automatique : sur la cible d'orbite (ou l'œuvre visée), suit le zoom.
    const focusPoint = tour.active ? tour.lookTarget : orbit.controls.target;
    dof.render(scene, camera, camera.position.distanceTo(focusPoint));
  }

  renderer.domElement.style.visibility = '';
  progress.hide();

  const debugHandle = { scene, camera, renderer, controls: orbit.controls, reference, cutaway, setLeakBackground, intro, frame, scan, dof, tour, editor: editorTools, mapView };
  if (debug) Object.assign(window, { __viewer: debugHandle });

  return {
    reference,
    setFocusOffset([x, y, z]) {
      const d = new Vector3(x, y, z).sub(focusOffset);
      if (d.lengthSq() === 0) return;
      focusOffset.set(x, y, z);
      // On translate cible et caméra ensemble : le cadrage suit, sans saut de distance.
      reference.focus.add(d);
      if (!tour.active && !editorTools?.flying) {
        orbit.controls.target.add(d);
        camera.position.add(d);
      }
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
    setScanGrade(patch) {
      scanGrade.set(patch);
    },
    setTour(next) {
      tourCfg = structuredClone(next);
      tourUi?.refresh();
    },
    setUi(next) {
      uiCfg = structuredClone(next);
      mapView.refresh();
      tourUi?.refresh();
    },
    tour,
    map: {
      open: (view = 0) => tourUi?.openMap(view),
      close: () => tourUi?.closeMap(),
      frameFromCamera: () => mapView.frameFromCamera(camera),
    },
    editor: editorTools,
    debug: debug ? debugHandle : undefined,
    dispose() {
      editorTools?.dispose();
      tour.dispose();
      tourUi?.dispose();
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
