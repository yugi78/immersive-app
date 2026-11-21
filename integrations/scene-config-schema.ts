/**
 * Validation des réglages envoyés par le back-office Puck (POST /__admin/scene-config).
 *
 * Ce module est chargé par le serveur de dev via Vite (ssrLoadModule) à chaque
 * requête : une modification ici est prise en compte sans redémarrer `astro dev`.
 * Pour exposer un nouveau réglage dans Puck, ajouter sa clé ci-dessous.
 */

const NUMBER_KEYS = {
  focus: ['heightOffset'],
  cutaway: ['radius', 'feather', 'fadeStartDistance', 'fadeEndDistance'],
  mist: ['startDistance', 'endDistance'],
  clay: ['hue', 'saturation', 'contrast', 'brightness', 'gamma'],
  dof: ['focusDistance', 'focusRange', 'aperture', 'maxBlur'],
} as const;

/** Cases à cocher, par section. */
const BOOL_KEYS = {
  dof: ['enabled', 'autoFocus'],
} as const;

/** Couleurs #rrggbb autorisées, par section. */
const COLOR_KEYS = {
  cutaway: ['cutColor'],
  mist: ['color'],
} as const;

export type Patch = Record<string, Record<string, unknown>>;

type Check = (v: unknown, name: string) => unknown;
const RULES: [Record<string, readonly string[]>, Check][] = [
  [NUMBER_KEYS, (v, n) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${n} doit être un nombre`);
    return v;
  }],
  [BOOL_KEYS, (v, n) => {
    if (typeof v !== 'boolean') throw new Error(`${n} doit être vrai/faux`);
    return v;
  }],
  [COLOR_KEYS, (v, n) => {
    if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${n} doit être #rrggbb`);
    return v;
  }],
];

/** Ne garde que les clés autorisées, avec des valeurs valides. */
export function sanitize(body: unknown): Patch {
  if (!body || typeof body !== 'object') throw new Error('Corps JSON attendu');
  const src = body as Patch;
  // Une section ou une clé inconnue est une erreur visible dans Puck, jamais ignorée en silence.
  for (const [section, values] of Object.entries(src)) {
    for (const key of Object.keys(values ?? {})) {
      if (!RULES.some(([keys]) => keys[section]?.includes(key))) throw new Error(`Réglage inconnu : ${section}.${key}`);
    }
  }
  const out: Patch = {};
  for (const [keys, check] of RULES) {
    for (const [section, list] of Object.entries(keys)) {
      for (const key of list) {
        const v = src[section]?.[key];
        if (v !== undefined) (out[section] ??= {})[key] = check(v, `${section}.${key}`);
      }
    }
  }
  return out;
}
