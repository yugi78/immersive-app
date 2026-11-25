import { sessionUser, type Ctx } from '../_lib/auth';

/**
 * Protège /admin et tout ce qu'il contient : sans session valide, redirection vers la
 * page de connexion (qui ramène ensuite ici).
 */
export async function onRequest({ request, env, next }: Ctx) {
  if (await sessionUser(request, env)) {
    const res = await next();
    // Page privée : jamais mise en cache par un intermédiaire.
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'no-store');
    out.headers.set('x-robots-tag', 'noindex');
    return out;
  }
  const url = new URL(request.url);
  return Response.redirect(`${url.origin}/connexion/?retour=${encodeURIComponent(url.pathname)}`, 302);
}
