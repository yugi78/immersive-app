#!/usr/bin/env node
/**
 * Ajoute (ou remplace) un compte de l'espace client et affiche la valeur complète de la
 * variable secrète ADMIN_USERS à coller dans Cloudflare Pages.
 *
 *   npm run add-client -- <identifiant> <projet>      (projet « * » : tous les projets)
 *   npm run add-client -- --list                      (comptes enregistrés, sans empreinte)
 *   npm run add-client -- --retirer <identifiant>
 *
 * Le mot de passe est demandé sans être affiché ; seule son empreinte PBKDF2-SHA256 est
 * gardée. La liste vit dans clients.local.json (ignoré par Git, jamais publié) : c'est ta
 * copie de référence de ADMIN_USERS.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ask, hashPassword } from './hash-password.mjs';

const FILE = fileURLToPath(new URL('../clients.local.json', import.meta.url));
const PROJECTS = fileURLToPath(new URL('../projects/', import.meta.url));
const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []);
const save = (list) => writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
const show = (list) => {
  console.log('\nValeur de ADMIN_USERS (Cloudflare → Settings → Variables and Secrets, type Secret) :\n');
  console.log(JSON.stringify(list));
  console.log('\nComptes :', list.map((a) => `${a.user} → ${a.project}`).join(', ') || 'aucun');
};

const [a, b] = process.argv.slice(2);
if (a === '--list') {
  const list = load();
  console.log(list.map((c) => `${c.user} → ${c.project}`).join('\n') || 'Aucun compte.');
  process.exit(0);
}
if (a === '--retirer') {
  const list = load().filter((c) => c.user !== b);
  save(list);
  show(list);
  process.exit(0);
}
const user = (a ?? '').trim();
const project = (b ?? '').trim();
if (!user || !project) {
  console.error('Usage : npm run add-client -- <identifiant> <projet>   (projet « * » : tous les projets)');
  process.exit(1);
}
if (project !== '*' && (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(project) || !existsSync(`${PROJECTS}${project}/scene.json`))) {
  console.error(`Projet inconnu : ${project} (attendu : un dossier projects/<projet>/ ou « * »)`);
  process.exit(1);
}
const password = await ask(`Mot de passe de ${user} : `);
if (!password || password.length < 10) {
  console.error('Mot de passe trop court (10 caractères minimum).');
  process.exit(1);
}
if ((await ask('Confirme le mot de passe : ')) !== password) {
  console.error('Les deux saisies diffèrent.');
  process.exit(1);
}
const list = load().filter((c) => c.user !== user);
list.push({ user, project, hash: hashPassword(password) });
save(list);
show(list);
