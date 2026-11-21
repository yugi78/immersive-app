// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sceneConfigApi from './integrations/scene-config-api.ts';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages, domaine personnalisé : https://pantheon.stylz.fr/ (site à la
  // racine). BASE_PATH est fourni par le workflow : vide avec le domaine
  // personnalisé, « /pantheon » tant qu'il n'est pas actif (yugi78.github.io/pantheon/).
  // En local, le site reste servi à la racine (localhost:4321/, /admin).
  site: 'https://pantheon.stylz.fr',
  base: process.env.BASE_PATH || '/',
  integrations: [react(), sceneConfigApi()],
});
