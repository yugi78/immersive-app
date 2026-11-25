import type { AstroIntegration } from 'astro';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * API de dev pour le back-office Puck : écrit les réglages de scène directement
 * dans src/viewer/config/content.json. N'existe que sur le serveur de dev
 * (astro dev), jamais dans le site construit.
 *
 *   POST /__admin/scene-config  { focus: { ... }, cutaway: { ... }, mist: { ... }, ... }
 *
 * Les clés acceptées sont dans scene-config-schema.ts, rechargé à chaque requête.
 *
 *   POST /__admin/upload?name=fichier.webp  (corps : le fichier brut)
 *
 * Enregistre une image (vignette, image du contenu) dans public/media/ et
 * renvoie son URL depuis la racine du site (« /media/fichier.webp »).
 */
const ROUTE = '/__admin/scene-config';
const UPLOAD = '/__admin/upload';
const UPLOAD_MAX = 15 * 1024 * 1024;

export default function sceneConfigApi(): AstroIntegration {
  return {
    name: 'scene-config-api',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        // Le back-office ne modifie que le CONTENU (content.json), jamais la structure (scene.json).
        const file = fileURLToPath(new URL('../src/viewer/config/content.json', import.meta.url));
        const schema = fileURLToPath(new URL('./scene-config-schema.ts', import.meta.url));

        const media = fileURLToPath(new URL('../public/media/', import.meta.url));
        server.middlewares.use(UPLOAD, async (req, res) => {
          const send = (status: number, data: unknown) => {
            res.statusCode = status;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(data));
          };
          if (req.method !== 'POST') return send(405, { error: 'POST uniquement' });
          try {
            const raw = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? '';
            // Nom de fichier sûr : lettres, chiffres, tirets ; extension d'image uniquement.
            const m = /^([\w-]{1,80})\.(webp|jpe?g|png|avif)$/i.exec(raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-'));
            if (!m) throw new Error('Nom de fichier invalide (webp, jpg, png ou avif)');
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > UPLOAD_MAX) throw new Error('Fichier trop lourd (15 Mo max)');
              chunks.push(chunk as Buffer);
            }
            const name = `${m[1]}.${m[2].toLowerCase()}`;
            await mkdir(media, { recursive: true });
            await writeFile(join(media, name), Buffer.concat(chunks));
            logger.info(`image enregistrée : public/media/${name}`);
            send(200, { url: `/media/${name}` });
          } catch (err) {
            send(400, { error: err instanceof Error ? err.message : String(err) });
          }
        });

        server.middlewares.use(ROUTE, async (req, res) => {
          const send = (status: number, data: unknown) => {
            res.statusCode = status;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(data));
          };
          if (req.method !== 'POST') return send(405, { error: 'POST uniquement' });
          try {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            // Chargé via Vite à chaque requête : toujours la version à jour du fichier.
            const { sanitize } = (await server.ssrLoadModule(schema)) as typeof import('./scene-config-schema');
            const patch = sanitize(JSON.parse(raw));
            const config = JSON.parse(await readFile(file, 'utf8'));
            for (const [section, values] of Object.entries(patch)) {
              // Garde-fou : seules les sections déjà présentes dans content.json sont modifiables.
              if (!(section in config)) throw new Error(`Section hors contenu : ${section}`);
              config[section] = { ...config[section], ...values };
            }
            await writeFile(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
            logger.info(`content.json mis à jour : ${Object.keys(patch).join(', ')}`);
            send(200, { ok: true, config });
          } catch (err) {
            send(400, { error: err instanceof Error ? err.message : String(err) });
          }
        });
      },
    },
  };
}
