import { defaultConfig, PROJECT_SLUGS, projectConfig } from '../viewer/config/projects';
import type { SceneConfig } from '../viewer/config/types';

/**
 * Projet ouvert dans le back-office (une page /<projet>/admin par projet). Les champs,
 * l'aperçu, la publication et l'envoi d'images s'y réfèrent.
 */
let active: { slug: string; cfg: SceneConfig } = { slug: PROJECT_SLUGS.includes('pantheon') ? 'pantheon' : PROJECT_SLUGS[0], cfg: defaultConfig };

export function setActiveProject(slug: string) {
  if (active.slug !== slug) active = { slug, cfg: projectConfig(slug) };
}

export const activeProject = () => active;

/** Nom affiché du projet ouvert. */
export const projectName = () => active.cfg.project?.name ?? active.slug;
