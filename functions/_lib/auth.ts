/**
 * Connexion de l'espace client (Cloudflare Pages Functions, Web Crypto uniquement).
 *
 * Comptes : la variable secrète ADMIN_USERS contient la liste des comptes, chacun
 * rattaché à UN projet :
 *   [{ "user": "pantheon", "project": "pantheon", "hash": "pbkdf2$100000$…$…" }, …]
 * « "project": "*" » donne accès à tous les projets (compte du développeur).
 * Ancienne configuration encore acceptée : ADMIN_USER + ADMIN_PASSWORD_HASH (+ ADMIN_PROJECT,
 * « pantheon » par défaut). Les empreintes sont produites par `npm run add-client`.
 *
 * Mot de passe : jamais stocké en clair, seulement son empreinte PBKDF2-SHA256.
 *
 * Session : cookie HttpOnly, Secure, SameSite=Strict, signé HMAC-SHA256 avec
 * SESSION_SECRET (« <expiration>.<utilisateur>.<version>.<signature> »). Sans le secret,
 * on ne peut ni le fabriquer ni le modifier. Le projet n'est PAS dans le cookie : il est
 * relu dans ADMIN_USERS à chaque requête, donc retirer un compte ou changer son projet
 * s'applique aussitôt. La « version » dérive de l'empreinte du mot de passe : changer le
 * mot de passe déconnecte les sessions ouvertes de ce compte.
 */

export interface Env {
  /** Comptes clients (JSON, voir plus haut). */
  ADMIN_USERS?: string;
  /** Ancienne configuration à un seul compte. */
  ADMIN_USER?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_PROJECT?: string;
  /** Secret de signature des sessions (longue chaîne aléatoire). */
  SESSION_SECRET: string;
  /** Jeton GitHub (droits « Contents : read and write » sur ce seul dépôt). */
  GITHUB_TOKEN: string;
  /** Dépôt « propriétaire/nom ». */
  GITHUB_REPO: string;
  /** Branche publiée (par défaut : master). */
  GITHUB_BRANCH?: string;
  /** « 1 » : publication simulée, rien n'est envoyé à GitHub (tests en local). */
  PUBLISH_DRY_RUN?: string;
}

/** Un compte client : identifiant, projet autorisé (« * » : tous), empreinte du mot de passe. */
export interface Account {
  user: string;
  project: string;
  hash: string;
}

const PROJECT_RE = /^([a-z0-9][a-z0-9-]{0,62}|\*)$/;

/** Comptes configurés (les entrées mal formées sont ignorées). */
export function accounts(env: Env): Account[] {
  if (env.ADMIN_USERS) {
    try {
      const list = JSON.parse(env.ADMIN_USERS);
      if (!Array.isArray(list)) return [];
      return list.filter(
        (a): a is Account =>
          !!a && typeof a.user === 'string' && a.user.trim() !== '' && typeof a.hash === 'string' && typeof a.project === 'string' && PROJECT_RE.test(a.project),
      ).map((a) => ({ user: a.user.trim(), project: a.project, hash: a.hash }));
    } catch {
      return [];
    }
  }
  if (env.ADMIN_USER && env.ADMIN_PASSWORD_HASH) {
    const project = env.ADMIN_PROJECT && PROJECT_RE.test(env.ADMIN_PROJECT) ? env.ADMIN_PROJECT : 'pantheon';
    return [{ user: env.ADMIN_USER, project, hash: env.ADMIN_PASSWORD_HASH }];
  }
  return [];
}

export const findAccount = (env: Env, user: string) => accounts(env).find((a) => a.user === user) ?? null;

/** Le compte peut-il modifier ce projet ? */
export const canEdit = (account: Account, project: string) => account.project === '*' || account.project === project;

/** Page d'accueil du compte après connexion. */
export const homeOf = (account: Account) => (account.project === '*' ? '/admin/' : `/${account.project}/admin/`);

export interface Ctx {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

export const COOKIE = 'pv_session';
/** Durée d'une session (s) : 7 jours. */
const SESSION_S = 7 * 24 * 3600;

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf: ArrayBuffer) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Comparaison en temps constant (évite de deviner une valeur à son temps de réponse). */
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = (stored ?? '').split('$');
  if (algo !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: Number(iter) }, key, 256);
  return sameBytes(new Uint8Array(bits), unb64(hash));
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Version de session d'un compte : change avec son mot de passe. */
async function version(account: Account) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(account.hash))).slice(0, 12);
}

/** Identifiant sans point (séparateur du cookie). */
const encUser = (user: string) => encodeURIComponent(user).replace(/\./g, '%2E');

/** Cookie de session à poser après une connexion réussie. */
export async function sessionCookie(env: Env, account: Account) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_S;
  const payload = `${exp}.${encUser(account.user)}.${await version(account)}`;
  const value = `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_S}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** Compte de la session si le cookie est valide, non expiré et le compte toujours actif, sinon null. */
export async function session(request: Request, env: Env): Promise<Account | null> {
  if (!env.SESSION_SECRET) return null;
  const raw = (request.headers.get('cookie') ?? '')
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const last = raw.lastIndexOf('.');
  if (last < 0) return null;
  const payload = raw.slice(0, last);
  const sig = raw.slice(last + 1);
  if (!sameBytes(enc.encode(sig), enc.encode(await hmac(env.SESSION_SECRET, payload)))) return null;
  const [exp, user, ver] = payload.split('.');
  if (!(Number(exp) > Date.now() / 1000) || !user || !ver) return null;
  const account = findAccount(env, decodeURIComponent(user));
  if (!account || ver !== (await version(account))) return null;
  return account;
}

export const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

/** Refuse les requêtes venant d'un autre site (protection CSRF, en plus de SameSite). */
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
