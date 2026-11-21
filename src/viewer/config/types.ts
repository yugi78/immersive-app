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

export type SceneConfig = typeof raw & {
  assets: { items: AssetItem[] };
};

/** Configuration de scène par défaut (sera fournie par le back-office plus tard). */
export const defaultConfig = raw as SceneConfig;
