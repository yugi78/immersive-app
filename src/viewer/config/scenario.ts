import type { ControlStep, LoopStep, PathStep, ScenarioConfig, ScenarioPoint, ScenarioStep, StepKind, TourStep, Vec3 } from './types';

/** Libellés des types d'étapes (back-office). */
export const STEP_KINDS: { kind: StepKind; label: string; hint: string }[] = [
  { kind: 'path', label: 'Trajet', hint: 'Joué une fois : arrivée du ciel ou point par point' },
  { kind: 'loop', label: 'Boucle d’attente', hint: 'Tourne en boucle jusqu’à ce que le visiteur touche' },
  { kind: 'control', label: 'Prise en main', hint: 'Le visiteur pilote la caméra (orbite)' },
  { kind: 'tour', label: 'Visite guidée', hint: 'Œuvre par œuvre ; sortie par le bouton du monument' },
];

export const newStepId = () => `e-${Math.random().toString(36).slice(2, 8)}`;

/** Nouvelle étape d'un type, avec des valeurs par défaut. */
export function newStep(kind: StepKind, id = newStepId(), name?: string): ScenarioStep {
  const base = { id, cut: [] as string[], arriveCut: [] as string[] };
  switch (kind) {
    case 'path':
      return {
        ...base,
        kind,
        name: name ?? 'Trajet',
        style: 'points',
        durationMs: 4500,
        startHeightAboveGround: 200,
        startDistance: 350,
        sweepDeg: 70,
        waypoints: [],
        look: null,
        endAtNext: true,
        interruptible: true,
        onEnd: '',
        onTouch: '',
      } satisfies PathStep;
    case 'loop':
      return { ...base, kind, name: name ?? 'Boucle d’attente', points: [], onTouch: '' } satisfies LoopStep;
    case 'control':
      return {
        ...base,
        kind,
        name: name ?? 'Prise en main',
        mode: 'orbit',
        start: { distance: 120, azimuthDeg: 200, elevationDeg: 25 },
        minDistance: 5,
        maxDistance: 600,
        dampingFactor: 0.08,
        groundMargin: 1.5,
        autoRotateSpeed: 0.4,
        idle: { action: 'rotate', afterMs: 4000, step: '' },
      } satisfies ControlStep;
    case 'tour':
      return { ...base, kind, name: name ?? 'Visite guidée', startWork: 0, exit: '' } satisfies TourStep;
  }
}

/** Scénario par défaut d'un projet qui n'en décrit pas : prise en main directe en orbite, visite guidée. */
export function defaultScenario(): ScenarioConfig {
  const orbit = newStep('control', 'orbite', 'Vue extérieure') as ControlStep;
  const tour = { ...(newStep('tour', 'visite') as TourStep), exit: 'orbite' };
  return { first: 'orbite', steps: [orbit, tour], blendMs: 2500 };
}

export const stepById = (s: ScenarioConfig, id: string) => s.steps.find((x) => x.id === id) ?? null;
/** Première prise en main du scénario (vue de départ du back-office, repli des liens vides). */
export const firstControl = (s: ScenarioConfig) => s.steps.find((x): x is ControlStep => x.kind === 'control') ?? null;
export const tourStepOf = (s: ScenarioConfig) => s.steps.find((x): x is TourStep => x.kind === 'tour') ?? null;

// ---- Conversion des anciens formats --------------------------------------------------

type V1 = {
  intro?: Partial<{
    enabled: boolean;
    kind: 'sky' | 'points';
    interruptible: boolean;
    durationMs: number;
    startHeightAboveGround: number;
    startDistance: number;
    sweepDeg: number;
    waypoints: Vec3[];
    look: Vec3 | null;
    endAtHome: boolean;
    points: { position: Vec3; target: Vec3 }[];
  }>;
  loop?: { enabled?: boolean; points?: ScenarioPoint[] };
  control?: Partial<Omit<ControlStep, 'idle' | 'kind'>>;
  idle?: { action?: 'none' | 'rotate' | 'loop'; afterMs?: number };
  blendMs?: number;
};

type Legacy = {
  scenario?: Partial<ScenarioConfig> & V1;
  /** Ancien format (scene.json) : intro, orbite et vue de départ séparées. */
  intro?: { durationMs: number; startHeightAboveGround: number; startDistance: number; sweepDeg: number };
  orbit?: { minDistance: number; maxDistance: number; dampingFactor: number; autoRotateSpeed: number; autoRotateResumeDelayMs: number; groundMargin: number };
  camera?: { start?: ControlStep['start'] };
  /** Ancienne attribution des découpes (intro, boucle, orbite) : reprise par les étapes. */
  cutaway?: { use?: Use };
};

const ids = (...v: (string | undefined)[]) => v.filter((x): x is string => !!x);
type Use = Partial<Record<'intro' | 'loop' | 'orbit' | 'transit', string>>;

/** Scénario v1 (intro / boucle / prise en main / inactivité figés) → étapes, à l'identique. */
function fromV1(v1: V1, use: Use = {}): ScenarioConfig {
  const transit = ids(use?.transit);
  const orbit = newStep('control', 'orbite', 'Vue extérieure') as ControlStep;
  const c = v1.control ?? {};
  Object.assign(orbit, {
    start: { ...orbit.start, ...c.start },
    minDistance: c.minDistance ?? orbit.minDistance,
    maxDistance: c.maxDistance ?? orbit.maxDistance,
    dampingFactor: c.dampingFactor ?? orbit.dampingFactor,
    groundMargin: c.groundMargin ?? orbit.groundMargin,
    autoRotateSpeed: c.autoRotateSpeed ?? orbit.autoRotateSpeed,
    cut: ids(use?.orbit),
    arriveCut: transit,
  });
  const steps: ScenarioStep[] = [];
  const loopOk = !!v1.loop?.enabled && (v1.loop.points?.length ?? 0) >= 3;
  const i = v1.intro ?? {};
  if (i.enabled) {
    const old = i.points;
    const p = newStep('path', 'intro', 'Intro') as PathStep;
    Object.assign(p, {
      style: i.kind ?? 'sky',
      durationMs: i.durationMs ?? p.durationMs,
      startHeightAboveGround: i.startHeightAboveGround ?? p.startHeightAboveGround,
      startDistance: i.startDistance ?? p.startDistance,
      sweepDeg: i.sweepDeg ?? p.sweepDeg,
      waypoints: i.waypoints ?? old?.map((x) => x.position) ?? [],
      look: i.look ?? old?.[0]?.target ?? null,
      endAtNext: i.endAtHome ?? !old?.length,
      interruptible: i.interruptible ?? false,
      onEnd: loopOk ? 'boucle' : 'orbite',
      onTouch: 'orbite',
      cut: ids(use?.intro),
      arriveCut: transit,
    });
    steps.push(p);
  }
  if (loopOk) {
    steps.push({ ...(newStep('loop', 'boucle', 'Boucle d’attente') as LoopStep), points: v1.loop!.points!, onTouch: 'orbite', cut: ids(use?.loop), arriveCut: transit });
  }
  const idle = v1.idle ?? {};
  orbit.idle = {
    action: idle.action === 'loop' ? (loopOk ? 'goto' : 'none') : (idle.action ?? 'rotate'),
    afterMs: idle.afterMs ?? 4000,
    step: idle.action === 'loop' && loopOk ? 'boucle' : '',
  };
  steps.push(orbit);
  steps.push({ ...(newStep('tour', 'visite', 'Visite guidée') as TourStep), exit: 'orbite' });
  return { first: steps[0].id, steps, blendMs: v1.blendMs ?? 2500 };
}

/** Scénario complet d'un projet : le sien (converti des anciens formats au besoin), sinon par défaut. */
export function normalizeScenario(raw: Legacy): ScenarioConfig {
  const use = raw.cutaway?.use ?? {};
  const s = raw.scenario;
  if (s && Array.isArray(s.steps)) {
    return { first: s.first ?? s.steps[0]?.id ?? '', steps: s.steps.map((x) => ({ ...newStep(x.kind, x.id, x.name), ...x }) as ScenarioStep), blendMs: s.blendMs ?? 2500 };
  }
  if (s) return fromV1(s, use);
  // Format le plus ancien : intro, orbite et vue de départ dans scene.json.
  const { intro, orbit, camera } = raw;
  return fromV1(
    {
      intro: intro ? { ...intro, enabled: true, kind: 'sky', interruptible: false } : undefined,
      control: {
        ...(orbit ? { minDistance: orbit.minDistance, maxDistance: orbit.maxDistance, dampingFactor: orbit.dampingFactor, groundMargin: orbit.groundMargin, autoRotateSpeed: orbit.autoRotateSpeed } : {}),
        start: camera?.start,
      },
      idle: { action: 'rotate', afterMs: orbit?.autoRotateResumeDelayMs ?? 4000 },
    },
    use,
  );
}

/** Le scénario par défaut est utilisé quand rien n'est décrit du tout. */
export const DEFAULT_SCENARIO = defaultScenario();
