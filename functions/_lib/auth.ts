/**
 * Connexion de l'espace client (Cloudflare Pages Functions, Web Crypto uniquement).
 *
 * Mot de passe : jamais stocké en clair. La variable ADMIN_PASSWORD_HASH contient une
 * empreinte PBKDF2-SHA256 (« pbkdf2$100000$<sel base64>$<empreinte base64> »), produite
 * par `node scripts/hash-password.mjs`.
 *
 * Session : cookie HttpOnly, Secure, SameSite=Strict, signé HMAC-SHA256 avec
 * SESSION_SECRET (« <expiration>.<utilisateur>.<signature> »). Sans le secret, on ne
 * peut ni le fabriquer ni le modifier.
 */

export interface Env {
  /** Identifiant du client. */
  ADMIN_USER: string;
  /** Empreinte du mot de passe (voir scripts/hash-password.mjs). */
  ADMIN_PASSWORD_HASH: string;
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

/** Cookie de session à poser après une connexion réussie. */
export async function sessionCookie(env: Env, user: string) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_S;
  const payload = `${exp}.${encodeURIComponent(user)}`;
  const value = `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_S}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** Utilisateur de la session si le cookie est valide et non expiré, sinon null. */
export async function sessionUser(request: Request, env: Env): Promise<string | null> {
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
  const [exp, user] = payload.split('.');
  if (!(Number(exp) > Date.now() / 1000)) return null;
  return decodeURIComponent(user ?? '');
}

export const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

/** Refuse les requêtes venant d'un autre site (protection CSRF, en plus de SameSite). */
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
