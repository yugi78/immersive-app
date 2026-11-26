import type { AstroIntegration } from 'astro';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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
const STRUCTURE = '/__admin/scene-structure';
const UPLOAD_MAX = 15 * 1024 * 1024;

export default function sceneConfigApi(): AstroIntegration {
  return {
    name: 'scene-config-api',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        // Le back-office ne modifie que le CONTENU (content.json), jamais la structure (scene.json).
        // Chaque requête vise un projet (?project=<slug>) : projects/<slug>/ pour les
        // réglages, public/projects/<slug>/media/ pour les images.
        const projectsDir = fileURLToPath(new URL('../projects/', import.meta.url));
        const publicProjects = fileURLToPath(new URL('../public/projects/', import.meta.url));
        async function projectOf(url: string | undefined) {
          const slug = new URL(url ?? '', 'http://x').searchParams.get('project') ?? '';
          if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new Error('Projet invalide (paramètre project)');
          await access(join(projectsDir, slug, 'scene.json')).catch(() => {
            throw new Error(`Projet inconnu : ${slug}`);
          });
          return {
            slug,
            content: join(projectsDir, slug, 'content.json'),
            scene: join(projectsDir, slug, 'scene.json'),
            media: join(publicProjects, slug, 'media'),
          };
        }
        const schema = fileURLToPath(new URL('./scene-config-schema.ts', import.meta.url));


        // Structure de la scène (objets + matériaux) : administration complète en local uniquement.

        const structureSchema = fileURLToPath(new URL('./scene-structure-schema.ts', import.meta.url));
        server.middlewares.use(STRUCTURE, async (req, res) => {
          const send = (status: number, data: unknown) => {
            res.statusCode = status;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(data));
          };
          if (req.method !== 'POST') return send(405, { error: 'POST uniquement' });
          try {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const { sanitizeStructure } = (await server.ssrLoadModule(structureSchema)) as typeof import('./scene-structure-schema');
            const { objects, materials } = sanitizeStructure(JSON.parse(raw));
            const { scene: sceneFile, slug } = await projectOf(req.originalUrl ?? req.url);
            const text = await readFile(sceneFile, 'utf8');
            const scene = JSON.parse(text);
            // Ancien format (rôles) remplacé par le nouveau : on retire ses sections.
            delete scene.assets;
            delete scene.scan;
            delete scene.scanTransform;
            const out: Record<string, unknown> = {};
            // Ordre des sections conservé : project, objects, materials, puis le reste.
            if (scene.project) out.project = scene.project;
            out.objects = objects;
            out.materials = materials;
            for (const [k, v] of Object.entries(scene)) if (!(k in out)) out[k] = v;
            const eol = text.includes('\r\n') ? '\r\n' : '\n';
            await writeFile(sceneFile, JSON.stringify(out, null, 2).replace(/\n/g, eol) + eol, 'utf8');
            logger.info(`${slug}/scene.json : structure mise à jour (${objects.length} objets, ${Object.keys(materials).length} matériaux)`);
            send(200, { ok: true });
          } catch (err) {
            send(400, { error: err instanceof Error ? err.message : String(err) });
          }
        });
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
            const { media, slug } = await projectOf(req.originalUrl ?? req.url);
            await mkdir(media, { recursive: true });
            await writeFile(join(media, name), Buffer.concat(chunks));
            logger.info(`image enregistrée : public/projects/${slug}/media/${name}`);
            send(200, { url: `/projects/${slug}/media/${name}` });
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
            const { content: file, slug } = await projectOf(req.originalUrl ?? req.url);
            const config = JSON.parse(await readFile(file, 'utf8'));
            for (const [section, values] of Object.entries(patch)) {
              // Garde-fou : seules les sections déjà présentes dans content.json sont modifiables.
              if (!(section in config)) throw new Error(`Section hors contenu : ${section}`);
              config[section] = { ...config[section], ...values };
            }
            await writeFile(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
            logger.info(`${slug}/content.json mis à jour : ${Object.keys(patch).join(', ')}`);
            send(200, { ok: true, config });
          } catch (err) {
            send(400, { error: err instanceof Error ? err.message : String(err) });
          }
        });
      },
    },
  };
}
