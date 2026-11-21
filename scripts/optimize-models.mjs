// Optimise les GLB de la maquette (paris, cull_pantheon, sol_pantheon, tranche…) pour le web,
// dans un dossier NEUF : les sources ne sont jamais modifiées.
//
//   géométrie : attributs inutiles au viewer retirés (affichage unlit : NORMAL, COLOR_n,
//               UV non utilisées par une texture), sommets identiques fusionnés,
//               quantification 16 bits + compression meshopt (EXT_meshopt_compression).
//   textures  : PNG/JPEG → KTX2 ETC1S (KHR_texture_basisu) avec mipmaps, sRGB.
//               Suffixe « :webp » sur un fichier : WebP quasi sans perte (EXT_texture_webp),
//               visuellement identique à l'original, ~2,5× plus léger que le PNG.
//               Suffixe « :jpeg » : JPEG qualité JPEG_QUALITY (plus léger, artefacts visibles
//               sur un atlas à petits îlots comme la ville).
//               L'ETC1S (blocs 4×4 d'une seule teinte) convient aux textures clay lisses,
//               mais pixelise et décale les couleurs d'une texture détaillée (ville).
//
// Prérequis : KTX-Software ≥ 4.3 (`ktx`) dans le PATH, ou son dossier dans KTX_BIN.
// Variables : ETC1S_QUALITY (qlevel 1–255, défaut 255), ETC1S_EFFORT (clevel 0–6, défaut 5),
//             WEBP_NEAR_LOSSLESS (0–100, défaut 60 ; 100 = sans perte), JPEG_QUALITY (1–100, défaut 90).
//
//   node scripts/optimize-models.mjs public/models/opt public/models/paris.glb:webp public/models/sol_pantheon.glb …
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRTextureBasisu } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import sharp from 'sharp';

const [outDir, ...inputs] = process.argv.slice(2);
if (!outDir || inputs.length === 0) throw new Error('Usage : node scripts/optimize-models.mjs <dossier de sortie> <fichier.glb>…');

const env = process.env;
const QUALITY = env.ETC1S_QUALITY ?? '255';
const EFFORT = env.ETC1S_EFFORT ?? '5';
const JPEG_QUALITY = Number(env.JPEG_QUALITY ?? 90);
const WEBP_NEAR_LOSSLESS = Number(env.WEBP_NEAR_LOSSLESS ?? 60);
const ktx = env.KTX_BIN ? join(env.KTX_BIN, 'ktx') : 'ktx';
try {
  execFileSync(ktx, ['--version']);
} catch {
  throw new Error('KTX-Software introuvable (commande `ktx`). Installez-le ou définissez KTX_BIN.');
}

mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'optimize-models-'));
const mb = (n) => (n / 1e6).toFixed(2);

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

try {
  for (const arg of inputs) {
    const mode = /:(jpeg|webp)$/.exec(arg)?.[1] ?? 'ktx2';
    const input = arg.replace(/:(jpeg|webp)$/, '');
    const out = join(outDir, basename(input));
    if (resolve(out) === resolve(input)) throw new Error(`${input} : la sortie écraserait la source`);
    const doc = await io.read(input);
    const root = doc.getRoot();

    // UV réellement lues par une texture (les autres sont retirées).
    const usedUv = new Set();
    for (const mat of root.listMaterials()) {
      for (const info of [mat.getBaseColorTextureInfo(), mat.getEmissiveTextureInfo(), mat.getOcclusionTextureInfo()]) {
        if (info) usedUv.add(info.getTexCoord());
      }
    }
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        for (const s of prim.listSemantics()) {
          const uv = /^TEXCOORD_(\d+)$/.exec(s);
          if (s === 'NORMAL' || s === 'TANGENT' || s.startsWith('COLOR_') || (uv && !usedUv.has(Number(uv[1])))) {
            prim.setAttribute(s, null);
          }
        }
      }
    }
    await doc.transform(
      prune(),
      dedup(),
      weld(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeTexcoord: 16 }),
    );

    // Textures → KTX2 ETC1S. Alpha conservé seulement si un matériau en a besoin.
    const textures = root.listTextures();
    if (textures.length && mode === 'webp') {
      for (const tex of textures) {
        const before = tex.getImage().byteLength;
        const opts = WEBP_NEAR_LOSSLESS >= 100 ? { lossless: true } : { nearLossless: true, quality: WEBP_NEAR_LOSSLESS };
        const img = await sharp(tex.getImage()).webp({ ...opts, effort: 6 }).toBuffer();
        console.log(`  texture « ${tex.getName()} » ${tex.getSize()?.join('×')} : ${mb(before)} → ${mb(img.byteLength)} Mo (WebP)`);
        tex.setImage(img).setMimeType('image/webp').setURI(tex.getURI().replace(/\.\w+$/, '.webp'));
      }
      doc.createExtension(EXTTextureWebP).setRequired(true);
    } else if (textures.length && mode === 'jpeg') {
      const needsAlpha = root.listMaterials().some((m) => m.getAlphaMode() !== 'OPAQUE');
      if (needsAlpha) throw new Error(`${input} : JPEG impossible, un matériau utilise la transparence`);
      for (const tex of textures) {
        const before = tex.getImage().byteLength;
        const img = await sharp(tex.getImage()).jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
        console.log(`  texture « ${tex.getName()} » ${tex.getSize()?.join('×')} : ${mb(before)} → ${mb(img.byteLength)} Mo (JPEG ${JPEG_QUALITY})`);
        tex.setImage(img).setMimeType('image/jpeg').setURI(tex.getURI().replace(/\.\w+$/, '.jpg'));
      }
    } else if (textures.length) {
      const needsAlpha = root.listMaterials().some((m) => m.getAlphaMode() !== 'OPAQUE');
      textures.forEach((tex, i) => {
        const ext = tex.getMimeType() === 'image/jpeg' ? 'jpg' : 'png';
        const src = join(tmp, `t${i}.${ext}`);
        const dst = join(tmp, `t${i}.ktx2`);
        writeFileSync(src, tex.getImage());
        execFileSync(ktx, [
          'create', '--format', needsAlpha ? 'R8G8B8A8_SRGB' : 'R8G8B8_SRGB', '--encode', 'basis-lz',
          '--qlevel', QUALITY, '--clevel', EFFORT, '--generate-mipmap', src, dst,
        ]);
        console.log(`  texture « ${tex.getName()} » ${tex.getSize()?.join('×')} : ${mb(tex.getImage().byteLength)} → ${mb(statSync(dst).size)} Mo`);
        tex.setImage(readFileSync(dst)).setMimeType('image/ktx2').setURI(tex.getURI().replace(/\.\w+$/, '.ktx2'));
      });
      doc.createExtension(KHRTextureBasisu).setRequired(true);
    }

    writeFileSync(out, await io.writeBinary(doc));
    console.log(`${basename(input)} : ${mb(statSync(input).size)} → ${mb(statSync(out).size)} Mo`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
