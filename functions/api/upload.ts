import { json, sameOrigin, sessionUser, type Ctx } from '../_lib/auth';
import { GitHubError, writeFile } from '../_lib/github';
import { SLUG } from '../_lib/project';

/** Taille maximale d'une image (les vignettes et illustrations font quelques centaines de Ko). */
const MAX = 8 * 1024 * 1024;

/**
 * POST /api/upload?project=…&name=… (session requise) : ajoute une image dans
 * public/projects/<projet>/media/
 * par un commit. Nom assaini, images seulement. L'image est en ligne après la
 * reconstruction du site (1 à 2 min).
 */
export async function onRequestPost({ request, env }: Ctx) {
  if (!sameOrigin(request)) return json(403, { error: 'Origine refusée' });
  const user = await sessionUser(request, env);
  if (!user) return json(401, { error: 'Session expirée' });
  try {
    const params = new URL(request.url).searchParams;
    const project = params.get('project') ?? '';
    if (!SLUG.test(project)) return json(400, { error: 'Projet invalide' });
    const raw = params.get('name') ?? '';
    const m = /^([\w-]{1,80})\.(webp|jpe?g|png|avif)$/i.exec(
      raw.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-'),
    );
    if (!m) return json(400, { error: 'Nom de fichier invalide (webp, jpg, png ou avif)' });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) return json(400, { error: 'Fichier vide' });
    if (bytes.length > MAX) return json(413, { error: 'Image trop lourde (8 Mo max)' });
    const name = `${m[1]}.${m[2].toLowerCase()}`;
    const path = `public/projects/${project}/media/${name}`;
    if (env.PUBLISH_DRY_RUN !== '1') await writeFile(env, path, bytes, `${project} : image ajoutée depuis l'espace client (${user}) : ${name}`);
    return json(200, { url: `/projects/${project}/media/${name}` });
  } catch (err) {
    return json(err instanceof GitHubError ? 502 : 400, { error: err instanceof Error ? err.message : String(err) });
  }
}
