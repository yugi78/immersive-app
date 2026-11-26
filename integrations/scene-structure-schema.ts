/**
 * Validation de la STRUCTURE de la scène (objets + matériaux de scene.json), envoyée
 * par l'administration complète (outliner, éditeur de matériaux). Serveur de dev
 * uniquement : la version en ligne (espace client) ne peut jamais l'écrire.
 */

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, n: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${n} : texte attendu`);
  return v.trim();
};
const num = (v: unknown, n: string) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${n} : nombre attendu`);
  return v;
};
const vec3 = (v: unknown, n: string) => {
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`${n} : [x, y, z] attendu`);
  return v.map((x, i) => num(x, `${n}[${i}]`)) as [number, number, number];
};
const bool = (v: unknown, n: string) => {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new Error(`${n} : vrai / faux attendu`);
  return v;
};
/** Copie sans les clés indéfinies (JSON propre). */
const clean = <T extends Json>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function material(v: unknown, n: string) {
  if (!isObj(v)) throw new Error(`${n} : objet attendu`);
  const grade = v.grade ?? null;
  if (grade !== null && grade !== 'clay' && grade !== 'scan') throw new Error(`${n}.grade : clay, scan ou aucun`);
  if (v.fill !== undefined && v.fill !== 'coupe') throw new Error(`${n}.fill : « coupe » ou absent`);
  return clean({
    unlit: bool(v.unlit, `${n}.unlit`),
    doubleSided: bool(v.doubleSided, `${n}.doubleSided`),
    cutaway: bool(v.cutaway, `${n}.cutaway`),
    fill: v.fill as 'coupe' | undefined,
    grade: grade ?? undefined,
    mist: bool(v.mist, `${n}.mist`),
  });
}

function mapFlags(v: unknown, n: string) {
  if (v === undefined) return undefined;
  if (!isObj(v)) throw new Error(`${n} : objet attendu`);
  const out = clean({ plan: bool(v.plan, `${n}.plan`), views: bool(v.views, `${n}.views`), minimap: bool(v.minimap, `${n}.minimap`) });
  return Object.keys(out).length ? out : undefined;
}

/** Valide { objects, materials } ; renvoie une copie propre, prête à écrire. */
export function sanitizeStructure(body: unknown) {
  if (!isObj(body)) throw new Error('Corps JSON attendu');
  if (!isObj(body.materials)) throw new Error('materials : objet attendu');
  if (!Array.isArray(body.objects) || !body.objects.length) throw new Error('objects : liste non vide attendue');

  const materials: Record<string, unknown> = {};
  for (const [key, m] of Object.entries(body.materials)) {
    if (!/^[\w-]{1,40}$/.test(key)) throw new Error(`Nom de matériau invalide : « ${key} » (lettres, chiffres, tirets)`);
    materials[key] = material(m, `materials.${key}`);
  }

  const ids = new Set<string>();
  let references = 0;
  const objects = body.objects.map((o: unknown, i: number) => {
    const n = `objects[${i}]`;
    if (!isObj(o)) throw new Error(`${n} : objet attendu`);
    const id = str(o.id, `${n}.id`);
    if (ids.has(id)) throw new Error(`Identifiant en double : ${id}`);
    ids.add(id);
    const mat = str(o.material, `${n}.material`);
    if (!(mat in materials)) throw new Error(`${id} : matériau inconnu « ${mat} »`);
    if (o.reference) references++;
    const common = {
      id,
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : undefined,
      material: mat,
      visible: o.visible === false ? false : undefined,
      reference: o.reference ? true : undefined,
      map: mapFlags(o.map, `${n}.map`),
      pick: o.pick ? true : undefined,
    };
    if (o.type === 'tiled') {
      // Ensemble tuilé : ses paramètres techniques (manifeste, matrice, LOD) sont repris tels quels.
      str(o.manifest, `${n}.manifest`);
      if (!Array.isArray(o.transform) || o.transform.length !== 16) throw new Error(`${n}.transform : matrice 4×4 attendue`);
      if (!isObj(o.lod)) throw new Error(`${n}.lod : objet attendu`);
      return clean({ ...common, type: 'tiled', manifest: o.manifest, transform: o.transform, lod: o.lod });
    }
    let transform: unknown;
    if (o.transform !== undefined) {
      if (!isObj(o.transform)) throw new Error(`${n}.transform : objet attendu`);
      transform = {
        position: vec3(o.transform.position, `${n}.transform.position`),
        rotation: vec3(o.transform.rotation, `${n}.transform.rotation`),
        scale: vec3(o.transform.scale, `${n}.transform.scale`),
      };
    }
    return clean({
      ...common,
      file: str(o.file, `${n}.file`),
      merge: o.merge ? true : o.merge === false ? false : undefined,
      optional: o.optional ? true : undefined,
      transform,
    });
  });
  if (references !== 1) throw new Error(`Il faut exactement un objet de référence (actuellement ${references})`);
  return { objects, materials };
}
