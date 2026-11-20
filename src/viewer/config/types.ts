import raw from './scene.json';

export type AssetRole = 'context' | 'clay' | 'clay-cut' | 'scan';

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
