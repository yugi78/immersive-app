import { defaultConfig } from '../viewer/config/projects';

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

/** Site vitrine (présentation, réalisations) : lien depuis l'accueil de l'espace client. */
export const SITE = {
  url: 'https://immersive.nlab.fr/',
  label: 'immersive.nlab.fr',
};

/**
 * Adresses en ligne, données au client (bouton « Adresses » du back-office) :
 * - le site public (apps de chaque projet : /<projet>/) ;
 * - l'espace client (connexion, publication), servi par Cloudflare Pages.
 */
export const ONLINE = {
  site: 'https://immersive-app.stylz.fr',
  admin: 'https://immersive-app.pages.dev',
};
