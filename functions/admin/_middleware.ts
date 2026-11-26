import { canEdit, homeOf, session, type Ctx } from '../_lib/auth';

/** Réponse d'une page privée : jamais mise en cache par un intermédiaire, jamais indexée. */
async function privatePage(next: () => Promise<Response>) {
  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'no-store');
  out.headers.set('x-robots-tag', 'noindex');
  return out;
}

/**
 * Protège /admin/ (accueil des projets) et /<projet>/admin/ (espace client d'un projet) :
 * - sans session valide : page de connexion (qui ramène ensuite ici) ;
 * - compte d'un autre projet : renvoyé vers l'espace client de SON projet ;
 * - /admin/ n'est ouvert qu'aux comptes « tous projets », les autres vont à leur projet.
 */
export async function onRequest({ request, env, next }: Ctx) {
  const url = new URL(request.url);
  const account = await session(request, env);
  if (!account) return Response.redirect(`${url.origin}/connexion/?retour=${encodeURIComponent(url.pathname)}`, 302);
  const m = /^\/([a-z0-9][a-z0-9-]{0,62})\/admin(\/|$)/.exec(url.pathname);
  const allowed = m ? canEdit(account, m[1]) : account.project === '*';
  if (!allowed) return Response.redirect(`${url.origin}${homeOf(account)}`, 302);
  return privatePage(next);
}
