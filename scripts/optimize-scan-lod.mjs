// Optimise les tuiles du scan (sortie de scripts/scan_lod/build_tiles.py) pour le web,
// dans un dossier NEUF : la source n'est jamais modifiée.
//
//   géométrie : attributs inutiles au viewer retirés (NORMAL, COLOR_n : le scan est
//               affiché sans éclairage ni couleurs de sommet), sommets identiques fusionnés,
//               quantification 16 bits (positions, UV) + compression meshopt
//               (EXT_meshopt_compression, KHR_mesh_quantization).
//               La quantification ajoute une transformation au nœud : le viewer l'applique.
//   textures  : chaque niveau JPEG → KTX2 ETC1S (BasisLZ) avec mipmaps, sRGB.
//   manifest  : recopié, chemins des textures en .ktx2 ; bbox inchangées (repère local).
//
// Prérequis : KTX-Software ≥ 4.3 (`ktx`) dans le PATH, ou son dossier dans KTX_BIN.
// Variables : ETC1S_QUALITY (qlevel 1–255, défaut 192), ETC1S_EFFORT (clevel 0–6, défaut 4),
//             JOBS (encodages parallèles, défaut : nombre de cœurs).
//
//   node scripts/optimize-scan-lod.mjs public/models/scan_lod public/models/scan_lod_opt
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) throw new Error('Usage : node scripts/optimize-scan-lod.mjs <dossier source> <dossier de sortie>');
if (resolve(srcDir) === resolve(outDir)) throw new Error('La sortie doit être un autre dossier que la source');

const env = process.env;
const QUALITY = env.ETC1S_QUALITY ?? '192';
const EFFORT = env.ETC1S_EFFORT ?? '4';
const JOBS = Number(env.JOBS ?? availableParallelism());
const ktx = env.KTX_BIN ? join(env.KTX_BIN, 'ktx') : 'ktx';
try {
  execFileSync(ktx, ['--version']);
} catch {
  throw new Error('KTX-Software introuvable (commande `ktx`). Installez-le ou définissez KTX_BIN.');
}
const run = promisify(execFile);

const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));
mkdirSync(outDir, { recursive: true });
const size = (dir, f) => statSync(join(dir, f)).size;
const mb = (n) => (n / 1e6).toFixed(1);

/** Exécute les tâches avec au plus `limit` en parallèle. */
async function pool(tasks, limit) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) await tasks[next++]();
    }),
  );
}

// 1. Géométrie.
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
let geoIn = 0;
let geoOut = 0;
for (const t of manifest.tiles) {
  const doc = await io.read(join(srcDir, t.geometry));
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const s of prim.listSemantics()) if (s === 'NORMAL' || s.startsWith('COLOR_')) prim.setAttribute(s, null);
    }
  }
  await doc.transform(
    prune(),
    weld(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeTexcoord: 16 }),
  );
  writeFileSync(join(outDir, t.geometry), await io.writeBinary(doc));
  geoIn += size(srcDir, t.geometry);
  geoOut += size(outDir, t.geometry);
}
console.log(`géométrie : ${mb(geoIn)} Mo → ${mb(geoOut)} Mo`);

// 2. Textures : un encodage ktx par fichier, en parallèle.
const texIn = {};
const texOut = {};
const tasks = [];
const out = structuredClone(manifest);
for (const t of out.tiles) {
  for (const [level, file] of Object.entries(t.textures)) {
    const ktx2 = file.replace(/\.(jpe?g|png)$/i, '.ktx2');
    t.textures[level] = ktx2;
    tasks.push(async () => {
      await run(ktx, [
        'create', '--format', 'R8G8B8_SRGB', '--encode', 'basis-lz',
        '--qlevel', QUALITY, '--clevel', EFFORT, '--generate-mipmap',
        join(srcDir, file), join(outDir, ktx2),
      ]);
      texIn[level] = (texIn[level] ?? 0) + size(srcDir, file);
      texOut[level] = (texOut[level] ?? 0) + size(outDir, ktx2);
    });
  }
}
let done = 0;
await pool(tasks.map((task) => async () => {
  await task();
  if (++done % 50 === 0 || done === tasks.length) console.log(`textures : ${done}/${tasks.length}`);
}), JOBS);
for (const level of Object.keys(texIn).sort((a, b) => a - b)) {
  console.log(`textures ${level} px : ${mb(texIn[level])} Mo → ${mb(texOut[level])} Mo`);
}

// 3. Manifest.
out.source = `${manifest.source} → optimisé (scripts/optimize-scan-lod.mjs)`;
out.compression = { geometry: 'meshopt', textures: 'ktx2-etc1s', etc1sQuality: Number(QUALITY) };
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`✓ ${outDir}`);
