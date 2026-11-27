import type { MaterialDef, SceneObject } from './scene-model';

/**
 * PROJETS : chaque dossier `projects/<slug>/` contient un projet (un bâtiment, un
 * site), décrit par deux fichiers, par propriétaire :
 * - scene.json   : la STRUCTURE (objets 3D, matériaux, rendu, objectif de la caméra),
 *   gérée par le développeur en local ;
 * - content.json : le CONTENU (scénario, visite, œuvres, carte, interface, découpe, brume,
 *   couleurs, flou), modifié par le client dans le back-office en ligne.
 * Chacun n'écrit que son fichier : pas de conflit, rien de perdu à la mise à jour.
 * Les deux sont fusionnés ici ; le reste du code voit une seule configuration.
 * Les fichiers 3D et images du projet sont dans `public/projects/<slug>/`.
 */
// Forme de référence des fichiers (types) : celle du projet Panthéon.
type SceneJson = typeof import('../../../projects/pantheon/scene.json');
type ContentJson = typeof import('../../../projects/pantheon/content.json');

/** Configuration fusionnée (structure + contenu, sans le numéro de version du contenu). */
type Raw = SceneJson & Omit<ContentJson, 'version'>;
/** Fichier à télécharger (chargeur GLB). */
export interface AssetItem {
  id: string;
  url: string;
  optional?: boolean;
}

/** Point en mètres, repère monde de la scène. */
export type Vec3 = [number, number, number];

/** Boîte orientée : centre, dimensions (m) et rotation autour de la verticale (degrés). */
export interface TourBounds {
  center: Vec3;
  size: Vec3;
  rotationY: number;
}

/** Point d'intérêt posé sur l'œuvre (raycast sur le scan), avec un court texte. */
export interface TourHotspot {
  id: string;
  position: Vec3;
  text: string;
}

/** Bloc du contenu « En savoir plus » : texte riche (HTML) ou image. */
export type ContentBlock = { type: 'text'; html: string } | { type: 'image'; src: string; alt: string };

/** Œuvre de la visite guidée. */
export interface TourWork {
  /** Identifiant stable, généré à la création, jamais modifié. */
  id: string;
  title: string;
  /** Auteur (sous le titre). */
  author: string;
  /** Vignette (bandeau, collection) : chemin depuis la racine du site, ou vide. */
  thumbnail: string;
  /** Dérivé du titre, unique : hash d'URL (#slug). */
  slug: string;
  /** Point regardé par la caméra. */
  focus: Vec3;
  /** Parcours de la caméra sur l'œuvre, joué en boucle (1→2→…→n→1). */
  cameraPoints: Vec3[];
  /**
   * Zone permise à la caméra quand l'utilisateur prend la main sur l'œuvre
   * (orbite autour du focus) : évite de traverser les murs. Absente : pas de limite.
   */
  bounds?: TourBounds;
  /** Points d'intérêt, parcourus dans l'ordre (cycle automatique ou clic). */
  hotspots: TourHotspot[];
  /** Contenu descriptif (« En savoir plus »). */
  content: { blocks: ContentBlock[] };
}

export interface TourConfig {
  durations: {
    /** Vue orbitale → premier point de la première œuvre. */
    enterMs: number;
    /** D'une œuvre à l'autre (via le point central). */
    betweenMs: number;
    /** Retour à la vue orbitale. */
    exitMs: number;
  };
  /** Vitesse de la caméra sur la boucle d'une œuvre (m/s). */
  loopSpeed: number;
  /** Fraction du trajet d'entrée (0–1) à partir de laquelle la découpe s'éteint. */
  cutFadeStart: number;
  /** Durée d'affichage d'un point d'intérêt avant le suivant (ms). */
  hotspotIntervalMs: number;
  /** Reprise du parcours après une prise en main de la caméra (orbite sur l'œuvre). */
  resumeDelayMs: number;
  /** Reprise après le bouton cube (orbite libre) sans interaction : plus long qu'après un glisser. */
  cubeResumeMs: number;
  /** Entre deux œuvres : passer par le point central (sinon trajet direct, avec la sphère de découpe). */
  viaHub?: boolean;
  /** Point de passage central entre deux œuvres (option `viaHub`). */
  hub: { position: Vec3 };
  works: TourWork[];
}

/** Interface publique : « À propos », mini-carte. */
/**
 * Vue de la carte (caméra orthogonale) : un point et un regard. Le plan de coupe passe
 * par le point, perpendiculaire au regard ; tout ce qui est devant est coupé. La
 * carte passe d'une vue à l'autre par une transition animée.
 */
export interface MapView {
  name: string;
  /** plan : regard vers le bas ; wall : vue de face (horizontale) ; ceiling : plafonds, regard vers le haut. */
  kind: 'plan' | 'wall' | 'ceiling';
  /** Point de la vue : le plan de coupe y passe (plan / plafonds : sa hauteur = hauteur de coupe). */
  center: Vec3;
  /** Direction du regard (degrés autour de la verticale, comme la caméra : 0 = vers -z). Murs seulement. */
  yaw: number;
  /** Cadre (m) avant zoom. Murs seulement (plan et plafonds : emprise du Panthéon). */
  width: number;
  height: number;
}

export interface MapConfig {
  title: string;
  subtitle: string;
  hint: string;
  /** Fond de la carte (#rrggbb), par défaut la couleur du sol. */
  background: string;
  /** Rotation du plan (degrés) : écran large / écran étroit. */
  planRotationDesktop: number;
  planRotationMobile: number;
  /** Vues dans l'ordre des vignettes : plan, vues de face, plafonds. */
  views: MapView[];
}

export interface UiConfig {
  /** Crédits (HTML, texte riche). */
  aboutHtml: string;
  minimap: {
    /** Rotation du plan (degrés, multiple de 90) : écran large / écran étroit. */
    rotationDesktop: number;
    rotationMobile: number;
  };
  map: MapConfig;
}

/** Point d'un trajet de caméra (intro, boucle d'attente) : position, point regardé. */
export interface ScenarioPoint {
  position: Vec3;
  target: Vec3;
  /** Durée pour rejoindre ce point depuis le précédent (ms). Boucle : celle du 1er point ferme la boucle. */
  durationMs: number;
}

/**
 * Scénario de l'expérience :
 *
 *   ACCUEIL (une fois)  écran de démarrage → intro → boucle d'attente → premier mode
 *   MODES               où se trouve le visiteur : vue extérieure (orbite), visite guidée
 *                       (visite à pied plus tard) ; il en change avec les boutons
 *   PASSAGES            comment la caméra va d'un mode à l'autre : direct (mouvement
 *                       standard) ou trajet point par point
 *
 * Chaque élément porte sa découpe (formes de la bibliothèque, onglet Rendu).
 */
export type ModeId = 'orbit' | 'tour';
export type PassageId = 'orbit>tour' | 'tour>orbit';

/** Trajet de caméra : arrivée du ciel (paramétrique) ou points de passage, sur une durée totale. */
export interface PathSpec {
  style: 'sky' | 'points';
  /** Durée totale (ajouter des points ne l'allonge pas). */
  durationMs: number;
  startHeightAboveGround: number;
  startDistance: number;
  sweepDeg: number;
  waypoints: Vec3[];
  /** Point regardé (points) ; null : le point de focus. */
  look: Vec3 | null;
  /** Découpe pendant le trajet. */
  cut: string[];
}

export interface IntroConfig extends PathSpec {
  enabled: boolean;
  /** Le visiteur peut l'interrompre (il arrive alors dans le premier mode, sur place). */
  interruptible: boolean;
  /** Points : le trajet se termine sur le départ de la suite (pas de raccord). */
  endAtNext: boolean;
}

/** Vue extérieure : orbite autour du point de focus. */
export interface OrbitMode {
  /** Vue de départ autour du point de focus. */
  start: { distance: number; azimuthDeg: number; elevationDeg: number };
  minDistance: number;
  maxDistance: number;
  dampingFactor: number;
  groundMargin: number;
  autoRotateSpeed: number;
  /** Inactivité : rien, rotation automatique, ou retour à la boucle d'attente. */
  idle: { action: 'none' | 'rotate' | 'loop'; afterMs: number };
  cut: string[];
}

/** Passage d'un mode à l'autre. */
export interface Passage {
  /** direct : mouvement standard ; path : trajet point par point vers le départ du mode suivant. */
  kind: 'direct' | 'path';
  durationMs: number;
  waypoints: Vec3[];
  look: Vec3 | null;
  cut: string[];
}

export interface ScenarioConfig {
  intro: IntroConfig;
  /** Boucle d'attente : à l'accueil (avant le premier geste) et sur inactivité en vue extérieure. */
  loop: { enabled: boolean; points: ScenarioPoint[]; cut: string[] };
  /** Mode où arrive le visiteur après l'accueil. */
  firstMode: ModeId;
  orbit: OrbitMode;
  /** Visite guidée : œuvre de départ quand on y arrive par l'accueil. */
  tour: { startWork: number };
  passages: Record<PassageId, Passage>;
  /** Raccords de l'accueil (intro → boucle → premier mode). */
  blend: { durationMs: number; cut: string[] };
}

/** Écran de démarrage : titre, description, image de fond, bouton (« Entrer »). */
export interface StartConfig {
  enabled: boolean;
  title: string;
  /** Texte riche (HTML). */
  description: string;
  /** Image de fond (chemin depuis la racine du site), ou vide : la scène en fond. */
  image: string;
  button: string;
}

/**
 * Découpe (voir à travers les murs) : une forme réglable, nommée, attribuée à un ou
 * plusieurs moments de l'expérience.
 * - cylinder : de la caméra vers le point regardé, rayon et dégradé ; s'estompe quand
 *   la caméra s'éloigne (fadeStart → fadeEnd) ; petite sphère autour de la caméra.
 * - sphere : autour de la caméra, rayon et dégradé.
 */
export interface CutPreset {
  id: string;
  name: string;
  kind: 'cylinder' | 'sphere';
  radius: number;
  feather: number;
  /** Cylindre : distance caméra–cible où la découpe commence à apparaître, et où elle est pleine. */
  fadeStartDistance: number;
  fadeEndDistance: number;
  /** Cylindre : sphère autour de la caméra (0 : aucune). */
  cameraRadius: number;
}

/** Moments de la visite guidée auxquels on attribue une découpe (les étapes du scénario portent la leur). */
export type CutMoment = 'work' | 'transit';

export interface CutawayConfig {
  /** Couleur de l'épaisseur des murs coupés. */
  cutColor: string;
  presets: CutPreset[];
  /** Visite guidée : découpe sur une œuvre et entre deux œuvres (id, ou '' : aucune). */
  use: Record<CutMoment, string>;
  /** Transitions : part du trajet (début et fin) sur laquelle la découpe apparaît / disparaît. */
  transitFade: number;
}

export type SceneConfig = Omit<Raw, 'tour' | 'ui' | 'objects' | 'materials' | 'scenario' | 'start' | 'cutaway'> & {
  cutaway: CutawayConfig;
  start: StartConfig;
  objects: SceneObject[];
  materials: Record<string, MaterialDef>;
  tour: TourConfig;
  ui: UiConfig;
  scenario: ScenarioConfig;
};
