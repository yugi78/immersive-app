/**
 * Design de l'interface publique (content.json → design), en trois niveaux :
 *
 *   STYLES      couleurs et arrondis nommés (« Noir », « Bouton »…), partagés partout
 *   COMPOSANTS  modèles réutilisés (bouton sombre, bandeau…) : fond, texte/icône,
 *               arrondi → des styles ; changer un style change tous ses composants
 *   ÉLÉMENTS    chaque élément réel de l'interface (data-ui) : son composant, son texte
 *
 * Rendu : des variables CSS (--pv-c-<couleur>, --pv-r-<arrondi>, --cmp-*) injectées
 * dans la page ; sans réglage, l'interface est identique à sa version d'origine.
 */

export interface DesignColor {
  id: string;
  name: string;
  /** #rrggbb */
  value: string;
}
export interface DesignRadius {
  id: string;
  name: string;
  /** px ; 999 : pilule (bords entièrement arrondis). */
  value: number;
}
export type ComponentKind = 'button' | 'panel' | 'thumb';
export interface DesignComponent {
  name: string;
  kind: ComponentKind;
  /** Couleur de fond (id), ou '' : aucune. */
  bg: string;
  /** Couleur du texte et des icônes (id). */
  fg: string;
  /** Arrondi (id). */
  radius: string;
}
export interface DesignElement {
  /** Composant (id) ; absent : celui d'origine. */
  component?: string;
  /** Texte affiché ; absent : celui d'origine. */
  label?: string;
}
export interface DesignConfig {
  colors: DesignColor[];
  radii: DesignRadius[];
  components: Record<string, DesignComponent>;
  elements: Record<string, DesignElement>;
}

/** Éléments réglables de l'interface publique (data-ui dans le DOM). */
export const UI_ELEMENTS: { id: string; name: string; kind: ComponentKind; component: string; label?: string; hint?: string }[] = [
  { id: 'go', name: 'Bouton « Visite guidée »', kind: 'button', component: 'bouton-sombre', label: 'Visite guidée', hint: 'Barre de la vue extérieure' },
  { id: 'map', name: 'Bouton carte', kind: 'button', component: 'bouton-sombre' },
  { id: 'collection', name: 'Bouton collection', kind: 'button', component: 'bouton-sombre', label: 'Collection' },
  { id: 'home', name: 'Bouton de sortie (monument)', kind: 'button', component: 'bouton-sombre', hint: 'Retour à la vue extérieure' },
  { id: 'share', name: 'Bouton « Partager »', kind: 'button', component: 'bouton-sombre', label: 'Partager' },
  { id: 'pause', name: 'Bouton pause', kind: 'button', component: 'bouton-clair' },
  { id: 'orbit', name: 'Bouton orbite libre (cube)', kind: 'button', component: 'bouton-sombre' },
  { id: 'resume', name: 'Bouton reprendre la visite', kind: 'button', component: 'bouton-clair' },
  { id: 'more', name: 'Bouton « Découvrir »', kind: 'button', component: 'bouton-clair', label: 'Découvrir' },
  { id: 'close', name: 'Boutons fermer', kind: 'button', component: 'bouton-clair' },
  { id: 'arrows', name: 'Flèches œuvre précédente / suivante', kind: 'button', component: 'texte' },
  { id: 'about', name: 'Lien « à propos »', kind: 'button', component: 'texte', label: 'à propos' },
  { id: 'strip', name: 'Bandeau des œuvres', kind: 'panel', component: 'bandeau' },
  { id: 'thumb', name: 'Vignettes du bandeau', kind: 'thumb', component: 'vignette' },
  { id: 'mapcard', name: 'Encart d’une œuvre (carte)', kind: 'panel', component: 'encart' },
  { id: 'mapgo', name: 'Bouton « Voir l’œuvre » (carte)', kind: 'button', component: 'bouton-clair', label: 'Voir l’œuvre' },
  { id: 'mapback', name: 'Bouton « Lancer / Retour à la visite » (carte)', kind: 'button', component: 'bouton-sombre' },
];

export const DEFAULT_DESIGN: DesignConfig = {
  colors: [
    { id: 'noir', name: 'Noir', value: '#000000' },
    { id: 'blanc', name: 'Blanc', value: '#ffffff' },
  ],
  radii: [
    { id: 'bouton', name: 'Bouton', value: 999 },
    { id: 'carte', name: 'Carte', value: 14 },
    { id: 'bandeau', name: 'Bandeau', value: 12 },
    { id: 'petit', name: 'Petit', value: 9 },
  ],
  components: {
    'bouton-sombre': { name: 'Bouton sombre', kind: 'button', bg: 'noir', fg: 'blanc', radius: 'bouton' },
    'bouton-clair': { name: 'Bouton clair', kind: 'button', bg: 'blanc', fg: 'noir', radius: 'bouton' },
    texte: { name: 'Lien texte', kind: 'button', bg: '', fg: 'blanc', radius: 'bouton' },
    bandeau: { name: 'Bandeau', kind: 'panel', bg: 'noir', fg: 'blanc', radius: 'bandeau' },
    encart: { name: 'Encart', kind: 'panel', bg: 'noir', fg: 'blanc', radius: 'carte' },
    vignette: { name: 'Vignette', kind: 'thumb', bg: '', fg: 'blanc', radius: 'petit' },
  },
  elements: {},
};

/** Design complet : celui du projet complété par les valeurs d'origine. */
export function normalizeDesign(raw: Partial<DesignConfig> | undefined): DesignConfig {
  const d = DEFAULT_DESIGN;
  const colors = raw?.colors?.length ? raw.colors : d.colors;
  const radii = raw?.radii?.length ? raw.radii : d.radii;
  return {
    // Les styles d'origine sont toujours présents (les composants y pointent).
    colors: [...colors, ...d.colors.filter((c) => !colors.some((x) => x.id === c.id))],
    radii: [...radii, ...d.radii.filter((r) => !radii.some((x) => x.id === r.id))],
    components: { ...structuredClone(d.components), ...raw?.components },
    elements: { ...raw?.elements },
  };
}

const safeId = (id: string) => id.replace(/[^\w-]/g, '');

/** Feuille de style générée : variables des styles, puis des composants. */
export function designCss(d: DesignConfig, scope = '.pv-ui, .pv-splash') {
  const vars = [
    ...d.colors.map((c) => `--pv-c-${safeId(c.id)}: ${/^#[0-9a-f]{6}$/i.test(c.value) ? c.value : '#000000'};`),
    ...d.radii.map((r) => `--pv-r-${safeId(r.id)}: ${Math.max(0, Number(r.value) || 0)}px;`),
  ].join(' ');
  const col = (id: string) => (id ? `var(--pv-c-${safeId(id)})` : 'initial');
  const rad = (id: string) => (id ? `var(--pv-r-${safeId(id)})` : 'initial');
  const comps = Object.entries(d.components)
    .map(([id, c]) => `.pv-ui [data-cmp="${safeId(id)}"] { --cmp-bg: ${c.bg ? col(c.bg) : 'transparent'}; --cmp-fg: ${col(c.fg)}; --cmp-r: ${rad(c.radius)}; }`)
    .join('\n');
  return `${scope} { ${vars} }\n${comps}`;
}

/** Composant d'un élément (choisi, sinon d'origine). */
export const componentOf = (d: DesignConfig, elementId: string) =>
  d.elements[elementId]?.component ?? UI_ELEMENTS.find((e) => e.id === elementId)?.component ?? '';

/** Où trouver chaque élément dans l'interface publique (sélecteurs CSS). */
export const UI_SELECTORS: Record<string, string> = {
  go: '.pv-start__go',
  map: '.pv-start__icon[data-act="map"], .pv-row [data-act="map"]',
  collection: '.pv-start__icon[data-act="collection"], .pv-coll',
  home: '[data-act="stop"], [data-map="home"]',
  share: '.pv-share',
  pause: '.pv-pause',
  orbit: '.pv-orbit',
  resume: '.pv-resume',
  more: '.pv-more',
  close: '.pv-info-close, .pv-info-close--bottom, .pv-overlay__close',
  arrows: '.pv-arrow',
  about: '.pv-about-btn',
  strip: '.pv-strip',
  thumb: '.pv-thumb',
  mapcard: '.pv-map__card',
  mapgo: '.pv-map__card-go',
  mapback: '.pv-map__back',
};

/**
 * Marque les éléments de l'interface (data-ui, data-cmp) et applique leurs textes.
 * À rappeler quand une partie de l'interface est (re)construite.
 */
export function tagUi(root: ParentNode, d: DesignConfig) {
  for (const def of UI_ELEMENTS) {
    const sel = UI_SELECTORS[def.id];
    if (!sel) continue;
    root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      el.dataset.ui = def.id;
      el.dataset.cmp = componentOf(d, def.id);
      if (def.label === undefined) return;
      const label = d.elements[def.id]?.label ?? def.label;
      // Le texte est dans un <span> (bouton avec icône) ou directement dans le bouton.
      const target = el.querySelector('span') ?? (el.children.length === 0 ? el : null);
      if (target && target.textContent !== label) target.textContent = label;
    });
  }
}
