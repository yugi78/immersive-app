import type { Env } from './auth';

/**
 * Écriture dans le dépôt via l'API GitHub (contenu d'un fichier, un commit par appel).
 * Le jeton reste côté serveur. Le commit déclenche la reconstruction du site.
 */

const API = 'https://api.github.com';

function headers(env: Env) {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'pantheon-admin',
  };
}

const fileUrl = (env: Env, path: string) => `${API}/repos/${env.GITHUB_REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
const branch = (env: Env) => env.GITHUB_BRANCH || 'master';

/** base64 d'octets (par blocs : pas de dépassement de pile sur les gros fichiers). */
export function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (s: string) => Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0));

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Lit un fichier texte du dépôt : contenu et « sha » (version, pour éviter d'écraser). */
export async function readFile(env: Env, path: string): Promise<{ text: string; sha: string } | null> {
  const res = await fetch(`${fileUrl(env, path)}?ref=${encodeURIComponent(branch(env))}`, { headers: headers(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(`GitHub (lecture) : HTTP ${res.status}`, res.status);
  const data = (await res.json()) as { content: string; sha: string };
  return { text: new TextDecoder().decode(fromBase64(data.content)), sha: data.sha };
}

/**
 * Écrit un fichier (création ou mise à jour). `sha` : version lue avant modification ;
 * si le fichier a changé entre-temps, GitHub refuse (409) au lieu d'écraser.
 */
export async function writeFile(env: Env, path: string, bytes: Uint8Array, message: string, sha?: string) {
  const res = await fetch(fileUrl(env, path), {
    method: 'PUT',
    headers: { ...headers(env), 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      content: toBase64(bytes),
      branch: branch(env),
      ...(sha ? { sha } : {}),
      committer: { name: 'Espace client', email: 'espace-client@users.noreply.github.com' },
    }),
  });
  if (res.status === 409 || res.status === 422) {
    throw new GitHubError('Le contenu a été modifié entre-temps : rechargez la page puis publiez à nouveau.', 409);
  }
  if (!res.ok) throw new GitHubError(`GitHub (écriture) : HTTP ${res.status}`, res.status);
  return (await res.json()) as { commit: { sha: string } };
}
