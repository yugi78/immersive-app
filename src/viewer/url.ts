/**
 * Préfixe un chemin absolu de `public/` (« /models/x.glb ») par la base du site
 * (`base` dans astro.config.mjs, ex. « /pantheon » sur GitHub Pages). Les URL
 * de scene.json restent écrites depuis la racine, sans connaître la base.
 */
export function withBase(url: string): string {
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  return import.meta.env.BASE_URL.replace(/\/$/, '') + url;
}
