import { json, sameOrigin, sessionCookie, verifyPassword, type Ctx } from '../_lib/auth';

/**
 * POST /api/login { user, password } → cookie de session.
 * Un échec répond après un délai fixe (freine les essais en série) et sans dire si
 * c'est l'identifiant ou le mot de passe qui est faux.
 */
export async function onRequestPost({ request, env }: Ctx) {
  if (!sameOrigin(request)) return json(403, { error: 'Origine refusée' });
  if (!env.ADMIN_USER || !env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) {
    return json(503, { error: 'Connexion non configurée sur le serveur.' });
  }
  const body = (await request.json().catch(() => ({}))) as { user?: unknown; password?: unknown };
  const user = typeof body.user === 'string' ? body.user.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const ok = user === env.ADMIN_USER && password.length > 0 && (await verifyPassword(password, env.ADMIN_PASSWORD_HASH));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 1200));
    return json(401, { error: 'Identifiant ou mot de passe incorrect.' });
  }
  return json(200, { ok: true }, { 'set-cookie': await sessionCookie(env, user) });
}
