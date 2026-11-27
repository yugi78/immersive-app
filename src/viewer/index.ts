import { Box3Helper, Color, DoubleSide, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, Timer, Vector3, type Object3D } from 'three';
import type { SceneConfig, TourConfig, UiConfig, Vec3, ScenarioConfig, StartConfig, CutPreset, PassageId } from './config/types';
import { isTiled, normalizeScene, type GlbObject, type MaterialDef, type ObjectTransform, type SceneObject } from './config/scene-model';
import { loadAssets } from './loaders/assets';
import { createCutaway } from './cutaway/cutaway';
import { createMist } from './scene/mist';
import { createClayGrade } from './scene/clayGrade';
import { createScanGrade } from './scene/scanGrade';
import { createDof } from './scene/dof';
import { withBase } from './url';
import { createScanLod } from './loaders/scanLod';
import { isMobile } from './scene/renderer';
import { createScenario, homePose } from './scene/scenario';
import { cutFor } from './config/cutaway';
import { designCss, normalizeDesign, type DesignConfig } from './config/design';
import { createCamera, createOrbit } from './scene/orbit';
import { computeReference, type SceneReference } from './scene/reference';
import { prepareAsset } from './scene/prepare';
import { createRenderer } from './scene/renderer';
import { createProgress } from './ui/progress';
import { createStartScreen } from './ui/startScreen';
import { createTour, type Tour } from './tour/tour';
import { createTourUi, type TourUi } from './ui/tourUi';
import { renderMinimap, type MinimapImage } from './ui/minimap';
import { createMapView, enableLayer, LAYER_PLAN, LAYER_WALLS } from './map/mapView';
import type { EditorTools, ScenarioHelpers } from './editor/editor';
import './ui/viewer.css';

/** Fond de repérage des fuites (mode debug). */
const LEAK_BACKGROUND = new Color('#ff00ff');

export interface ViewerOptions {
  config?: SceneConfig;
  /** Affiche la bounding box de référence (aussi activable via ?debug dans l'URL). */
  debug?: boolean;
  /** Démarre directement en prise en main, sans intro ni boucle d'attente (back-office). */
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
  /** Remplace les réglages de découpe à chaud (formes et attribution par moment). */
  setCutaway(next: CutawaySettings): void;
  /** Modifie la brume d'arrière-plan à chaud. */
  setMist(patch: Partial<MistSettings>): void;
  /** Modifie le réglage colorimétrique commun aux maquettes clay, à chaud. */
  setClay(patch: Partial<ClaySettings>): void;
  /** Modifie le réglage colorimétrique des textures du scan, à chaud. */
  setScanGrade(patch: Partial<ScanGradeSettings>): void;
  /** Modifie le flou de profondeur de champ à chaud (dont l'activation). */
  setDof(patch: Partial<DofSettings>): void;
  /** Remplace le design de l'interface à chaud (back-office). */
  setDesign(design: DesignConfig): void;
  /** Remplace les réglages de l'écran de démarrage à chaud (back-office). */
  setStart(start: StartConfig): void;
  /** Affiche l'écran de démarrage (aperçu du back-office) ; au clic, le scénario est rejoué. */
  previewStart(): void;
  /** Remplace le scénario d'ouverture à chaud (back-office). */
  setScenario(scenario: ScenarioConfig): void;
  /** Scénario : rejouer depuis le début, jouer une étape (aperçu), revenir à la vue de départ. */
  scenario: { replay(): void; playLoop(): void; playPassage(id: PassageId): void; goHome(): void; readonly state: string; readonly part: string };
  /** Caméra (back-office) : pose courante, placement, vue de départ depuis la caméra. */
  view: {
    pose(): { position: Vec3; target: Vec3 };
    setPose(position: Vec3, target: Vec3): void;
    /** Distance, azimut et élévation de la caméra autour du point de focus (vue de départ). */
    orbitStart(): { distance: number; azimuthDeg: number; elevationDeg: number };
  };
  /** Remplace les données de la visite guidée à chaud (back-office). */
  setTour(tour: TourConfig): void;
  /** Remplace les réglages de l'interface publique à chaud (back-office). */
  setUi(ui: UiConfig): void;
  /** Visite guidée : démarrer, naviguer, quitter. */
  tour: Pick<Tour, 'start' | 'goTo' | 'next' | 'prev' | 'stop' | 'togglePause' | 'status' | 'onChange' | 'cancel'>;
  /** Carte interactive : ouvrir une vue (0 : plan, 1–4 : murs), fermer, cadrer une vue depuis la caméra. */
  map: { open(view?: number): void; close(): void; frameFromCamera(): { center: Vec3; yaw: number } };
  /** Sphère de découpe autour de la caméra en vol libre (back-office). */
  /** Découpe de la vue de contrôle du back-office (formes de la bibliothèque). */
  setObserverCut(ids: string[]): void;
  /** Objets de la scène (outliner) : racines 3D, visibilité, placement. */
  objects: {
    root(id: string): Object3D | null;
    setVisible(id: string, visible: boolean): void;
    setTransform(id: string, t: ObjectTransform): void;
  };
  /** Outils d'édition (option `editor`), sinon null. */
  editor: EditorTools | null;
  /** Objets internes pour l'inspection (mode debug uniquement). */
  debug?: unknown;
  dispose(): void;
}

export async function createViewer(container: HTMLElement, opts: ViewerOptions = {}): Promise<Viewer> {
  // Configuration du projet à afficher (fournie par la page ou le back-office).
  if (!opts.config) throw new Error('createViewer : configuration du projet manquante (option config)');
  const cfg = opts.config;
  const debug = opts.debug ?? new URLSearchParams(location.search).has('debug');

  const { renderer, scene } = createRenderer(container, cfg.renderer);
  renderer.domElement.style.visibility = 'hidden';
  // Fond affiché pendant le chargement = couleur du ciel (brume).
  container.style.background = cfg.mist.color;
  // Écran de démarrage (sauf ?direct, lien vers une œuvre #slug, back-office) : il
  // tient lieu de barre de chargement ; le scénario attend le clic sur « Entrer ».
  // Design de l'interface : variables CSS des styles et composants, injectées dans la page.
  let designCfg: DesignConfig = normalizeDesign(cfg.design);
  const designStyle = document.createElement('style');
  designStyle.dataset.pvDesign = '';
  designStyle.textContent = designCss(designCfg);
  container.appendChild(designStyle);
  let startCfg: StartConfig = structuredClone(cfg.start);
  const direct = new URLSearchParams(location.search).has('direct') || location.hash.length > 1;
  const start = startCfg?.enabled && !direct && !opts.skipIntro ? createStartScreen(container, startCfg) : null;
  const progress = start ?? createProgress(container);
  /** Vrai tant que l'écran de démarrage attend : le scénario est figé sur sa première image. */
  let gated = !!start;
  start?.entered.then(() => (gated = false));

  // Scène décrite par des OBJETS et des MATÉRIAUX (scene.json) ; l'ancien format à
  // rôles est converti à la volée. Le code ne connaît aucun nom d'objet.
  const model = normalizeScene(cfg as unknown as Parameters<typeof normalizeScene>[0]);
  const matOf = (o: SceneObject): MaterialDef => model.materials[o.material] ?? {};
  const glbObjects = model.objects.filter((o): o is GlbObject => !isTiled(o));
  // Un seul ensemble tuilé pour l'instant (le scan).
  const tiled = model.objects.find(isTiled) ?? null;
  const basisPath = withBase(model.decoders.basisTranscoderPath);

  // Fichiers GLB et ensemble tuilé téléchargés EN PARALLÈLE : les tuiles ne dépendent
  // que de leur propre matrice, pas de la maquette.
  // Progression : 75 % pour les GLB, 25 % pour les tuiles.
  let assetsRatio = 0;
  let scanRatio = tiled ? 0 : 1;
  const report = () => progress.set(assetsRatio * 0.75 + scanRatio * 0.25);

  // Ensemble tuilé : tuiles à LOD de texture (256 px d'emblée, 2048 ensuite en
  // arrière-plan), placées par leur matrice.
  const scanPromise = tiled
    ? createScanLod({
        manifestUrl: withBase(tiled.manifest),
        basisTranscoderPath: basisPath,
        transform: tiled.transform,
        maxLevel: tiled.lod.maxLevel,
        budgetMB: isMobile() ? tiled.lod.budgetMB.mobile : tiled.lod.budgetMB.desktop,
        lodBias: tiled.lod.lodBias,
        downgradeDelayMs: tiled.lod.downgradeDelayMs,
        renderer,
        onProgress: (r) => {
          scanRatio = r;
          report();
        },
      })
    : Promise.resolve(null);
  // Évite une « unhandled rejection » si la maquette échoue avant qu'on attende le scan.
  scanPromise.catch(() => {});

  let assets;
  try {
    // URL de scene.json écrites depuis la racine : préfixées par la base du site.
    const items = glbObjects.map((o) => ({ id: o.id, url: withBase(o.file), optional: o.optional }));
    assets = await loadAssets(items, renderer, basisPath, {
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

  /** Place la racine d'un objet (en plus du placement du fichier, déjà dans ses nœuds). */
  function applyTransform(r: Object3D, t: ObjectTransform) {
    r.position.fromArray(t.position);
    r.rotation.set(...(t.rotation.map((d) => MathUtils.degToRad(d)) as [number, number, number]), 'XYZ');
    r.scale.fromArray(t.scale);
    r.updateMatrixWorld(true);
  }
  // Objet de la scène correspondant à chaque fichier chargé.
  const objOf = (a: { item: { id: string } }) => glbObjects.find((o) => o.id === a.item.id)!;
  for (const a of assets) {
    const o = objOf(a);
    const m = matOf(o);
    a.root = prepareAsset(a.root, { unlit: m.unlit !== false, doubleSided: !!m.doubleSided, merge: !!o.merge });
    a.root.name = o.id;
    if (o.transform) applyTransform(a.root, o.transform);
    if (o.visible === false) a.root.visible = false;
    scene.add(a.root);
  }

  // 1. Référence : bbox du Panthéon → cible d'orbite, centre de découpe, hauteur du sol.
  const refAsset = assets.find((a) => objOf(a).reference) ?? assets[0];
  if (!refAsset) throw new Error('Aucun objet de référence (« reference »: true) dans scene.json');
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

  // Effets de matériau, toujours dans le même ordre (ils se chaînent) :
  // découpe → remplissage de coupe → réglage colorimétrique → brume.
  // Découpe + faces arrière en couleur de coupe (matériaux « cutaway »).
  const cutaway = createCutaway(cfg.cutaway);
  for (const a of assets) {
    if (matOf(objOf(a)).cutaway) cutaway.apply(a.root, matOf(objOf(a)).cuts ?? null);
  }

  // Remplissage de coupe : matériau uni qui partage l'objet Color de la coupe,
  // donc suit « Couleur de coupe » en direct. Jamais découpé.
  const cutFill = new MeshBasicMaterial({ name: 'cut-fill', side: DoubleSide });
  cutFill.color = cutaway.uniforms.uCutColor.value;
  for (const a of assets) {
    if (matOf(objOf(a)).fill !== 'coupe') continue;
    a.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      o.material = cutFill;
    });
  }

  // Réglages colorimétriques (uniforms partagés par famille, réglés par le client) :
  // « clay » pour les maquettes, « scan » pour les textures photogrammétriques.
  const clayGrade = createClayGrade(cfg.clay);
  const scanGrade = createScanGrade(cfg.scanGrade);
  const applyGrade = (root: Object3D, m: MaterialDef) => {
    if (m.grade === 'clay') clayGrade.apply(root);
    else if (m.grade === 'scan') scanGrade.apply(root);
  };
  for (const a of assets) applyGrade(a.root, matOf(objOf(a)));

  // Brume d'arrière-plan centrée sur la référence (distance horizontale au centre
  // de sa bbox). Appliquée en dernier : elle se chaîne aux effets précédents.
  const mist = createMist(cfg.mist, reference.center);
  for (const a of assets) if (matOf(objOf(a)).mist !== false) mist.apply(a.root);

  // Présence dans la carte : calque « plan » (mini-carte) et calque des vues.
  const applyMapLayers = (root: Object3D, o: SceneObject) => {
    if (o.map?.plan) enableLayer(root, LAYER_PLAN);
    if (o.map?.views) enableLayer(root, LAYER_WALLS);
  };

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

  // Caméra posée à la vue de départ (le scénario la place ensuite au début de sa
  // première étape).
  let scenarioCfg: ScenarioConfig = structuredClone(cfg.scenario);
  const camera = createCamera(cfg.camera, container.clientWidth / container.clientHeight);
  {
    const h = homePose(scenarioCfg.orbit, reference.focus);
    camera.position.copy(h.position);
    camera.lookAt(h.target);
  }
  const orbit = createOrbit(camera, renderer.domElement, scenarioCfg.orbit, reference);

  let scan: Awaited<typeof scanPromise>;
  try {
    scan = await scanPromise;
  } catch (err) {
    console.error('[viewer] échec du chargement du scan', err);
    progress.error('Impossible de charger le scan.');
    throw err;
  }
  for (const a of assets) applyMapLayers(a.root, objOf(a));
  if (scan && tiled) {
    // Mêmes effets que les GLB, dans le même ordre.
    const m = matOf(tiled);
    if (m.cutaway) cutaway.apply(scan.root, m.cuts ?? null);
    applyMapLayers(scan.root, tiled);
    applyGrade(scan.root, m);
    if (m.mist !== false) mist.apply(scan.root);
    if (tiled.visible === false) scan.root.visible = false;
    scene.add(scan.root);
  }
  /** Vol libre : sphère de découpe autour de la caméra (traverser murs et piliers). */
  /** Vue de contrôle du back-office : formes de découpe autour de sa caméra. */
  let observerCut: string[] = [];
  /** Sphère de découpe affichée (intensité, rayon, dégradé), lissée d'une image à l'autre. */
  const sphere: { s: number; r: number; f: number; id: string | null } = { s: 0, r: 4, f: 2, id: null };
  /** Racine 3D de chaque objet, par identifiant (outliner). */
  const objectRoots = new Map<string, Object3D>(assets.map((a) => [objOf(a).id, a.root]));
  if (scan && tiled) objectRoots.set(tiled.id, scan.root);
  /** Racine 3D de chaque objet (pour le pointage, la mini-carte…). */
  const rootsWhere = (pred: (o: SceneObject) => boolean) => [
    ...assets.filter((a) => pred(objOf(a))).map((a) => a.root),
    ...(scan && tiled && pred(tiled) ? [scan.root] : []),
  ];

  // Debug : compteur des niveaux de texture chargés.
  if (debug && scan) {
    const hud = document.createElement('div');
    hud.className = 'pv-hud';
    container.appendChild(hud);
    setInterval(() => {
      const s = scan!.stats();
      hud.textContent = `scan · ${Object.entries(s.perLevel).map(([l, n]) => `${l}px×${n}`).join(' · ')} · ${s.textureMB} Mo · ${s.loading} en cours`;
    }, 500);
  }

  // Visite guidée. Sortie de visite : le départ de l'étape de sortie du scénario
  // (bouton du monument), par défaut la vue de départ de la prise en main.
  const focusOffset = new Vector3(focusCfg.x, focusCfg.y, focusCfg.z);
  let tourCfg: TourConfig = structuredClone(cfg.tour);
  const home = () => scenario.exitPose();
  const tour = createTour({
    camera,
    dom: renderer.domElement,
    config: () => tourCfg,
    home,
    orbitTarget: () => orbit.controls.target,
  });
  // En visite, le scénario s'efface et l'orbite est coupée (la visite pilote la caméra).
  tour.onChange((s) => {
    if (s.state !== 'idle') {
      scenario.pause();
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
        pickTargets: rootsWhere((o) => !!o.pick),
        // Vue de contrôle : l'expérience continue sans recevoir les gestes (la souris
        // pilote l'autre caméra) ; de retour sur l'expérience, ses commandes reviennent.
        onViewMode: (m) => {
          const observing = m !== 'experience';
          tour.setInput(!observing);
          orbit.controls.enabled = !observing && scenario.state === 'control' && !tour.active;
        },
      })
    : null;
  let uiCfg: UiConfig = structuredClone(cfg.ui);
  let tourUi: TourUi | null = null;
  // Mini-carte : vue de dessus du sol et de la tranche, rendue une fois.
  let minimap: MinimapImage | null = null;
  try {
    const roots = rootsWhere((o) => !!o.map?.minimap);
    if (roots.length) minimap = renderMinimap(renderer, roots, reference.box);
  } catch (err) {
    console.warn('[viewer] mini-carte indisponible', err);
  }
  // Carte interactive : rendu orthogonal en direct de la scène (plan, vues de face).
  // Version mobile selon la largeur du conteneur (même seuil que l'interface).
  const mapView = createMapView({ renderer, scene, box: reference.box, config: () => uiCfg.map, mobile: () => container.clientWidth <= 719 });
  // Scénario d'ouverture : intro → boucle d'attente → prise en main (voir scene/scenario.ts).
  const scenario = createScenario({
    camera,
    dom: renderer.domElement,
    controls: orbit.controls,
    reference,
    config: () => scenarioCfg,
    busy: () => tour.active || mapView.active,
    skip: opts.skipIntro,
    flying: () => !!editorTools?.observing,
    tour: {
      start: (i) => tour.start(i),
      stop: () => tour.stop(),
      cancel: () => tour.cancel(),
      jump: (i) => tour.jumpTo(i),
      get active() {
        return tour.active;
      },
    },
    applyOrbit: (o) => orbit.set(o),
    onReady,
  });
  // Interface créée à la fin de l'intro (pas de visite pendant l'ouverture).
  // L'interface publique lance et quitte la visite par le scénario (passages : trajet
  // éventuel entre la vue extérieure et la visite) ; le reste passe à la visite.
  const uiTour = Object.assign(Object.create(tour) as typeof tour, {
    start: (i: number) => (tour.active ? tour.start(i) : scenario.enterTour(i)),
    stop: () => (tour.active ? scenario.leaveTour() : undefined),
  });
  function onReady() {
    tourUi = createTourUi({
      container,
      tour: uiTour,
      camera,
      works: () => tourCfg.works,
      hotspotIntervalMs: () => tourCfg.hotspotIntervalMs ?? 6000,
      ui: () => uiCfg,
      minimap,
      map: mapView,
      cut: cutaway.uniforms,
      hash: opts.urlHash ?? true,
      viewCamera: () => editorTools?.viewCamera ?? camera,
      design: () => designCfg,
    });
    const i = tourUi!.initialIndex();
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

  /** Repères 3D du scénario dans le back-office (onglet Expérience). */
  function scenarioHelpers() {
    if (!editorTools) return;
    const r = (v: Vector3) => v.toArray() as Vec3;
    const c = scenarioCfg;
    const focus = r(reference.focus);
    const poses = scenario.poses();
    const paths: ScenarioHelpers['paths'] = [];
    if (c.intro.enabled && c.intro.style === 'points') {
      paths.push({ id: 'intro', waypoints: c.intro.waypoints, look: c.intro.look ?? focus, end: c.intro.endAtNext && poses.afterIntro ? r(poses.afterIntro.position) : null });
    }
    for (const id of ['orbit>tour', 'tour>orbit'] as const) {
      const ps = c.passages[id];
      if (ps.kind === 'path') paths.push({ id, waypoints: ps.waypoints, look: ps.look ?? focus, end: id === 'tour>orbit' ? r(poses.orbit.position) : null });
    }
    editorTools.setScenarioHelpers({
      paths,
      loops: c.loop.enabled ? [{ id: 'loop', points: c.loop.points.map((x) => x.position) }] : [],
      homes: [{ id: 'orbit', position: r(poses.orbit.position) }],
    });
  }
  scenarioHelpers();

  scenario.begin();
  const timer = new Timer();
  timer.connect(document);
  renderer.setAnimationLoop((t) => {
    timer.update(t);
    // Délai plafonné : évite un saut de l'intro après un onglet mis en pause.
    frame(Math.min(timer.getDelta(), 0.1));
  });

  /** Transition (0–1 du trajet) : la découpe apparaît au début et disparaît à la fin. */
  function transitCurve(p: number, fadePart: number) {
    const fade = Math.max(fadePart ?? 0.2, 1e-3);
    return Math.min(MathUtils.smoothstep(p, 0, fade), 1 - MathUtils.smoothstep(p, 1 - fade, 1));
  }

  function frame(delta: number) {
    // Carte ouverte : la visite est en pause, seule la vue orthogonale est rendue.
    if (mapView.active) {
      mapView.update(delta);
      tourUi?.update(delta);
      cutaway.update(camera.position, orbit.controls.target, null);
      scan?.update(mapView.camera, null, undefined, mapView.clip);
      mapView.render();
      return;
    }
    if (scenario.driving) {
      // Intro, boucle d'attente ou raccord : le scénario pilote la caméra (figé derrière
      // l'écran de démarrage tant qu'on n'est pas entré).
      if (!gated) scenario.update(delta);
    } else if (tour.active) {
      // Fin de la sortie : la caméra est à la vue de départ, prise en main.
      if (tour.update(delta)) scenario.resume();
    } else {
      // Vue extérieure (l'expérience continue aussi en vue de contrôle du back-office).
      scenario.update(delta);
      orbit.update(delta);
    }
    editorTools?.update(delta);
    // Interface : points d'intérêt projetés avec la caméra de cette image.
    tourUi?.update(delta);
    // Découpe du moment : celle de l'étape du scénario en cours (pendant l'étape, ou
    // pendant le raccord qui y mène), ou celle de la visite (sur l'œuvre, entre deux
    // œuvres). Un cylindre (vers le point regardé) et une sphère (autour de la caméra)
    // au plus ; la sphère est lissée d'une image à l'autre, sans saut.
    const cc = cutaway.settings;
    const pick = (ids: string[] | undefined, target: Vector3, scale: number) => {
      const list = (ids ?? []).map((id) => cc.presets.find((p) => p.id === id)).filter((p): p is CutPreset => !!p);
      return { cyl: list.find((p) => p.kind === 'cylinder') ?? null, sph: list.find((p) => p.kind === 'sphere') ?? null, target, scale };
    };
    const one = (pr: CutPreset | null, target: Vector3, scale: number) => pick(pr ? [pr.id] : [], target, scale);
    let moment: ReturnType<typeof pick>;
    if (tour.active) {
      if (tour.state === 'transit') moment = one(cutFor(cc, 'transit'), tour.lookTarget, transitCurve(tour.phaseProgress, cc.transitFade));
      else if (tour.state === 'loop') moment = one(cutFor(cc, 'work'), tour.lookTarget, 1);
      // Entrée / sortie standard de la visite : la découpe de la vue extérieure s'éteint / se rallume.
      else moment = pick(scenarioCfg.orbit.cut, tour.cutTarget, tour.cutScale);
    } else {
      // Partie du scénario en cours ; raccords et passages : fondu au début et à la fin.
      const c = scenario.cutNow();
      const scale = c.progress === null ? 1 : transitCurve(c.progress, cc.transitFade);
      moment = pick(c.ids, scenario.driving ? scenario.lookTarget : orbit.controls.target, scale);
    }
    const moment2 = { preset: moment.cyl, target: moment.target, scale: moment.scale };
    cutaway.update(camera.position, moment2.target, moment2.preset, moment2.scale);
    let target = { s: 0, r: sphere.r, f: sphere.f };
    if (moment.sph) {
      target = { s: moment.scale, r: moment.sph.radius, f: moment.sph.feather };
      sphere.id = moment.sph.id;
    }
    const ks = 1 - Math.exp(-8 * delta);
    sphere.s += (target.s - sphere.s) * ks;
    sphere.r += (target.r - sphere.r) * ks;
    sphere.f += (target.f - sphere.f) * ks;
    // La forme qui s'éteint garde ses matériaux abonnés jusqu'à la fin de son fondu.
    cutaway.setTransit(sphere.s < 0.002 ? 0 : sphere.s, sphere.r, sphere.f, sphere.id);
    camera.updateMatrixWorld();
    // Point regardé par l'expérience (mise au point, ligne de visée en vue de contrôle).
    const lookPoint = tour.active ? tour.lookTarget : scenario.driving ? scenario.lookTarget : orbit.controls.target;
    // Vue de contrôle du back-office : rendu par sa caméra, avec sa propre découpe ; la
    // caméra de l'expérience est dessinée en filaire.
    const observing = !!editorTools?.observing;
    const viewCam = editorTools?.viewCamera ?? camera;
    if (observing) {
      const list = observerCut.map((id) => cc.presets.find((x) => x.id === id)).filter((x): x is CutPreset => !!x);
      const obsTarget = editorTools!.observerTarget();
      cutaway.setObserver(viewCam.position, obsTarget, list.find((x) => x.kind === 'cylinder') ?? null, list.find((x) => x.kind === 'sphere') ?? null);
      editorTools!.setExperienceLook(lookPoint);
    } else cutaway.setObserver(null, null, null, null);
    viewCam.updateMatrixWorld();
    // En transition, la destination est préchargée en haute définition.
    scan?.update(viewCam, tour.active && !observing ? tour.lookahead() : null);
    // Mise au point automatique : sur le point regardé (ou visé par la vue de contrôle).
    const focusPoint = observing ? editorTools!.observerTarget() : lookPoint;
    dof.render(scene, viewCam, viewCam.position.distanceTo(focusPoint));
  }

  renderer.domElement.style.visibility = '';
  progress.hide();

  const debugHandle = { scene, camera, renderer, controls: orbit.controls, reference, cutaway, setLeakBackground, scenario, frame, scan, dof, tour, editor: editorTools, mapView };
  if (debug) Object.assign(window, { __viewer: debugHandle });

  return {
    reference,
    setFocusOffset([x, y, z]) {
      const d = new Vector3(x, y, z).sub(focusOffset);
      if (d.lengthSq() === 0) return;
      focusOffset.set(x, y, z);
      // On translate cible et caméra ensemble : le cadrage suit, sans saut de distance.
      reference.focus.add(d);
      if (!tour.active) {
        orbit.controls.target.add(d);
        camera.position.add(d);
      }
      scenarioHelpers();
    },
    setCutaway(next) {
      cutaway.set(next);
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
    setDesign(next) {
      const d = normalizeDesign(next);
      if (JSON.stringify(d) === JSON.stringify(designCfg)) return;
      designCfg = d;
      designStyle.textContent = designCss(designCfg);
      tourUi?.applyDesign();
    },
    setStart(next) {
      startCfg = structuredClone(next);
      start?.update(startCfg);
    },
    previewStart() {
      tour.cancel();
      const screen = createStartScreen(container, startCfg);
      screen.hide();
      gated = true;
      scenario.replay();
      screen.entered.then(() => (gated = false));
    },
    setScenario(next) {
      if (JSON.stringify(next) === JSON.stringify(scenarioCfg)) return;
      scenarioCfg = structuredClone(next);
      if (scenario.part === 'orbit') orbit.set(scenarioCfg.orbit);
      scenarioHelpers();
    },
    view: {
      pose() {
        // Caméra de la vue : celle de l'expérience, ou la caméra de contrôle.
        const observing = !!editorTools?.observing;
        const p = observing ? editorTools!.viewCamera.position : camera.position;
        let t: Vector3;
        if (observing) t = editorTools!.observerTarget();
        else if (tour.active) t = tour.lookTarget;
        else if (scenario.driving) t = scenario.lookTarget;
        else t = orbit.controls.target;
        const r = (v: Vector3) => v.toArray().map((x) => Math.round(x * 100) / 100) as Vec3;
        return { position: r(p), target: r(t) };
      },
      setPose(position, target) {
        const t = new Vector3(...target);
        // Vue de contrôle : c'est elle qui va au point (l'expérience continue).
        if (editorTools?.observing) return editorTools.placeObserver(new Vector3(...position), t);
        tour.cancel();
        camera.position.set(...position);
        camera.lookAt(t);
        scenario.placeAt(t);
      },
      orbitStart() {
        const d = (editorTools?.viewCamera ?? camera).position.clone().sub(reference.focus);
        const distance = d.length() || 1;
        const r1 = (x: number) => Math.round(x * 10) / 10;
        return {
          distance: r1(distance),
          azimuthDeg: r1(MathUtils.radToDeg(Math.atan2(d.x, d.z))),
          elevationDeg: r1(MathUtils.radToDeg(Math.asin(MathUtils.clamp(d.y / distance, -1, 1)))),
        };
      },
    },
    scenario: {
      replay: () => {
        tour.cancel();
        scenario.replay();
      },
      playLoop: () => scenario.playLoop(),
      playPassage: (id) => scenario.playPassage(id),
      goHome: () => {
        tour.cancel();
        scenario.goHome();
      },
      get state() {
        return scenario.state;
      },
      get part() {
        return scenario.part;
      },
    },
    // Réglages identiques (le back-office renvoie tout à chaque interaction) : rien à
    // faire. Sinon l'interface serait reconstruite et l'encart ou la carte ouverts fermés.
    setTour(next) {
      if (JSON.stringify(next) === JSON.stringify(tourCfg)) return;
      tourCfg = structuredClone(next);
      tourUi?.refresh();
    },
    setUi(next) {
      if (JSON.stringify(next) === JSON.stringify(uiCfg)) return;
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
    setObserverCut(ids) {
      observerCut = [...ids];
    },
    objects: {
      root: (id) => objectRoots.get(id) ?? null,
      setVisible(id, visible) {
        const r = objectRoots.get(id);
        if (r) r.visible = visible;
      },
      setTransform(id, t) {
        const r = objectRoots.get(id);
        // Ensemble tuilé : placé par sa propre matrice (pas de déplacement depuis l'outliner).
        if (r && !(tiled && id === tiled.id)) applyTransform(r, t);
      },
    },
    editor: editorTools,
    debug: debug ? debugHandle : undefined,
    dispose() {
      const w = window as unknown as { __viewer?: unknown };
      if (w.__viewer === debugHandle) delete w.__viewer;
      editorTools?.dispose();
      tour.dispose();
      tourUi?.dispose();
      renderer.setAnimationLoop(null);
      ro.disconnect();
      timer.dispose();
      scenario.dispose();
      orbit.dispose();
      scan?.dispose();
      dof.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
