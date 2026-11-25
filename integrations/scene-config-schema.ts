/**
 * Validation des réglages envoyés par le back-office Puck (POST /__admin/scene-config).
 *
 * Ce module est chargé par le serveur de dev via Vite (ssrLoadModule) à chaque
 * requête : une modification ici est prise en compte sans redémarrer `astro dev`.
 * Pour exposer un nouveau réglage dans Puck, ajouter sa clé ci-dessous.
 */

const NUMBER_KEYS = {
  focus: ['heightOffset', 'offsetX', 'offsetZ'],
  cutaway: ['radius', 'feather', 'fadeStartDistance', 'fadeEndDistance', 'cameraRadius'],
  mist: ['startDistance', 'endDistance'],
  clay: ['hue', 'saturation', 'contrast', 'brightness', 'gamma'],
  scanGrade: ['saturation', 'contrast', 'shadows', 'highlights'],
  dof: ['focusDistance', 'focusRange', 'aperture', 'maxBlur'],
  tour: ['cutFadeStart', 'resumeDelayMs', 'cubeResumeMs', 'loopSpeed', 'hotspotIntervalMs'],
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

const num = (v: unknown, n: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${n} doit être un nombre`);
  return v;
};
const vec3 = (v: unknown, n: string): [number, number, number] => {
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`${n} doit être [x, y, z]`);
  return [num(v[0], `${n}.x`), num(v[1], `${n}.y`), num(v[2], `${n}.z`)];
};
const str = (v: unknown, n: string, re?: RegExp): string => {
  if (typeof v !== 'string' || (re && !re.test(v))) throw new Error(`${n} invalide`);
  return v;
};

/** Valeurs structurées (objets, listes), validées en entier. */
const OBJECT_KEYS: Record<string, Record<string, Check>> = {
  tour: {
    durations: (v, n) => {
      const d = (v ?? {}) as Record<string, unknown>;
      const keys = ['enterMs', 'betweenMs', 'exitMs'];
      const out: Record<string, number> = {};
      for (const k of keys) {
        out[k] = num(d[k], `${n}.${k}`);
        if (out[k] < 0) throw new Error(`${n}.${k} doit être positif`);
      }
      return out;
    },
    hub: (v, n) => ({ position: vec3((v as { position?: unknown })?.position, `${n}.position`) }),
    works: (v, n) => {
      if (!Array.isArray(v)) throw new Error(`${n} doit être une liste`);
      const ids = new Set<string>();
      const slugs = new Set<string>();
      return v.map((w, i) => {
        const p = `${n}[${i}]`;
        const id = str(w?.id, `${p}.id`, /^[\w-]{1,40}$/);
        const slug = str(w?.slug, `${p}.slug`, /^[a-z0-9]+(-[a-z0-9]+)*$/);
        if (ids.has(id)) throw new Error(`${p}.id en double : ${id}`);
        if (slugs.has(slug)) throw new Error(`${p}.slug en double : ${slug}`);
        ids.add(id);
        slugs.add(slug);
        if (!Array.isArray(w.cameraPoints)) throw new Error(`${p}.cameraPoints doit être une liste`);
        const content = w.content ?? {};
        if (typeof content !== 'object' || Array.isArray(content)) throw new Error(`${p}.content doit être un objet`);
        const blocks = Array.isArray(content.blocks) ? content.blocks : [];
        const cleanBlocks = blocks.map((b: Record<string, unknown>, j: number) => {
          const q = `${p}.content.blocks[${j}]`;
          if (b?.type === 'image') return { type: 'image', src: str(b.src ?? '', `${q}.src`), alt: str(b.alt ?? '', `${q}.alt`) };
          if (b?.type === 'text') return { type: 'text', html: str(b.html ?? '', `${q}.html`) };
          throw new Error(`${q}.type doit être text ou image`);
        });
        if (w.hotspots != null && !Array.isArray(w.hotspots)) throw new Error(`${p}.hotspots doit être une liste`);
        const hotspots = (w.hotspots ?? []).map((h: Record<string, unknown>, j: number) => ({
          id: str(h?.id, `${p}.hotspots[${j}].id`, /^[\w-]{1,40}$/),
          position: vec3(h?.position, `${p}.hotspots[${j}].position`),
          text: str(h?.text ?? '', `${p}.hotspots[${j}].text`),
        }));
        let bounds;
        if (w.bounds != null) {
          const size = vec3(w.bounds.size, `${p}.bounds.size`);
          if (size.some((v) => v <= 0)) throw new Error(`${p}.bounds.size doit être positif`);
          bounds = {
            center: vec3(w.bounds.center, `${p}.bounds.center`),
            size,
            rotationY: num(w.bounds.rotationY ?? 0, `${p}.bounds.rotationY`),
          };
        }
        return {
          id,
          title: str(w.title, `${p}.title`),
          author: str(w.author ?? '', `${p}.author`),
          thumbnail: str(w.thumbnail ?? '', `${p}.thumbnail`),
          slug,
          focus: vec3(w.focus, `${p}.focus`),
          cameraPoints: w.cameraPoints.map((c: unknown, j: number) => vec3(c, `${p}.cameraPoints[${j}]`)),
          ...(bounds ? { bounds } : {}),
          hotspots,
          content: { ...content, blocks: cleanBlocks },
        };
      });
    },
  },
};

// Interface publique : crédits (HTML du texte riche) et orientation de la mini-carte.
OBJECT_KEYS.ui = {
  aboutHtml: (v, n) => str(v, n),
  minimap: (v, n) => {
    const m = (v ?? {}) as Record<string, unknown>;
    const rot = (x: unknown, k: string) => {
      const d = num(x, `${n}.${k}`);
      if (d % 90 !== 0) throw new Error(`${n}.${k} doit être un multiple de 90`);
      return d;
    };
    return { rotationDesktop: rot(m.rotationDesktop, 'rotationDesktop'), rotationMobile: rot(m.rotationMobile, 'rotationMobile') };
  },
  // Carte interactive : textes, fond, rotation du plan, 4 vues de face.
  map: (v, n) => {
    const m = (v ?? {}) as Record<string, unknown>;
    if (!Array.isArray(m.views)) throw new Error(`${n}.views doit être une liste`);
    return {
      title: str(m.title ?? '', `${n}.title`),
      subtitle: str(m.subtitle ?? '', `${n}.subtitle`),
      hint: str(m.hint ?? '', `${n}.hint`),
      background: str(m.background, `${n}.background`, /^#[0-9a-f]{6}$/i),
      planRotationDesktop: num(m.planRotationDesktop, `${n}.planRotationDesktop`),
      planRotationMobile: num(m.planRotationMobile, `${n}.planRotationMobile`),
      views: m.views.map((x: unknown, i: number) => {
        const w = (x ?? {}) as Record<string, unknown>;
        const p = `${n}.views[${i}]`;
        const width = num(w.width, `${p}.width`);
        const height = num(w.height, `${p}.height`);
        if (width <= 0 || height <= 0) throw new Error(`${p} : cadre vide`);
        return { name: str(w.name ?? '', `${p}.name`), center: vec3(w.center, `${p}.center`), yaw: num(w.yaw, `${p}.yaw`), width, height };
      }),
    };
  },
};

export type Patch = Record<string, Record<string, unknown>>;

type Check = (v: unknown, name: string) => unknown;
const RULES: [Record<string, readonly string[]>, Check][] = [
  ...Object.entries(OBJECT_KEYS).flatMap(([section, checks]) =>
    Object.entries(checks).map(([key, check]): [Record<string, readonly string[]>, Check] => [{ [section]: [key] }, check]),
  ),
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
