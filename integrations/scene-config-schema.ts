/**
 * Validation des réglages envoyés par le back-office Puck (POST /__admin/scene-config).
 *
 * Ce module est chargé par le serveur de dev via Vite (ssrLoadModule) à chaque
 * requête : une modification ici est prise en compte sans redémarrer `astro dev`.
 * Pour exposer un nouveau réglage dans Puck, ajouter sa clé ci-dessous.
 */

const NUMBER_KEYS = {
  focus: ['heightOffset', 'offsetX', 'offsetZ'],
  cutaway: ['transitFade'],
  mist: ['startDistance', 'endDistance'],
  clay: ['hue', 'saturation', 'contrast', 'brightness', 'gamma'],
  scanGrade: ['saturation', 'contrast', 'shadows', 'highlights'],
  dof: ['focusDistance', 'focusRange', 'aperture', 'maxBlur'],
  tour: ['cutFadeStart', 'resumeDelayMs', 'cubeResumeMs', 'loopSpeed', 'hotspotIntervalMs'],
} as const;

/** Cases à cocher, par section. */
const BOOL_KEYS = {
  dof: ['enabled', 'autoFocus'],
  tour: ['viaHub'],
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
        const kind = str(w.kind ?? 'wall', `${p}.kind`, /^(plan|wall|ceiling)$/);
        return { name: str(w.name ?? '', `${p}.name`), kind, center: vec3(w.center, `${p}.center`), yaw: num(w.yaw, `${p}.yaw`), width, height };
      }),
    };
  },
};

// Scénario d'ouverture : intro, boucle d'attente, prise en main, inactivité.
const scenarioPoints = (v: unknown, n: string) => {
  if (!Array.isArray(v)) throw new Error(`${n} doit être une liste`);
  if (v.length > 64) throw new Error(`${n} : 64 points au plus`);
  return v.map((x, i) => {
    const q = (x ?? {}) as Record<string, unknown>;
    const p = `${n}[${i}]`;
    const durationMs = num(q.durationMs, `${p}.durationMs`);
    if (durationMs < 0) throw new Error(`${p}.durationMs doit être positif`);
    return { position: vec3(q.position, `${p}.position`), target: vec3(q.target, `${p}.target`), durationMs };
  });
};
const bool = (v: unknown, n: string) => {
  if (typeof v !== 'boolean') throw new Error(`${n} doit être vrai/faux`);
  return v;
};
const positive = (v: unknown, n: string) => {
  const x = num(v, n);
  if (x < 0) throw new Error(`${n} doit être positif`);
  return x;
};
// Scénario : accueil (intro, boucle d'attente, premier mode), modes, passages.
const cutIds = (v: unknown, n: string) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 8) throw new Error(`${n} doit être une liste`);
  return v.map((x, i) => str(x, `${n}[${i}]`, /^[\w-]{1,40}$/));
};
const waypoints = (v: unknown, n: string) => {
  const w = v ?? [];
  if (!Array.isArray(w) || w.length > 64) throw new Error(`${n} : liste de 64 points au plus`);
  return w.map((p, i) => vec3(p, `${n}[${i}]`));
};
const lookOf = (v: unknown, n: string) => (v == null ? null : vec3(v, n));
const passage = (v: unknown, n: string) => {
  const q = (v ?? {}) as Record<string, unknown>;
  return {
    kind: str(q.kind ?? 'direct', `${n}.kind`, /^(direct|path)$/),
    durationMs: positive(q.durationMs ?? 4000, `${n}.durationMs`),
    waypoints: waypoints(q.waypoints, `${n}.waypoints`),
    look: lookOf(q.look, `${n}.look`),
    cut: cutIds(q.cut, `${n}.cut`),
  };
};
OBJECT_KEYS.scenario = {
  intro: (v, n) => {
    const q = (v ?? {}) as Record<string, unknown>;
    return {
      enabled: bool(q.enabled, `${n}.enabled`),
      style: str(q.style, `${n}.style`, /^(sky|points)$/),
      durationMs: positive(q.durationMs, `${n}.durationMs`),
      startHeightAboveGround: num(q.startHeightAboveGround, `${n}.startHeightAboveGround`),
      startDistance: positive(q.startDistance, `${n}.startDistance`),
      sweepDeg: num(q.sweepDeg, `${n}.sweepDeg`),
      waypoints: waypoints(q.waypoints, `${n}.waypoints`),
      look: lookOf(q.look, `${n}.look`),
      cut: cutIds(q.cut, `${n}.cut`),
      interruptible: bool(q.interruptible ?? false, `${n}.interruptible`),
      endAtNext: bool(q.endAtNext ?? true, `${n}.endAtNext`),
    };
  },
  loop: (v, n) => {
    const q = (v ?? {}) as Record<string, unknown>;
    return { enabled: bool(q.enabled, `${n}.enabled`), points: scenarioPoints(q.points ?? [], `${n}.points`), cut: cutIds(q.cut, `${n}.cut`) };
  },
  firstMode: (v, n) => str(v, n, /^(orbit|tour)$/),
  orbit: (v, n) => {
    const q = (v ?? {}) as Record<string, unknown>;
    const st = (q.start ?? {}) as Record<string, unknown>;
    const idle = (q.idle ?? {}) as Record<string, unknown>;
    const minDistance = positive(q.minDistance, `${n}.minDistance`);
    const maxDistance = positive(q.maxDistance, `${n}.maxDistance`);
    if (maxDistance < minDistance) throw new Error(`${n} : distance max inférieure à la distance min`);
    return {
      start: {
        distance: positive(st.distance, `${n}.start.distance`),
        azimuthDeg: num(st.azimuthDeg, `${n}.start.azimuthDeg`),
        elevationDeg: num(st.elevationDeg, `${n}.start.elevationDeg`),
      },
      minDistance,
      maxDistance,
      dampingFactor: positive(q.dampingFactor, `${n}.dampingFactor`),
      groundMargin: num(q.groundMargin, `${n}.groundMargin`),
      autoRotateSpeed: num(q.autoRotateSpeed, `${n}.autoRotateSpeed`),
      idle: { action: str(idle.action, `${n}.idle.action`, /^(none|rotate|loop)$/), afterMs: positive(idle.afterMs, `${n}.idle.afterMs`) },
      cut: cutIds(q.cut, `${n}.cut`),
    };
  },
  tour: (v, n) => ({ startWork: Math.max(0, Math.floor(num((v as { startWork?: unknown })?.startWork ?? 0, `${n}.startWork`))) }),
  passages: (v, n) => {
    const q = (v ?? {}) as Record<string, unknown>;
    return { 'orbit>tour': passage(q['orbit>tour'], `${n}.orbit>tour`), 'tour>orbit': passage(q['tour>orbit'], `${n}.tour>orbit`) };
  },
  blend: (v, n) => {
    const q = (v ?? {}) as Record<string, unknown>;
    return { durationMs: positive(q.durationMs, `${n}.durationMs`), cut: cutIds(q.cut, `${n}.cut`) };
  },
};

// Découpes : formes nommées et découpe de chaque moment.
const CUT_MOMENTS = ['work', 'transit'] as const;
OBJECT_KEYS.cutaway = {
  presets: (v, n) => {
    if (!Array.isArray(v)) throw new Error(`${n} doit être une liste`);
    if (v.length > 32) throw new Error(`${n} : 32 découpes au plus`);
    const ids = new Set<string>();
    return v.map((x, i) => {
      const q = (x ?? {}) as Record<string, unknown>;
      const p = `${n}[${i}]`;
      const id = str(q.id, `${p}.id`, /^[\w-]{1,40}$/);
      if (ids.has(id)) throw new Error(`${p}.id en double : ${id}`);
      ids.add(id);
      return {
        id,
        name: str(q.name ?? '', `${p}.name`),
        kind: str(q.kind, `${p}.kind`, /^(cylinder|sphere)$/),
        radius: positive(q.radius, `${p}.radius`),
        feather: positive(q.feather, `${p}.feather`),
        fadeStartDistance: positive(q.fadeStartDistance, `${p}.fadeStartDistance`),
        fadeEndDistance: positive(q.fadeEndDistance, `${p}.fadeEndDistance`),
        cameraRadius: positive(q.cameraRadius, `${p}.cameraRadius`),
      };
    });
  },
  use: (v, n) => {
    const m = (v ?? {}) as Record<string, unknown>;
    return Object.fromEntries(CUT_MOMENTS.map((k) => [k, str(m[k] ?? '', `${n}.${k}`, /^[\w-]{0,40}$/)]));
  },
};

// Écran de démarrage.
OBJECT_KEYS.start = {
  enabled: bool,
  title: (v, n) => str(v, n),
  description: (v, n) => str(v, n),
  image: (v, n) => str(v, n),
  button: (v, n) => str(v, n),
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
