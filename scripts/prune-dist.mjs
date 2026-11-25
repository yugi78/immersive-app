#!/usr/bin/env node
/**
 * Après `astro build` : retire de dist/ ce qui ne doit pas être mis en ligne.
 *
 * - Les modèles SOURCE (non optimisés) : ils servent aux scripts d'optimisation en
 *   local ; le site ne charge que models/opt/ et models/scan_lod_opt/.
 * - Avec `--sans-admin` : l'espace client et la page de connexion, pour un hébergeur
 *   sans fonctions serveur (GitHub Pages) où ils ne pourraient pas être protégés.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
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

// Modèles sources (models/*.glb à la racine, scan non optimisé).
for (const f of readdirSync(join(dist, 'models'))) if (f.endsWith('.glb')) rm(`models/${f}`);
rm('models/scan_lod');
// Essais de tuilage (non suivis par Git, présents seulement en local).
rm('models/3dtile');
rm('models/3dtile_opt');

if (process.argv.includes('--sans-admin')) {
  rm('admin');
  rm('connexion');
}
console.log(`dist/ : retiré ${removed.length ? removed.join(', ') : 'rien'}`);
