import raw from './scene.json';

/**
 * - context  : ville, sans découpe
 * - clay     : maquette sans découpe (sol)
 * - clay-cut : maquette découpée, faces arrière en couleur de coupe
 * - cut-fill : tranche de coupe (recouvre le pied des murs coupés), unie dans la couleur de coupe
 * - scan     : relevé photogrammétrique
 */
export type AssetRole = 'context' | 'clay' | 'clay-cut' | 'cut-fill' | 'scan';

export interface AssetItem {
  id: string;
  url: string;
  role: AssetRole;
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

/** Œuvre de la visite guidée. */
export interface TourWork {
  /** Identifiant stable, généré à la création, jamais modifié. */
  id: string;
  title: string;
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
  /** Contenu descriptif (à venir). */
  content: Record<string, unknown>;
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
  /** Reprise du parcours après une prise en main de la caméra (orbite sur l'œuvre). */
  resumeDelayMs: number;
  /** Point de passage central entre deux œuvres (évite les piliers). */
  hub: { position: Vec3 };
  works: TourWork[];
}

export type SceneConfig = Omit<typeof raw, 'tour'> & {
  assets: { items: AssetItem[] };
  tour: TourConfig;
};

/** Configuration de scène par défaut (sera fournie par le back-office plus tard). */
export const defaultConfig = raw as unknown as SceneConfig;
