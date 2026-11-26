import type { CutawayConfig, CutMoment, CutPreset } from './types';

export const CUT_MOMENTS: { id: CutMoment; label: string }[] = [
  { id: 'intro', label: 'Intro' },
  { id: 'loop', label: 'Boucle d’attente' },
  { id: 'orbit', label: 'Prise en main (orbite)' },
  { id: 'work', label: 'Sur une œuvre' },
  { id: 'transit', label: 'Transitions' },
];

/** Découpe par défaut d'un projet qui n'en décrit pas : aucune. */
export const DEFAULT_CUTAWAY: CutawayConfig = {
  cutColor: '#000000',
  presets: [],
  use: { intro: '', loop: '', orbit: '', work: '', transit: '' },
  transitFade: 0.2,
};

export const newCutPreset = (kind: CutPreset['kind'], name: string, id: string): CutPreset => ({
  id,
  name,
  kind,
  radius: kind === 'cylinder' ? 40 : 4,
  feather: kind === 'cylinder' ? 4 : 2,
  fadeStartDistance: 400,
  fadeEndDistance: 200,
  cameraRadius: kind === 'cylinder' ? 4 : 0,
});

type Legacy = Partial<CutawayConfig> & {
  radius?: number;
  feather?: number;
  fadeStartDistance?: number;
  fadeEndDistance?: number;
  cameraRadius?: number;
  transitRadius?: number;
  transitFeather?: number;
  workRadius?: number;
  workFeather?: number;
};

/**
 * Découpe complète d'un projet. Ancien format (un cylindre « extérieur », une sphère
 * de transition, une sphère sur les œuvres, réglés à part) converti à l'identique.
 */
export function normalizeCutaway(raw: Legacy | undefined): CutawayConfig {
  const d = DEFAULT_CUTAWAY;
  if (!raw) return structuredClone(d);
  if (Array.isArray(raw.presets)) {
    return {
      cutColor: raw.cutColor ?? d.cutColor,
      presets: raw.presets,
      use: { ...d.use, ...raw.use },
      transitFade: raw.transitFade ?? d.transitFade,
    };
  }
  const presets: CutPreset[] = [
    {
      id: 'exterieur',
      name: 'Vue extérieure',
      kind: 'cylinder',
      radius: raw.radius ?? 80,
      feather: raw.feather ?? 4,
      fadeStartDistance: raw.fadeStartDistance ?? 400,
      fadeEndDistance: raw.fadeEndDistance ?? 210,
      cameraRadius: raw.cameraRadius ?? 4,
    },
    { ...newCutPreset('sphere', 'Transition', 'transition'), radius: raw.transitRadius ?? 8, feather: raw.transitFeather ?? 3 },
  ];
  const workRadius = raw.workRadius ?? 2;
  if (workRadius > 0) presets.push({ ...newCutPreset('sphere', 'Sur l’œuvre', 'oeuvre'), radius: workRadius, feather: raw.workFeather ?? 1 });
  return {
    cutColor: raw.cutColor ?? d.cutColor,
    presets,
    use: { intro: 'exterieur', loop: 'exterieur', orbit: 'exterieur', work: workRadius > 0 ? 'oeuvre' : '', transit: 'transition' },
    transitFade: raw.transitFade ?? d.transitFade,
  };
}

/** Découpe attribuée à un moment (null : aucune). */
export const cutFor = (cfg: CutawayConfig, moment: CutMoment): CutPreset | null =>
  cfg.presets.find((p) => p.id === cfg.use[moment]) ?? null;
