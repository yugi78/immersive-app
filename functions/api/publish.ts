import { sanitize } from '../../integrations/scene-config-schema';
import { json, sameOrigin, sessionUser, type Ctx } from '../_lib/auth';
import { GitHubError, readFile, writeFile } from '../_lib/github';

/** Fichier du contenu (le client ne peut écrire que celui-ci). */
const CONTENT = 'src/viewer/config/content.json';

/**
 * POST /api/publish (session requise) : valide les réglages envoyés par l'espace
 * client (même schéma qu'en local), les fusionne dans content.json et fait un commit.
 * Seules les sections déjà présentes dans content.json sont acceptées : la structure
 * de la scène (scene.json, fichiers 3D) reste hors d'atteinte.
 */
export async function onRequestPost({ request, env }: Ctx) {
  if (!sameOrigin(request)) return json(403, { error: 'Origine refusée' });
  const user = await sessionUser(request, env);
  if (!user) return json(401, { error: 'Session expirée' });
  try {
    const patch = sanitize(await request.json());
    const current = env.PUBLISH_DRY_RUN === '1' ? null : await readFile(env, CONTENT);
    if (!current && env.PUBLISH_DRY_RUN !== '1') return json(500, { error: 'content.json introuvable dans le dépôt' });
    const content = current ? JSON.parse(current.text) : {};
    for (const [section, values] of Object.entries(patch)) {
      if (current && !(section in content)) throw new Error(`Section hors contenu : ${section}`);
      content[section] = { ...content[section], ...values };
    }
    if (env.PUBLISH_DRY_RUN === '1') return json(200, { ok: true, dryRun: true, sections: Object.keys(patch) });
    // Même mise en forme que le serveur de dev (diffs lisibles dans GitHub).
    const text = JSON.stringify(content, null, 2) + '\n';
    const res = await writeFile(env, CONTENT, new TextEncoder().encode(text), `Contenu publié depuis l'espace client (${user})`, current!.sha);
    return json(200, { ok: true, commit: res.commit.sha });
  } catch (err) {
    const status = err instanceof GitHubError ? (err.status === 409 ? 409 : 502) : 400;
    return json(status, { error: err instanceof Error ? err.message : String(err) });
  }
}
