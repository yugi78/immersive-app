import { Box3Helper, Color, DoubleSide, MathUtils, Mesh, MeshBasicMaterial, SphereGeometry, Timer, Vector3, type Object3D } from 'three';
import type { SceneConfig, TourConfig, UiConfig, Vec3 } from './config/types';
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
  /** Sphère de découpe autour de la caméra en vol libre (back-office). */
  setFlySphere(opts: { enabled: boolean; radius: number; feather: number }): void;
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
  const progress = createProgress(container);

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
    if (matOf(objOf(a)).cutaway) cutaway.apply(a.root);
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
  for (const a of assets) applyMapLayers(a.root, objOf(a));
  if (scan && tiled) {
    // Mêmes effets que les GLB, dans le même ordre.
    const m = matOf(tiled);
    if (m.cutaway) cutaway.apply(scan.root);
    applyMapLayers(scan.root, tiled);
    applyGrade(scan.root, m);
    if (m.mist !== false) mist.apply(scan.root);
    if (tiled.visible === false) scan.root.visible = false;
    scene.add(scan.root);
  }
  /** Vol libre : sphère de découpe autour de la caméra (traverser murs et piliers). */
  let flySphere = { enabled: true, radius: 4, feather: 2 };
  /** Sphère de découpe affichée (intensité, rayon, dégradé), lissée d'une image à l'autre. */
  const sphere = { s: 0, r: 4, f: 2 };
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
        pickTargets: rootsWhere((o) => !!o.pick),
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
      scan?.update(mapView.camera, null, undefined, mapView.clip);
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
    // Sphère de découpe autour de la caméra, selon le moment :
    // - transition entre œuvres : monte au départ, tient, redescend à l'arrivée ;
    // - sur une œuvre (parcours et orbite libre) : petite sphère (« workRadius ») ;
    // - vol libre du back-office : ses propres réglages.
    // Les valeurs sont lissées : on passe de l'une à l'autre sans saut.
    const cs = cutaway.settings;
    let target = { s: 0, r: sphere.r, f: sphere.f };
    if (tour.state === 'transit') {
      const p = tour.phaseProgress;
      const fade = Math.max(cs.transitFade ?? 0.2, 1e-3);
      target = { s: Math.min(MathUtils.smoothstep(p, 0, fade), 1 - MathUtils.smoothstep(p, 1 - fade, 1)), r: cs.transitRadius ?? 8, f: cs.transitFeather ?? 3 };
    } else if (tour.state === 'loop' && (cs.workRadius ?? 0) > 0) {
      target = { s: 1, r: cs.workRadius ?? 0, f: cs.workFeather ?? 1 };
    } else if (editorTools?.flying && flySphere.enabled) {
      target = { s: 1, r: flySphere.radius, f: flySphere.feather };
    }
    const ks = 1 - Math.exp(-8 * delta);
    sphere.s += (target.s - sphere.s) * ks;
    sphere.r += (target.r - sphere.r) * ks;
    sphere.f += (target.f - sphere.f) * ks;
    cutaway.setTransit(sphere.s < 0.002 ? 0 : sphere.s, sphere.r, sphere.f);
    camera.updateMatrixWorld();
    // En transition, la destination est préchargée en haute définition.
    scan?.update(camera, tour.active ? tour.lookahead() : null);
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
    setFlySphere(opts) {
      flySphere = { ...opts };
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
      editorTools?.dispose();
      tour.dispose();
      tourUi?.dispose();
      renderer.setAnimationLoop(null);
      ro.disconnect();
      timer.dispose();
      orbit.dispose();
      scan?.dispose();
      dof.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
