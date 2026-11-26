// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import sceneConfigApi from './integrations/scene-config-api.ts';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages, domaine personnalisé : https://immersive-app.stylz.fr/ (site à la
  // racine). BASE_PATH est fourni par le workflow : vide avec le domaine
  // personnalisé, « /immersive-app » tant qu'il n'est pas actif (yugi78.github.io/immersive-app/).
  // En local, le site reste servi à la racine (localhost:4321/, /admin).
  site: 'https://immersive-app.stylz.fr',
  base: process.env.BASE_PATH || '/',
  integrations: [react(), sceneConfigApi()],
});
