import type { AstroIntegration } from 'astro';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * API de dev pour le back-office Puck : écrit les réglages de scène directement
 * dans src/viewer/config/scene.json. N'existe que sur le serveur de dev
 * (astro dev), jamais dans le site construit.
 *
 *   POST /__admin/scene-config  { focus: { ... }, cutaway: { ... }, mist: { ... }, ... }
 *
 * Les clés acceptées sont dans scene-config-schema.ts, rechargé à chaque requête.
 */
const ROUTE = '/__admin/scene-config';

export default function sceneConfigApi(): AstroIntegration {
  return {
    name: 'scene-config-api',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        const file = fileURLToPath(new URL('../src/viewer/config/scene.json', import.meta.url));
        const schema = fileURLToPath(new URL('./scene-config-schema.ts', import.meta.url));

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
              config[section] = { ...config[section], ...values };
            }
            await writeFile(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
            logger.info(`scene.json mis à jour : ${JSON.stringify(patch)}`);
            send(200, { ok: true, config });
          } catch (err) {
            send(400, { error: err instanceof Error ? err.message : String(err) });
          }
        });
      },
    },
  };
}
