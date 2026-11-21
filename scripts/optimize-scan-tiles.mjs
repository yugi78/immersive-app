// Pipeline du scan en 3D Tiles, toujours relancé depuis le tileset d'origine
// (jamais modifié) vers un dossier de sortie neuf :
//
//   1. 3d-tiles-tools upgrade --targetVersion 1.1   (b3dm → glb)
//   2. textures → KTX2 (UASTC par défaut, Zstd), redimensionnées à MAX_TEXTURE px,
//      encodées directement par `ktx create` (KTX-Software), sans limite de pixels
//   3. géométrie → compression meshopt (EXT_meshopt_compression)
//   4. tileset.json : retire le géoréférencement fictif de RealityScan
//      (root.transform ENU→ECEF), conservé dans root.extras.originalTransform.
//      Le viewer place le scan avec `scanTransform` (scene.json).
//
// Les noms de fichiers ne changent pas : les `uri` du tileset restent valides.
//
// Prérequis :
//   - KTX-Software ≥ 4.3 (`ktx`) dans le PATH, ou dossier via KTX_BIN
//   - 3d-tiles-tools : `npm i -g 3d-tiles-tools --ignore-scripts` (sa dépendance
//     native better-sqlite3, inutile ici, ne compile pas sous Node 26), ou chemin
//     de son cli.mjs via TILES_TOOLS
//
// Variables : MAX_TEXTURE (8192), CODEC (uastc|etc1s), UASTC_LEVEL (2),
//             RDO_LAMBDA (vide = sans RDO), ETC1S_QUALITY (255), ZSTD (18)
//
//   node scripts/optimize-scan-tiles.mjs public/models/3dtile/tileset_test_plafond.json public/models/3dtile_opt
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const [srcTileset, outDir] = process.argv.slice(2);
if (!srcTileset || !outDir) {
  throw new Error('Usage : node scripts/optimize-scan-tiles.mjs <tileset source .json> <dossier de sortie>');
}
if (resolve(dirname(srcTileset)) === resolve(outDir)) throw new Error('La sortie doit être un autre dossier que la source');

const env = process.env;
const MAX_TEXTURE = Number(env.MAX_TEXTURE ?? 8192);
const CODEC = env.CODEC ?? 'uastc';
const ZSTD = env.ZSTD ?? '18';
const ktx = env.KTX_BIN ? join(env.KTX_BIN, 'ktx') : 'ktx';

const exec = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
try {
  exec(ktx, ['--version']);
} catch {
  throw new Error('KTX-Software introuvable (commande `ktx`). Installez-le ou définissez KTX_BIN.');
}

// 1. Conversion 3D Tiles 1.1 dans le dossier de sortie.
const outTileset = join(outDir, basename(srcTileset));
const upgradeArgs = ['upgrade', '-i', srcTileset, '-o', outTileset, '--targetVersion', '1.1', '--force', '--logLevel', 'warn'];
console.log('▶ 3d-tiles-tools upgrade → 1.1');
if (env.TILES_TOOLS) execFileSync(process.execPath, [env.TILES_TOOLS, ...upgradeArgs], { stdio: 'inherit' });
else execFileSync('3d-tiles-tools', upgradeArgs, { stdio: 'inherit', shell: process.platform === 'win32' });

const tileset = JSON.parse(readFileSync(outTileset, 'utf8'));
const uris = [];
(function collect(tile) {
  for (const c of [tile.content, ...(tile.contents ?? [])].filter(Boolean)) uris.push(c.uri);
  (tile.children ?? []).forEach(collect);
})(tileset.root);

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const work = mkdtempSync(join(tmpdir(), 'scan-tiles-'));
const mb = (n) => (n / 1e6).toFixed(1);

/** Encode une image (jpg/png) en KTX2 avec ktx create. */
function encodeKtx2(image, mime, width, height) {
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const input = join(work, `in.${ext}`);
  const output = join(work, 'out.ktx2');
  writeFileSync(input, image);
  const scale = Math.min(1, MAX_TEXTURE / Math.max(width, height));
  const args = ['create', '--format', 'R8G8B8_SRGB', '--assign-tf', 'srgb', '--generate-mipmap'];
  if (scale < 1) args.push('--width', String(Math.round(width * scale)), '--height', String(Math.round(height * scale)));
  if (CODEC === 'etc1s') {
    args.push('--encode', 'basis-lz', '--clevel', '4', '--qlevel', env.ETC1S_QUALITY ?? '255');
  } else {
    args.push('--encode', 'uastc', '--uastc-quality', env.UASTC_LEVEL ?? '2', '--zstd', ZSTD);
    if (env.RDO_LAMBDA) args.push('--uastc-rdo', '--uastc-rdo-l', env.RDO_LAMBDA);
  }
  exec(ktx, [...args, input, output]);
  return readFileSync(output);
}

let totalBefore = 0;
let totalAfter = 0;
for (const uri of uris) {
  const file = join(outDir, uri);
  const before = statSync(file).size;
  console.log(`▶ ${uri} (${mb(before)} Mo)`);
  const doc = await io.read(file);

  const basisu = doc.createExtension(KHRTextureBasisu).setRequired(true);
  for (const tex of doc.getRoot().listTextures()) {
    const mime = tex.getMimeType();
    if (mime === 'image/ktx2') continue;
    const [w, h] = tex.getSize() ?? [0, 0];
    const t0 = Date.now();
    tex.setImage(encodeKtx2(tex.getImage(), mime, w, h)).setMimeType('image/ktx2');
    if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(jpe?g|png)$/i, '.ktx2'));
    console.log(`  texture ${w}×${h} → KTX2 ${CODEC} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (!doc.getRoot().listTextures().length) basisu.dispose();

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(file, doc);
  const after = statSync(file).size;
  totalBefore += before;
  totalAfter += after;
  console.log(`  ${mb(before)} Mo → ${mb(after)} Mo`);
}
rmSync(work, { recursive: true, force: true });

// 4. Retrait du géoréférencement fictif.
if (tileset.root.transform) {
  tileset.root.extras = { ...tileset.root.extras, originalTransform: tileset.root.transform };
  delete tileset.root.transform;
}
writeFileSync(outTileset, JSON.stringify(tileset, null, 2) + '\n', 'utf8');
console.log(`\nTotal : ${mb(totalBefore)} Mo → ${mb(totalAfter)} Mo`);
console.log('tileset.json : root.transform retiré (copie dans root.extras.originalTransform)');
