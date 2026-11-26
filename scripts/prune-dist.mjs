#!/usr/bin/env node
/**
 * Après `astro build` : retire de dist/ ce qui ne doit pas être mis en ligne.
 *
 * - Les modèles SOURCE (non optimisés) : ils servent aux scripts d'optimisation en
 *   local ; le site ne charge que models/opt/ et models/scan_lod_opt/.
 * - Avec `--sans-admin` : l'espace client et la page de connexion, pour un hébergeur
 *   sans fonctions serveur (GitHub Pages) où ils ne pourraient pas être protégés.
 * - Avec `--racine <projet>` : la racine redirige vers /<projet>/ (domaine d'un seul projet).
 */
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const removed = [];
const rm = (rel) => {
  const p = join(dist, rel);
  try {
    statSync(p);
  } catch {
    return;
  }
  rmSync(p, { recursive: true, force: true });
  removed.push(rel);
};

// Par projet (dist/projects/<slug>/models/) : modèles sources (*.glb à la racine de
// models/), scan non optimisé et essais de tuilage (présents seulement en local).
let slugs = [];
try {
  slugs = readdirSync(join(dist, 'projects'));
} catch {
  slugs = [];
}
for (const slug of slugs) {
  const models = `projects/${slug}/models`;
  try {
    for (const f of readdirSync(join(dist, models))) if (f.endsWith('.glb')) rm(`${models}/${f}`);
  } catch {
    continue;
  }
  rm(`${models}/scan_lod`);
  rm(`${models}/3dtile`);
  rm(`${models}/3dtile_opt`);
}

if (process.argv.includes('--sans-admin')) {
  rm('admin');
  rm('connexion');
  // Espace client de chaque projet : dist/<slug>/admin/.
  for (const d of readdirSync(dist)) rm(`${d}/admin`);
}
// Domaine dédié à un seul projet (pantheon.stylz.fr) : la racine redirige vers ce projet
// (en gardant le #œuvre) au lieu d'afficher l'accueil de l'espace client.
const ri = process.argv.indexOf('--racine');
if (ri > 0) {
  const slug = process.argv[ri + 1] ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new Error(`--racine : projet invalide (${slug})`);
  const target = `/${slug}/`;
  writeFileSync(
    join(dist, 'index.html'),
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Redirection</title>` +
      `<script>location.replace(${JSON.stringify(target)} + location.hash)</script>` +
      `<meta http-equiv="refresh" content="0; url=${target}"></head><body></body></html>\n`,
  );
  removed.push(`index.html (remplacé par une redirection vers ${target})`);
}
console.log(`dist/ : retiré ${removed.length ? removed.join(', ') : 'rien'}`);
