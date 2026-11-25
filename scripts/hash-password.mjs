#!/usr/bin/env node
/**
 * Calcule l'empreinte du mot de passe de l'espace client, à coller dans la variable
 * secrète ADMIN_PASSWORD_HASH de Cloudflare Pages (jamais le mot de passe lui-même).
 *
 *   node scripts/hash-password.mjs            (le mot de passe est demandé, non affiché)
 *
 * Format : pbkdf2$100000$<sel base64>$<empreinte base64> (PBKDF2-SHA256, sel aléatoire).
 * 100 000 itérations : le maximum accepté par Cloudflare Workers.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

const ITER = 100_000;

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Masque la saisie (aucun caractère affiché).
    rl._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = process.argv[2] ?? (await ask('Mot de passe de l’espace client : '));
if (!password || password.length < 10) {
  console.error('Mot de passe trop court (10 caractères minimum).');
  process.exit(1);
}
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITER, 32, 'sha256');
console.log(`pbkdf2$${ITER}$${salt.toString('base64')}$${hash.toString('base64')}`);
