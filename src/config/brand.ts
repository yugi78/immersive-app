import { defaultConfig } from '../viewer/config/types';

/**
 * Marque de l'outil (commune à tous les projets) et identité du projet affiché
 * (scene.json → project). Le viewer et le back-office restent les mêmes d'un projet
 * à l'autre ; seuls ces libellés et les données changent.
 */
export const BRAND = 'Immersive App';

export const PROJECT = {
  /** Nom court du projet (en-tête du back-office, connexion). */
  name: defaultConfig.project?.name ?? 'Projet',
  /** Titre de la page publique (onglet du navigateur). */
  title: defaultConfig.project?.title ?? defaultConfig.project?.name ?? BRAND,
};
