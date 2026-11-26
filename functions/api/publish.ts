import { sanitize } from '../../integrations/scene-config-schema';
import { canEdit, json, sameOrigin, session, type Ctx } from '../_lib/auth';
import { GitHubError, readFile, writeFile } from '../_lib/github';
import { SLUG } from '../_lib/project';

/**
 * POST /api/publish (session requise) : valide les réglages envoyés par l'espace
 * client (même schéma qu'en local), les fusionne dans content.json et fait un commit.
 * Seules les sections déjà présentes dans content.json sont acceptées : la structure
 * de la scène (scene.json, fichiers 3D) reste hors d'atteinte.
 */
export async function onRequestPost({ request, env }: Ctx) {
  if (!sameOrigin(request)) return json(403, { error: 'Origine refusée' });
  const account = await session(request, env);
  if (!account) return json(401, { error: 'Session expirée' });
  const user = account.user;
  try {
    const project = new URL(request.url).searchParams.get('project') ?? '';
    if (!SLUG.test(project)) return json(400, { error: 'Projet invalide' });
    // Chaque compte ne publie que dans SON projet.
    if (!canEdit(account, project)) return json(403, { error: 'Ce compte n’a pas accès à ce projet' });
    // Le client ne peut écrire que le CONTENU de son projet.
    const CONTENT = `projects/${project}/content.json`;
    const patch = sanitize(await request.json());
    const current = env.PUBLISH_DRY_RUN === '1' ? null : await readFile(env, CONTENT);
    if (!current && env.PUBLISH_DRY_RUN !== '1') return json(404, { error: `Projet introuvable dans le dépôt : ${project}` });
    const content = current ? JSON.parse(current.text) : {};
    for (const [section, values] of Object.entries(patch)) {
      if (current && !(section in content)) throw new Error(`Section hors contenu : ${section}`);
      content[section] = { ...content[section], ...values };
    }
    if (env.PUBLISH_DRY_RUN === '1') return json(200, { ok: true, dryRun: true, sections: Object.keys(patch) });
    // Même mise en forme que le serveur de dev (diffs lisibles dans GitHub).
    const text = JSON.stringify(content, null, 2) + '\n';
    const res = await writeFile(env, CONTENT, new TextEncoder().encode(text), `${project} : contenu publié depuis l'espace client (${user})`, current!.sha);
    return json(200, { ok: true, commit: res.commit.sha });
  } catch (err) {
    const status = err instanceof GitHubError ? (err.status === 409 ? 409 : 502) : 400;
    return json(status, { error: err instanceof Error ? err.message : String(err) });
  }
}
