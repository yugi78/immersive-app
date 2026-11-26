import type { ScenarioConfig } from './types';

/** Scénario par défaut d'un projet qui n'en décrit pas : prise en main directe en orbite. */
export const DEFAULT_SCENARIO: ScenarioConfig = {
  intro: { enabled: false, kind: 'sky', interruptible: true, durationMs: 4500, startHeightAboveGround: 200, startDistance: 350, sweepDeg: 70, points: [] },
  loop: { enabled: false, points: [] },
  control: {
    mode: 'orbit',
    start: { distance: 120, azimuthDeg: 200, elevationDeg: 25 },
    minDistance: 5,
    maxDistance: 600,
    dampingFactor: 0.08,
    groundMargin: 1.5,
    autoRotateSpeed: 0.4,
  },
  idle: { action: 'rotate', afterMs: 4000 },
  blendMs: 2500,
};

type Legacy = {
  scenario?: Partial<ScenarioConfig>;
  /** Ancien format (scene.json) : intro, orbite et vue de départ séparées. */
  intro?: { durationMs: number; startHeightAboveGround: number; startDistance: number; sweepDeg: number };
  orbit?: { minDistance: number; maxDistance: number; dampingFactor: number; autoRotateSpeed: number; autoRotateResumeDelayMs: number; groundMargin: number };
  camera?: { start?: ScenarioConfig['control']['start'] };
};

/** Scénario complet d'un projet : le sien, sinon converti de l'ancien format, sinon par défaut. */
export function normalizeScenario(raw: Legacy): ScenarioConfig {
  const d = DEFAULT_SCENARIO;
  if (raw.scenario) {
    const s = raw.scenario;
    return {
      intro: { ...d.intro, ...s.intro },
      loop: { ...d.loop, ...s.loop },
      control: { ...d.control, ...s.control, start: { ...d.control.start, ...s.control?.start } },
      idle: { ...d.idle, ...s.idle },
      blendMs: s.blendMs ?? d.blendMs,
    };
  }
  const { intro, orbit, camera } = raw;
  return {
    ...d,
    intro: intro ? { ...d.intro, ...intro, enabled: true, interruptible: false } : d.intro,
    control: {
      ...d.control,
      ...(orbit ? { minDistance: orbit.minDistance, maxDistance: orbit.maxDistance, dampingFactor: orbit.dampingFactor, groundMargin: orbit.groundMargin, autoRotateSpeed: orbit.autoRotateSpeed } : {}),
      start: camera?.start ?? d.control.start,
    },
    idle: { action: 'rotate', afterMs: orbit?.autoRotateResumeDelayMs ?? d.idle.afterMs },
  };
}
