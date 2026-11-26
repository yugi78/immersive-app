import sceneRaw from './scene.json';
import contentRaw from './content.json';
import type { MaterialDef, SceneObject } from './scene-model';

/**
 * La configuration est répartie en deux fichiers, par propriétaire :
 * - scene.json   : la STRUCTURE (fichiers 3D, scan, rendu, caméra, intro, orbite),
 *   gérée par le développeur en local ;
 * - content.json : le CONTENU (visite, œuvres, carte, interface, découpe, brume,
 *   couleurs, flou), modifié par le client dans le back-office en ligne.
 * Chacun n'écrit que son fichier : pas de conflit, rien de perdu à la mise à jour.
 * Les deux sont fusionnés ici ; le reste du code voit une seule configuration.
 */
const { version: contentVersion, ...content } = contentRaw;
const raw = { ...sceneRaw, ...content };

/** Version du format de content.json (migrations futures). */
export const CONTENT_VERSION = contentVersion;
/** Sections de la configuration qui appartiennent à content.json. */
export const CONTENT_KEYS = Object.keys(content) as (keyof typeof content)[];

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
  /** Point de passage central entre deux œuvres (évite les piliers). */
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

export type SceneConfig = Omit<typeof raw, 'tour' | 'ui' | 'objects' | 'materials'> & {
  objects: SceneObject[];
  materials: Record<string, MaterialDef>;
  tour: TourConfig;
  ui: UiConfig;
};

/** Configuration complète : structure (scene.json) + contenu (content.json). */
export const defaultConfig = raw as unknown as SceneConfig;
