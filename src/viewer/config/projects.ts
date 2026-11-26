import type { SceneConfig } from './types';

/**
 * Registre des projets : chaque dossier projects/<slug>/ (scene.json + content.json).
 * Utilisé au build (pages) et par le back-office. Le site public n'embarque pas ce
 * registre : chaque page transmet au viewer la seule configuration de son projet.
 */
type Json = Record<string, unknown>;
const sceneFiles = import.meta.glob<Json>('/projects/*/scene.json', { eager: true, import: 'default' });
const contentFiles = import.meta.glob<Json>('/projects/*/content.json', { eager: true, import: 'default' });
const slugOf = (path: string) => /\/projects\/([^/]+)\//.exec(path)?.[1] ?? '';

/** Fusionne structure + contenu d'un projet (sans le numéro de version du contenu). */
function merge(scene: Json, content: Json | undefined) {
  const { version: _version, ...rest } = content ?? {};
  return { ...scene, ...rest } as unknown as SceneConfig;
}

/** Configuration complète de chaque projet (structure + contenu), par identifiant (slug). */
export const PROJECTS: Record<string, SceneConfig> = Object.fromEntries(
  Object.entries(sceneFiles)
    .map(([path, scene]) => {
      const slug = slugOf(path);
      return [slug, merge(scene, contentFiles[`/projects/${slug}/content.json`])] as const;
    })
    .sort(([a], [b]) => a.localeCompare(b)),
);

/** Identifiants des projets, dans l'ordre alphabétique. */
export const PROJECT_SLUGS = Object.keys(PROJECTS);

/** Configuration d'un projet ; erreur explicite s'il n'existe pas. */
export function projectConfig(slug: string): SceneConfig {
  const cfg = PROJECTS[slug];
  if (!cfg) throw new Error(`Projet inconnu : « ${slug} » (dossiers : ${PROJECT_SLUGS.join(', ')})`);
  return cfg;
}

/** Projet par défaut (le premier) : repli quand aucun projet n'est précisé. */
export const defaultConfig: SceneConfig = PROJECTS.pantheon ?? PROJECTS[PROJECT_SLUGS[0]];
