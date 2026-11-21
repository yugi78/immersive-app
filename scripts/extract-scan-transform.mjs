// Lit la matrice monde du nœud maillé de scan.glb (gabarit de placement exporté
// de Blender, transformation d'objet non appliquée) et l'écrit dans
// src/viewer/config/scene.json sous la clé `scanTransform`.
// scan.glb n'est jamais modifié.
//
//   node scripts/extract-scan-transform.mjs [public/models/scan.glb]
import { readFileSync, writeFileSync } from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';

const glbPath = process.argv[2] ?? 'public/models/scan.glb';
const configPath = 'src/viewer/config/scene.json';

const glb = readFileSync(glbPath);
if (glb.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${glbPath} n'est pas un GLB`);
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));

const localMatrix = (n) =>
  n.matrix
    ? new Matrix4().fromArray(n.matrix)
    : new Matrix4().compose(
        new Vector3(...(n.translation ?? [0, 0, 0])),
        new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
        new Vector3(...(n.scale ?? [1, 1, 1])),
      );

const meshNodes = [];
const walk = (index, parentWorld) => {
  const node = gltf.nodes[index];
  const world = parentWorld.clone().multiply(localMatrix(node));
  if (node.mesh !== undefined) meshNodes.push({ name: node.name, world });
  for (const c of node.children ?? []) walk(c, world);
};
for (const root of gltf.scenes[gltf.scene ?? 0].nodes) walk(root, new Matrix4());

if (meshNodes.length !== 1) throw new Error(`1 nœud maillé attendu, ${meshNodes.length} trouvé(s)`);
const { name, world } = meshNodes[0];

const t = new Vector3();
const q = new Quaternion();
const s = new Vector3();
world.decompose(t, q, s);

const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.scanTransform = {
  source: `${glbPath.replace(/^.*public/, '')} → nœud « ${name} »`,
  // Matrice 4×4 en colonnes (ordre glTF / Matrix4.fromArray).
  matrix: world.toArray().map((v) => Number(v.toPrecision(12))),
};
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

console.log(`scanTransform écrit depuis « ${name} »`);
console.log('  translation', t.toArray());
console.log('  rotation (quat)', q.toArray());
console.log('  échelle', s.toArray());
