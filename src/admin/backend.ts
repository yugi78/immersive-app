/**
 * Mode du back-office et canal de publication.
 *
 * - Mode « complet » (développeur) : en local (`astro dev`), tous les outils, y
 *   compris ceux qui touchent la structure de la scène (scene.json, fichiers 3D).
 * - Mode « client » : l'espace en ligne du client. Il ne règle que le CONTENU
 *   (content.json) : visite, œuvres, carte, interface, découpe, brume, couleurs.
 *   En local, `/admin?client` affiche ce mode pour le tester.
 *
 * Le canal de publication ne dépend que de l'endroit où tourne le back-office :
 * - en local : le serveur de dev écrit content.json et les images (public/media/) ;
 * - en ligne : des fonctions serveur protégées par la connexion du client font un
 *   commit dans le dépôt GitHub, ce qui relance la mise en ligne du site.
 */

import { activeProject } from './project';

export type AdminMode = 'full' | 'client';

const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);

/** Local : serveur de dev (écriture directe des fichiers). En ligne : API distante. */
export const LOCAL = import.meta.env.DEV;

/** Mode affiché : complet en local, sauf `?client` ; toujours client en ligne. */
export const ADMIN_MODE: AdminMode = LOCAL && !params.has('client') ? 'full' : 'client';

export const isFull = ADMIN_MODE === 'full';

/** Sections de content.json modifiées par le back-office (patch partiel). */
export type ContentPatch = Record<string, unknown>;

export interface PublishResult {
  ok: boolean;
  /** Message d'erreur lisible, si échec. */
  error?: string;
  /** En ligne : le site est reconstruit après le commit (délai indicatif). */
  pendingDeploy?: boolean;
}

async function readError(res: Response) {
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return json.error ?? `HTTP ${res.status}`;
}

/** Publie le contenu : écrit content.json (local) ou fait un commit (en ligne). */
export async function publishContent(patch: ContentPatch): Promise<PublishResult> {
  const project = encodeURIComponent(activeProject().slug);
  const url = `${LOCAL ? '/__admin/scene-config' : '/api/publish'}?project=${project}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch),
    });
    if (res.status === 401) return { ok: false, error: 'Session expirée : reconnectez-vous.' };
    if (res.status === 404 && !LOCAL) return { ok: false, error: 'Publication en ligne pas encore configurée.' };
    if (!res.ok) return { ok: false, error: await readError(res) };
    return { ok: true, pendingDeploy: !LOCAL };
  } catch (err) {
    return { ok: false, error: `${err instanceof Error ? err.message : String(err)}${LOCAL ? ' (serveur de dev lancé ?)' : ''}` };
  }
}

/** Envoie une image (vignette, illustration) ; renvoie son URL depuis la racine du site. */
export async function uploadImage(file: Blob, name: string): Promise<string> {
  const url = `${LOCAL ? '/__admin/upload' : '/api/upload'}?project=${encodeURIComponent(activeProject().slug)}&name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { method: 'POST', body: file, credentials: 'same-origin' });
  if (res.status === 401) throw new Error('Session expirée : reconnectez-vous.');
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { url: string };
  return json.url;
}
