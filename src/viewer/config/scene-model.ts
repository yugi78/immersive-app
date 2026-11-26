/**
 * Modèle de scène : une liste d'OBJETS (fichiers 3D) et une bibliothèque de
 * MATÉRIAUX (comment chaque objet est rendu). Aucun nom d'objet ni « rôle » n'est
 * connu du code : tout est décrit dans scene.json, ce qui rend le viewer
 * réutilisable pour d'autres bâtiments.
 *
 * L'ancien format (assets.items avec des rôles + scan + scanTransform) est converti
 * automatiquement par `normalizeScene` : un ancien projet s'ouvre sans modification.
 */

/** Options de rendu d'un matériau (toutes facultatives). */
export interface MaterialDef {
  /** Sans ombrage : la texture (éclairage déjà « cuit ») est affichée telle quelle. Par défaut : oui. */
  unlit?: boolean;
  /** Faces visibles des deux côtés. */
  doubleSided?: boolean;
  /**
   * Découpe « voir à travers les murs » (cylindre caméra → cible, sphère autour de la
   * caméra) ; les faces arrière ainsi révélées sont remplies de la couleur de coupe.
   */
  cutaway?: boolean;
  /** Remplace la texture par la couleur de coupe unie (tranche de coupe). */
  fill?: 'coupe';
  /** Réglage colorimétrique appliqué (réglé par le client dans content.json). */
  grade?: 'clay' | 'scan' | null;
  /** Fondu dans la brume d'arrière-plan selon la distance au bâtiment. Par défaut : oui. */
  mist?: boolean;
}

/** Présence de l'objet dans la carte interactive et la mini-carte. */
export interface MapFlags {
  /** Plan de la mini-carte et calque « plan ». */
  plan?: boolean;
  /** Vues de la carte (plan coupé, vues de face, plafonds). */
  views?: boolean;
  /** Image de la mini-carte de la visite. */
  minimap?: boolean;
}

interface ObjectBase {
  id: string;
  name?: string;
  /** Clé dans `materials`. */
  material: string;
  /** Objet de référence : sa boîte englobante donne le centre, le sol et le focus. */
  reference?: boolean;
  map?: MapFlags;
  /** Le pointage du back-office (« Pointer sur le scan ») vise cet objet. */
  pick?: boolean;
}

/** Fichier GLB unique. */
export interface GlbObject extends ObjectBase {
  type?: 'glb';
  /** Chemin depuis la racine du site (public/). */
  file: string;
  /** Fusionne les maillages par matériau au chargement (moins d'appels de rendu). */
  merge?: boolean;
  /** Absent du serveur → ignoré sans erreur. */
  optional?: boolean;
}

/** Ensemble tuilé à niveaux de texture (relevé photogrammétrique). */
export interface TiledObject extends ObjectBase {
  type: 'tiled';
  /** manifest.json produit par les scripts de tuilage. */
  manifest: string;
  /** Matrice 4×4 (ordre colonnes, comme three.js) qui place les tuiles dans la scène. */
  transform: number[];
  lod: {
    maxLevel: number;
    budgetMB: { mobile: number; desktop: number };
    lodBias: number;
    downgradeDelayMs: number;
  };
}

export type SceneObject = GlbObject | TiledObject;

export interface SceneModel {
  objects: SceneObject[];
  materials: Record<string, MaterialDef>;
  decoders: { basisTranscoderPath: string };
}

export const isTiled = (o: SceneObject): o is TiledObject => o.type === 'tiled';

// ---- Ancien format (rôles) -----------------------------------------------------------

type LegacyRole = 'context' | 'clay' | 'clay-cut' | 'cut-fill' | 'scan';
interface LegacyScene {
  assets?: { reference?: { id: string }; items?: { id: string; url: string; role: LegacyRole; optional?: boolean }[]; decoders?: { basisTranscoderPath: string } };
  scan?: { manifest: string; maxLevel: number; budgetMB: { mobile: number; desktop: number }; lodBias: number; downgradeDelayMs: number };
  scanTransform?: { matrix: number[] };
}

/** Matériaux équivalents aux anciens rôles (rendu identique). */
export const LEGACY_MATERIALS: Record<string, MaterialDef> = {
  clay: { unlit: true, grade: 'clay', mist: true },
  'clay-coupe': { unlit: true, grade: 'clay', mist: true, cutaway: true, doubleSided: true },
  remplissage: { unlit: true, fill: 'coupe', mist: true },
  scan: { unlit: true, grade: 'scan', mist: false, cutaway: true },
};

const ROLE_MATERIAL: Record<Exclude<LegacyRole, 'scan'>, string> = {
  context: 'clay',
  clay: 'clay',
  'clay-cut': 'clay-coupe',
  'cut-fill': 'remplissage',
};

/** Convertit l'ancien format en objets + matériaux (le rendu ne change pas). */
export function fromLegacy(raw: LegacyScene): SceneModel {
  const items = raw.assets?.items ?? [];
  const refId = raw.assets?.reference?.id;
  const objects: SceneObject[] = items
    .filter((it) => it.role !== 'scan')
    .map((it) => {
      const role = it.role as Exclude<LegacyRole, 'scan'>;
      // Anciennes règles : le sol est au plan, aux vues et à la mini-carte ; la tranche
      // au plan et à la mini-carte ; la maquette découpée aux vues de la carte.
      const map: MapFlags = {};
      if (it.id === 'sol' || role === 'cut-fill') Object.assign(map, { plan: true, minimap: true });
      if (it.id === 'sol' || role === 'clay-cut') map.views = true;
      return {
        id: it.id,
        name: it.id,
        file: it.url,
        material: ROLE_MATERIAL[role] ?? 'clay',
        merge: role !== 'context',
        ...(it.optional ? { optional: true } : {}),
        ...(it.id === refId ? { reference: true } : {}),
        ...(Object.keys(map).length ? { map } : {}),
      };
    });
  if (raw.scan && raw.scanTransform) {
    const { manifest, maxLevel, budgetMB, lodBias, downgradeDelayMs } = raw.scan;
    objects.push({
      id: 'scan',
      name: 'scan',
      type: 'tiled',
      manifest,
      transform: raw.scanTransform.matrix,
      lod: { maxLevel, budgetMB, lodBias, downgradeDelayMs },
      material: 'scan',
      map: { views: true },
      pick: true,
    });
  }
  return { objects, materials: { ...LEGACY_MATERIALS }, decoders: raw.assets?.decoders ?? { basisTranscoderPath: '/libs/basis/' } };
}

/** Modèle de scène, quel que soit le format de scene.json (nouveau ou ancien). */
export function normalizeScene(raw: Partial<SceneModel> & LegacyScene): SceneModel {
  if (Array.isArray(raw.objects)) {
    return { objects: raw.objects, materials: raw.materials ?? {}, decoders: raw.decoders ?? { basisTranscoderPath: '/libs/basis/' } };
  }
  return fromLegacy(raw);
}
