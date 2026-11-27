import type { IntroConfig, ModeId, OrbitMode, Passage, PassageId, ScenarioConfig, ScenarioPoint, Vec3 } from './types';

/** Modes de l'expérience (libellés du back-office). */
export const MODES: { id: ModeId | 'walk'; label: string; hint: string; soon?: boolean }[] = [
  { id: 'orbit', label: 'Vue extérieure', hint: 'Orbite autour du bâtiment' },
  { id: 'tour', label: 'Visite guidée', hint: 'Œuvre par œuvre' },
  { id: 'walk', label: 'Visite à pied', hint: 'Bientôt', soon: true },
];
export const modeLabel = (id: ModeId) => MODES.find((m) => m.id === id)?.label ?? id;

/** Passages entre modes (dans cet ordre dans le back-office). */
export const PASSAGES: { id: PassageId; from: ModeId; to: ModeId; hint: string }[] = [
  { id: 'orbit>tour', from: 'orbit', to: 'tour', hint: 'Bouton « Visite guidée », clic sur une œuvre' },
  { id: 'tour>orbit', from: 'tour', to: 'orbit', hint: 'Bouton du monument (sortie de la visite)' },
];

export const newPassage = (): Passage => ({ kind: 'direct', durationMs: 4000, waypoints: [], look: null, cut: [], cutFade: {} });

/** Fondu par défaut d'une forme sur un trajet (part du trajet). */
export const DEFAULT_FADE = 0.2;
/** Entrée / sortie de la visite : la découpe s'efface entre ces points du trajet d'entrée. */
export const DEFAULT_EDGE_RANGE: [number, number] = [0.96, 1];

export function defaultScenario(): ScenarioConfig {
  return {
    intro: {
      enabled: false,
      style: 'sky',
      durationMs: 4500,
      startHeightAboveGround: 200,
      startDistance: 350,
      sweepDeg: 70,
      waypoints: [],
      look: null,
      cut: [],
      interruptible: true,
      endAtNext: true,
    },
    loop: { enabled: false, points: [], cut: [] },
    firstMode: 'orbit',
    orbit: {
      start: { distance: 120, azimuthDeg: 200, elevationDeg: 25 },
      minDistance: 5,
      maxDistance: 600,
      dampingFactor: 0.08,
      groundMargin: 1.5,
      autoRotateSpeed: 0.4,
      idle: { action: 'rotate', afterMs: 4000 },
      cut: [],
    },
    tour: { startWork: 0, workCut: [], transitCut: [], transitFade: {}, edgeRange: {} },
    passages: { 'orbit>tour': newPassage(), 'tour>orbit': newPassage() },
    blend: { durationMs: 2500, cut: [], cutFade: {} },
  };
}

// ---- Conversion des anciens formats --------------------------------------------------

type Use = Partial<Record<'intro' | 'loop' | 'orbit' | 'transit', string>>;
const ids = (...v: (string | undefined)[]) => v.filter((x): x is string => !!x);

/** Format « étapes reliées » (v2). */
type V2 = {
  first?: string;
  blendMs?: number;
  steps: ({ id: string; kind: string; cut?: string[]; arriveCut?: string[] } & Record<string, unknown>)[];
};
/** Format « intro / boucle / prise en main / inactivité » (v1). */
type V1 = {
  intro?: Record<string, unknown> & { points?: { position: Vec3; target: Vec3 }[] };
  loop?: { enabled?: boolean; points?: ScenarioPoint[] };
  control?: Partial<OrbitMode>;
  idle?: { action?: 'none' | 'rotate' | 'loop'; afterMs?: number };
  blendMs?: number;
};

type Legacy = {
  scenario?: Partial<ScenarioConfig> & Partial<V2> & V1;
  intro?: { durationMs: number; startHeightAboveGround: number; startDistance: number; sweepDeg: number };
  orbit?: { minDistance: number; maxDistance: number; dampingFactor: number; autoRotateSpeed: number; autoRotateResumeDelayMs: number; groundMargin: number };
  camera?: { start?: OrbitMode['start'] };
  cutaway?: { use?: Use & { work?: string }; transitFade?: number };
  /** Ancien réglage de la visite : début de l'extinction de la découpe à l'entrée (0–1). */
  tour?: { cutFadeStart?: number };
};

/** Fondu de chaque forme d'une liste (valeur commune). */
const fadeFor = (ids: string[], f: number) => Object.fromEntries(ids.map((id) => [id, f]));

/**
 * Découpes de la visite et fondus : repris de l'ancien format (cutaway.use, transitFade,
 * tour.cutFadeStart) quand le scénario ne les décrit pas encore.
 */
function withCuts(s: ScenarioConfig, raw: Legacy): ScenarioConfig {
  const use = raw.cutaway?.use ?? {};
  const fade = raw.cutaway?.transitFade ?? DEFAULT_FADE;
  const edgeStart = raw.tour?.cutFadeStart !== undefined ? Math.min(Math.max(raw.tour.cutFadeStart, 0), 0.99) : DEFAULT_EDGE_RANGE[0];
  const t = (raw.scenario?.tour ?? {}) as Partial<ScenarioConfig['tour']> & { edgeFade?: Record<string, number> };
  // Ancien réglage (part du trajet avant l'arrivée) → plage [1 - part, 1].
  const oldEdge = Object.fromEntries(Object.entries(t.edgeFade ?? {}).map(([k, f]) => [k, [1 - f, 1] as [number, number]]));
  const transitCut = t.transitCut ?? ids(use.transit);
  const b = (raw.scenario?.blend ?? {}) as Partial<ScenarioConfig['blend']>;
  const passages = Object.fromEntries(
    (Object.keys(s.passages) as (keyof ScenarioConfig['passages'])[]).map((k) => {
      const p = s.passages[k];
      return [k, { ...p, cutFade: { ...fadeFor(p.cut, fade), ...p.cutFade } }];
    }),
  ) as ScenarioConfig['passages'];
  return {
    ...s,
    tour: {
      startWork: s.tour.startWork ?? 0,
      workCut: t.workCut ?? ids(use.work),
      transitCut,
      transitFade: { ...fadeFor(transitCut, fade), ...t.transitFade },
      edgeRange: { ...Object.fromEntries(s.orbit.cut.map((id) => [id, [edgeStart, 1] as [number, number]])), ...oldEdge, ...t.edgeRange },
    },
    blend: { ...s.blend, cutFade: { ...fadeFor(s.blend.cut, fade), ...b.cutFade } },
    passages,
  };
}

const pickOrbit = (o: Partial<OrbitMode> | Record<string, unknown>, d: OrbitMode): Omit<OrbitMode, 'idle' | 'cut'> => {
  const x = o as Partial<OrbitMode>;
  return {
    start: { ...d.start, ...x.start },
    minDistance: x.minDistance ?? d.minDistance,
    maxDistance: x.maxDistance ?? d.maxDistance,
    dampingFactor: x.dampingFactor ?? d.dampingFactor,
    groundMargin: x.groundMargin ?? d.groundMargin,
    autoRotateSpeed: x.autoRotateSpeed ?? d.autoRotateSpeed,
  };
};

function fromV2(v: V2): ScenarioConfig {
  const d = defaultScenario();
  const byId = (id: unknown) => v.steps.find((s) => s.id === id);
  const path = v.steps.find((s) => s.kind === 'path');
  const loop = v.steps.find((s) => s.kind === 'loop');
  const control = v.steps.find((s) => s.kind === 'control');
  const tour = v.steps.find((s) => s.kind === 'tour');
  const first = byId(v.first);
  const intro: IntroConfig = path
    ? {
        ...d.intro,
        ...(path as Partial<IntroConfig>),
        enabled: first?.id === path.id,
        cut: path.cut ?? [],
      }
    : d.intro;
  const loopPoints = (loop?.points as ScenarioPoint[] | undefined) ?? [];
  // Premier mode : celui où mène l'intro (ou la première étape).
  const after = first?.kind === 'path' ? byId(first.onEnd) : first?.kind === 'loop' ? byId(first.onTouch) : first;
  const idle = (control?.idle as { action?: string; afterMs?: number } | undefined) ?? {};
  return {
    intro,
    loop: { enabled: !!loop && loopPoints.length >= 3 && (first?.id === loop.id || byId(intro.enabled ? path?.onEnd : '')?.id === loop.id), points: loopPoints, cut: loop?.cut ?? [] },
    firstMode: after?.kind === 'tour' ? 'tour' : 'orbit',
    orbit: control
      ? {
          ...pickOrbit(control, d.orbit),
          idle: { action: idle.action === 'goto' ? 'loop' : idle.action === 'none' ? 'none' : 'rotate', afterMs: idle.afterMs ?? 4000 },
          cut: control.cut ?? [],
        }
      : d.orbit,
    tour: { ...defaultScenario().tour, startWork: (tour?.startWork as number | undefined) ?? 0 },
    passages: { 'orbit>tour': newPassage(), 'tour>orbit': newPassage() },
    blend: { durationMs: v.blendMs ?? 2500, cut: control?.arriveCut ?? [], cutFade: {} },
  };
}

function fromV1(v1: V1, use: Use): ScenarioConfig {
  const d = defaultScenario();
  const i = v1.intro ?? {};
  const old = i.points;
  const loopOk = !!v1.loop?.enabled && (v1.loop.points?.length ?? 0) >= 3;
  return {
    intro: {
      ...d.intro,
      enabled: !!i.enabled,
      style: (i.kind as IntroConfig['style']) ?? 'sky',
      durationMs: (i.durationMs as number) ?? d.intro.durationMs,
      startHeightAboveGround: (i.startHeightAboveGround as number) ?? d.intro.startHeightAboveGround,
      startDistance: (i.startDistance as number) ?? d.intro.startDistance,
      sweepDeg: (i.sweepDeg as number) ?? d.intro.sweepDeg,
      waypoints: (i.waypoints as Vec3[]) ?? old?.map((x) => x.position) ?? [],
      look: (i.look as Vec3 | null) ?? old?.[0]?.target ?? null,
      endAtNext: (i.endAtHome as boolean) ?? !old?.length,
      interruptible: (i.interruptible as boolean) ?? false,
      cut: ids(use.intro),
    },
    loop: { enabled: loopOk, points: v1.loop?.points ?? [], cut: ids(use.loop) },
    firstMode: 'orbit',
    orbit: {
      ...pickOrbit(v1.control ?? {}, d.orbit),
      idle: { action: v1.idle?.action === 'loop' ? (loopOk ? 'loop' : 'none') : (v1.idle?.action ?? 'rotate'), afterMs: v1.idle?.afterMs ?? 4000 },
      cut: ids(use.orbit),
    },
    tour: defaultScenario().tour,
    passages: { 'orbit>tour': newPassage(), 'tour>orbit': newPassage() },
    blend: { durationMs: v1.blendMs ?? 2500, cut: ids(use.transit), cutFade: {} },
  };
}

/** Scénario complet d'un projet : le sien (converti des anciens formats au besoin), sinon par défaut. */
export function normalizeScenario(raw: Legacy): ScenarioConfig {
  return withCuts(normalizeBase(raw), raw);
}

function normalizeBase(raw: Legacy): ScenarioConfig {
  const d = defaultScenario();
  const s = raw.scenario;
  if (s && s.orbit && s.passages) {
    const c = s as ScenarioConfig;
    return {
      intro: { ...d.intro, ...c.intro },
      loop: { ...d.loop, ...c.loop },
      firstMode: c.firstMode ?? 'orbit',
      orbit: { ...d.orbit, ...c.orbit, start: { ...d.orbit.start, ...c.orbit.start }, idle: { ...d.orbit.idle, ...c.orbit.idle } },
      tour: { ...d.tour, ...c.tour },
      passages: { 'orbit>tour': { ...newPassage(), ...c.passages['orbit>tour'] }, 'tour>orbit': { ...newPassage(), ...c.passages['tour>orbit'] } },
      blend: { ...d.blend, ...c.blend },
    };
  }
  if (s && Array.isArray(s.steps)) return fromV2(s as V2);
  const use = raw.cutaway?.use ?? {};
  if (s) return fromV1(s, use);
  // Format le plus ancien : intro, orbite et vue de départ dans scene.json.
  const { intro, orbit, camera } = raw;
  return fromV1(
    {
      intro: intro ? { ...intro, enabled: true, kind: 'sky', interruptible: false } : undefined,
      control: {
        ...(orbit ? { minDistance: orbit.minDistance, maxDistance: orbit.maxDistance, dampingFactor: orbit.dampingFactor, groundMargin: orbit.groundMargin, autoRotateSpeed: orbit.autoRotateSpeed } : {}),
        ...(camera?.start ? { start: camera.start } : {}),
      },
      idle: { action: 'rotate', afterMs: orbit?.autoRotateResumeDelayMs ?? 4000 },
    },
    use,
  );
}
