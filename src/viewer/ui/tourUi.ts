import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { Vector3, type PerspectiveCamera } from 'three';
import type { TourWork, UiConfig } from '../config/types';
import type { Tour, TourStatus } from '../tour/tour';
import { withBase } from '../url';
import { ICONS } from './icons';
import type { MinimapImage } from './minimap';
import type { MapViewer } from '../map/mapView';
import { createMapUi, type MapUi } from './mapUi';
import './tourUi.css';

gsap.registerPlugin(ScrollTrigger, SplitText);

export interface TourUiOptions {
  container: HTMLElement;
  tour: Tour;
  camera: PerspectiveCamera;
  /** Découpe courante (cylindre caméra → cible) : points d'œuvre visibles de l'extérieur. */
  cut: {
    uCutCam: { value: Vector3 };
    uCutTarget: { value: Vector3 };
    uCutRadius: { value: number };
    uCutFeather: { value: number };
    uCutStrength: { value: number };
  } | null;
  works: () => TourWork[];
  /** Durée d'affichage d'un point d'intérêt (ms). */
  hotspotIntervalMs: () => number;
  ui: () => UiConfig;
  minimap: MinimapImage | null;
  /** Carte interactive (rendu orthogonal en direct), ou null. */
  map: MapViewer | null;
  /** Hash d'URL par œuvre (#slug). */
  hash: boolean;
}

type Screen = 'exterior' | 'auto' | 'info';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const D = (s: number) => (REDUCED ? 0 : s);
/** Largeur sous laquelle l'interface passe en version mobile (px, largeur du conteneur). */
const MOBILE_MAX = 719;

/**
 * « Requête » mobile sur la largeur du CONTENEUR (et non de la fenêtre) : identique
 * en plein écran, et juste dans un aperçu réduit (back-office, cadre téléphone).
 * Même forme qu'un MediaQueryList : matches, change.
 */
function containerQuery(el: HTMLElement) {
  const listeners = new Set<() => void>();
  let matches = el.clientWidth <= MOBILE_MAX;
  const ro = new ResizeObserver(() => {
    const m = el.clientWidth <= MOBILE_MAX;
    if (m === matches) return;
    matches = m;
    listeners.forEach((l) => l());
  });
  ro.observe(el);
  return {
    get matches() {
      return matches;
    },
    addEventListener: (_: 'change', l: () => void) => void listeners.add(l),
    removeEventListener: (_: 'change', l: () => void) => void listeners.delete(l),
    dispose: () => ro.disconnect(),
  };
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let fontLoaded = false;
/** Police Mona Sans (variable : graisse, largeur, italique), chemin selon la base du site. */
function loadFont() {
  if (fontLoaded) return;
  fontLoaded = true;
  const style = document.createElement('style');
  style.textContent = `@font-face{font-family:'Mona Sans';src:url('${withBase('/fonts/mona-sans/mona-sans-vf.woff2')}') format('woff2');font-weight:200 900;font-stretch:75% 125%;font-style:oblique 0deg 10deg;font-display:swap}`;
  document.head.appendChild(style);
}

/**
 * Interface publique de la visite guidée (maquettes « visite auto », « info œuvre »,
 * « collection ») : titre et auteur, panneau « En savoir plus », points d'intérêt
 * projetés sur l'œuvre, commandes, bandeau de vignettes, collection, mini-carte,
 * partage, « À propos ». Transitions GSAP.
 */
export function createTourUi(o: TourUiOptions) {
  loadFont();
  const { tour, camera } = o;
  const MOBILE = containerQuery(o.container);
  const root = document.createElement('div');
  root.className = 'pv-ui';
  root.innerHTML = `
    <div class="pv-veil"></div>
    <div class="pv-ext-dots"></div>
    <div class="pv-veil pv-veil--info"></div>
    <div class="pv-hotspots"></div>
    <header class="pv-head" data-tour>
      <div class="pv-head__row">
        <h1 class="pv-title"></h1>
        <button type="button" class="pv-round pv-info-close" data-act="info-close" aria-label="Fermer la fiche">${ICONS.close}</button>
      </div>
      <p class="pv-author"></p>
      <button type="button" class="pv-pill pv-more" data-act="info-open"><span>Découvrir</span><i>${ICONS.arrowDown}</i></button>
    </header>
    <section class="pv-info" aria-label="Fiche de l'œuvre">
      <div class="pv-info__track"><div class="pv-info__thumb"></div></div>
      <div class="pv-info__scroll"></div>
    </section>
    <button type="button" class="pv-arrow pv-arrow--prev" data-act="prev" aria-label="Œuvre précédente">${ICONS.chevronLeft}</button>
    <button type="button" class="pv-arrow pv-arrow--next" data-act="next" aria-label="Œuvre suivante">${ICONS.chevronRight}</button>
    <button type="button" class="pv-about-btn" data-act="about">à propos</button>
    <div class="pv-bottom" data-tour>
      <div class="pv-minimap">
        <div class="pv-minimap__head"><span>Plans</span><button type="button" class="pv-minimap__expand" data-act="map" aria-label="Ouvrir la carte">${ICONS.expand}</button></div>
        <div class="pv-minimap__area"><div class="pv-minimap__plan" aria-label="Plan du Panthéon"><canvas></canvas><div class="pv-minimap__dots"></div></div></div>
      </div>
      <div class="pv-row">
        <div class="pv-row__group">
          <button type="button" class="pv-pill pv-pill--dark pv-share" data-act="share" aria-label="Partager le lien de l'œuvre"><span>Partager</span><i>${ICONS.share}</i></button>
          <button type="button" class="pv-round pv-round--dark pv-mobile" data-act="map" aria-label="Ouvrir la carte">${ICONS.map}</button>
          <button type="button" class="pv-round pv-pause" data-act="pause" aria-label="Pause">${ICONS.pause}</button>
        </div>
        <div class="pv-row__group">
          <button type="button" class="pv-round pv-round--dark pv-orbit" data-act="orbit" aria-label="Tourner librement autour de l'œuvre">${ICONS.cube}</button>
          <button type="button" class="pv-pill pv-pill--dark pv-coll" data-act="collection" aria-label="Ouvrir la collection"><span>Collection</span><i>${ICONS.grid}</i></button>
          <button type="button" class="pv-round pv-round--dark pv-home pv-mobile" data-act="stop" aria-label="Revenir à la vue extérieure">${ICONS.pantheon}</button>
        </div>
      </div>
      <div class="pv-strip">
        <div class="pv-strip__scroll"></div>
        <div class="pv-strip__bar"><i></i></div>
        <div class="pv-spotcard" role="status" aria-live="polite">
          <p class="pv-spotcard__text"></p>
          <button type="button" class="pv-spotcard__close" data-act="spot-close" aria-label="Fermer">${ICONS.close}</button>
        </div>
      </div>
      <button type="button" class="pv-round pv-round--dark pv-home pv-home--corner" data-act="stop" aria-label="Revenir à la vue extérieure">${ICONS.pantheon}</button>
    </div>
    <button type="button" class="pv-round pv-info-close--bottom" data-act="info-close" aria-label="Fermer la fiche">${ICONS.close}</button>
    <div class="pv-hand" aria-hidden="true"><div class="pv-hand__icon">${ICONS.hand}</div><p class="pv-hand__text">Déplacez-vous librement</p></div>
    <button type="button" class="pv-round pv-resume" data-act="resume" aria-label="Reprendre la visite">${ICONS.back}</button>
    <div class="pv-start">
      <button type="button" class="pv-round pv-round--dark pv-start__icon" data-act="map" aria-label="Ouvrir la carte">${ICONS.map}</button>
      <button type="button" class="pv-pill pv-pill--dark pv-start__go" data-act="start">Visite guidée</button>
      <button type="button" class="pv-round pv-round--dark pv-start__icon" data-act="collection" aria-label="Ouvrir la collection">${ICONS.grid}</button>
    </div>
    <div class="pv-overlay pv-collection" role="dialog" aria-modal="true" aria-label="Collection">
      <div class="pv-collection__panel">
        <div class="pv-collection__head"><h2>Collection</h2><span class="pv-collection__count"></span></div>
        <div class="pv-collection__body">
          <div class="pv-info__track"><div class="pv-info__thumb"></div></div>
          <div class="pv-collection__grid"></div>
        </div>
      </div>
      <button type="button" class="pv-round pv-overlay__close" data-act="collection-close" aria-label="Fermer la collection">${ICONS.close}</button>
    </div>
    <div class="pv-overlay pv-about" role="dialog" aria-modal="true" aria-label="À propos">
      <div class="pv-about__text"></div>
      <button type="button" class="pv-round pv-overlay__close" data-act="about-close" aria-label="Fermer">${ICONS.close}</button>
    </div>
    <div class="pv-toast" role="status" aria-live="polite"></div>`;
  o.container.appendChild(root);

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const el = {
    veil: $('.pv-veil'),
    veilInfo: $('.pv-veil--info'),
    head: $('.pv-head'),
    title: $('.pv-head .pv-title'),
    author: $('.pv-author'),
    more: $('.pv-more'),
    infoClose: $('.pv-info-close'),
    infoCloseBottom: $('.pv-info-close--bottom'),
    spotcard: $('.pv-spotcard'),
    hand: $('.pv-hand'),
    handIcon: $('.pv-hand__icon'),
    handText: $('.pv-hand__text'),
    resume: $('.pv-resume'),
    spotcardText: $('.pv-spotcard__text'),
    info: $('.pv-info'),
    infoScroll: $('.pv-info__scroll'),
    infoThumb: $('.pv-info .pv-info__thumb'),
    hotspots: $('.pv-hotspots'),
    bottom: $('.pv-bottom'),
    pause: $('[data-act="pause"]'),
    row: $('.pv-row'),
    arrows: root.querySelectorAll<HTMLElement>('.pv-arrow'),
    strip: $('.pv-strip__scroll'),
    stripBar: $('.pv-strip__bar i'),
    minimap: $('.pv-minimap'),
    minimapArea: $('.pv-minimap__area'),
    minimapPlan: $('.pv-minimap__plan'),
    minimapCanvas: $<HTMLCanvasElement>('.pv-minimap canvas'),
    minimapDots: $('.pv-minimap__dots'),
    start: $('.pv-start'),
    collection: $('.pv-collection'),
    collectionGrid: $('.pv-collection__grid'),
    collectionCount: $('.pv-collection__count'),
    collectionThumb: $('.pv-collection .pv-info__thumb'),
    about: $('.pv-about'),
    aboutBtn: $('.pv-about-btn'),
    extDots: $('.pv-ext-dots'),
    aboutText: $('.pv-about__text'),
    toast: $('.pv-toast'),
  };

  let screen: Screen = 'exterior';
  let status: TourStatus = tour.status();
  let workIndex = -1;
  let collectionOpen = false;
  let aboutOpen = false;
  let mapOpen = false;
  let mapUi: MapUi | null = null;
  let hidden = false; // interface masquée pendant la prise en main

  // ---- Affichage animé des blocs ---------------------------------------------------
  const fade = (target: gsap.TweenTarget, on: boolean, extra: gsap.TweenVars = {}) =>
    gsap.to(target, { autoAlpha: on ? 1 : 0, duration: D(on ? 0.5 : 0.3), ease: on ? 'power2.out' : 'power2.in', overwrite: 'auto', ...extra });
  gsap.set([el.head, el.bottom, el.info, el.veil, el.veilInfo, el.hotspots, el.collection, el.about, el.infoClose, el.infoCloseBottom, el.spotcard, el.arrows, el.hand, el.resume], { autoAlpha: 0 });

  // ---- Main « Déplacez-vous librement » ---------------------------------------------
  let handTl: gsap.core.Timeline | null = null;
  let handActive = false;
  /**
   * Main qui secoue (geste de glisser), avec ou sans texte, pendant `seconds`.
   * Pendant ce temps l'interface de la visite reste masquée.
   */
  function showHand(withText: boolean, seconds: number) {
    handTl?.kill();
    handActive = true;
    el.handText.style.display = withText ? '' : 'none';
    // Glissement sur toute la durée ; la main s'affirme (50 → 100 %) sur la première
    // moitié, puis s'efface en pleine course sur la seconde.
    const half = seconds / 2;
    handTl = gsap
      .timeline({ onComplete: endHand })
      .fromTo(el.hand, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0)
      // Un seul glissement lent de gauche à droite ; la main s'affirme (50 → 100 %).
      .fromTo(
        el.handIcon,
        { x: REDUCED ? 0 : -26, opacity: 0.5 },
        { x: REDUCED ? 0 : 26, duration: seconds, ease: 'sine.inOut' },
        0,
      )
      .to(el.handIcon, { opacity: 1, duration: half, ease: 'power1.out' }, 0)
      .to(el.hand, { autoAlpha: 0, duration: half, ease: 'power1.in' }, half);
    applyScreen();
  }
  function endHand() {
    handTl?.kill();
    handTl = null;
    gsap.set(el.handIcon, { x: 0, opacity: 1 });
    if (!handActive) return;
    handActive = false;
    applyScreen();
  }
  function hideHand() {
    if (!handActive) return;
    gsap.to(el.hand, { autoAlpha: 0, duration: 0.2, overwrite: true });
    endHand();
  }
  /** Main d'arrivée : une fois par entrée depuis l'extérieur. */
  let arrivalHand = false;

  let shown = false;
  function applyScreen() {
    const inTour = screen !== 'exterior';
    // Entrée et sortie (passage extérieur ↔ intérieur) : aucune interface, la
    // transition se suffit à elle-même.
    const transition = status.state === 'enter' || status.state === 'exit';
    const show = inTour && !hidden && !transition && !handActive && !mapOpen;
    fade(el.resume, inTour && hidden && !transition && !mapOpen);
    if (show && !shown) animateTitle();
    shown = show;
    fade(el.start, status.state === 'idle' && !collectionOpen && !mapOpen);
    const mobile = MOBILE.matches;
    const info = show && screen === 'info';
    fade([el.head, el.veil], show);
    // Fiche sur mobile : plus aucune commande autour, une croix en bas au centre.
    const bottom = show && !(mobile && screen === 'info');
    fade(el.bottom, bottom, { y: bottom ? 0 : 16 });
    fade(el.more, show && screen === 'auto');
    fade(el.infoClose, info && !mobile);
    fade(el.infoCloseBottom, info && mobile);
    if (info && mobile) placeInfo();
    else el.info.style.top = '';
    fade(el.info, info, { x: info ? 0 : -24 });
    fade(el.veilInfo, show && screen === 'info');
    // Flèches du carrousel : écran de visite seulement (la fiche occupe le bord gauche).
    fade(el.arrows, show && screen === 'auto');
    // « À propos » : vue extérieure seulement.
    fade(el.aboutBtn, status.state === 'idle' && !collectionOpen && !mapOpen);
    // Vue extérieure : points d'œuvre.
    const ext = status.state === 'idle' && !collectionOpen && !mapOpen;
    extShown = ext;
    fade(el.extDots, ext);
    fade(el.hotspots, show && screen === 'auto' && status.state === 'loop');
    if (screen === 'info') {
      revealInfo();
      requestAnimationFrame(() => updateScrollThumb(el.infoScroll, el.infoThumb));
    }
  }

  // ---- Titre, auteur, fiche ------------------------------------------------------
  let titleSplit: SplitText | null = null;
  function setWork(i: number) {
    const w = o.works()[i];
    workIndex = i;
    if (!w) return;
    titleSplit?.revert();
    titleSplit = null;
    el.title.textContent = w.title;
    el.author.textContent = w.author;
    alignClose();
    if (shown) animateTitle();
    renderInfo(w);
    buildHotspots(w);
    markStrip();
    markMinimap();
  }

  // ---- Vue extérieure : points d'œuvre ------------------------------------------------
  let extShown = false;
  interface ExtDot {
    btn: HTMLButtonElement;
    pos: Vector3;
    a: number;
  }
  let extDots: ExtDot[] = [];
  function buildExtDots() {
    el.extDots.innerHTML = '';
    extDots = o.works().map((w, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pv-ext-dot';
      btn.dataset.work = String(i);
      btn.setAttribute('aria-label', `Visiter : ${w.title}`);
      btn.innerHTML = `<i class="pv-map__dot"></i><span>${esc(w.title)}</span>`;
      el.extDots.appendChild(btn);
      return { btn, pos: new Vector3(...w.focus), a: 0 };
    });
  }
  el.extDots.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-work]');
    if (b) tour.start(Number(b.dataset.work));
  });
  const cutAxis = new Vector3();
  const cutRel = new Vector3();
  /**
   * Un point d'œuvre n'est montré que s'il est réellement visible par l'ouverture
   * de la découpe : dans le cylindre (rayon), et AU-DELÀ de sa fin (la découpe
   * efface tout ce qui est entre la caméra et la cible : une œuvre côté caméra est
   * coupée avec son mur, son point flotterait dans le vide).
   */
  function extVisible(p: Vector3) {
    const c = o.cut;
    if (!c || c.uCutStrength.value < 0.6) return false;
    cutAxis.subVectors(c.uCutTarget.value, c.uCutCam.value);
    const len = Math.max(cutAxis.length(), 1e-3);
    cutRel.subVectors(p, c.uCutCam.value);
    const t = cutRel.dot(cutAxis) / (len * len);
    const d = cutRel.addScaledVector(cutAxis, -t).length();
    return t > 1 && d < c.uCutRadius.value - c.uCutFeather.value;
  }
  function updateExtDots(dt: number) {
    if (!extShown) return;
    const W = o.container.clientWidth;
    const H = o.container.clientHeight;
    const k = 1 - Math.exp(-8 * dt);
    for (const d of extDots) {
      ndc.copy(d.pos).project(camera);
      const onScreen = ndc.z < 1 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95;
      d.a += ((onScreen && extVisible(d.pos) ? 1 : 0) - d.a) * k;
      d.btn.style.opacity = d.a.toFixed(3);
      d.btn.style.visibility = d.a < 0.02 ? 'hidden' : '';
      d.btn.style.transform = `translate(${((ndc.x + 1) / 2) * W}px, ${((1 - ndc.y) / 2) * H}px)`;
    }
  }

  /** Apparition du titre lettre par lettre, puis de l'auteur. */
  function animateTitle() {
    if (REDUCED || !el.title.textContent) return;
    titleSplit?.revert();
    titleSplit = new SplitText(el.title, { type: 'chars', charsClass: 'pv-char' });
    gsap.from(titleSplit.chars, { yPercent: 60, autoAlpha: 0, duration: 0.6, ease: 'power3.out', stagger: 0.025 });
    gsap.from(el.author, { autoAlpha: 0, y: 6, duration: 0.5, delay: 0.15 });
  }

  /**
   * Centre la croix de la fiche sur la hauteur des capitales du titre (et non sur
   * sa boîte de ligne, qui inclut l'espace des jambages).
   */
  const metrics = document.createElement('canvas').getContext('2d')!;
  function alignClose() {
    const cs = getComputedStyle(el.title);
    const size = parseFloat(cs.fontSize);
    // (La largeur « 125% » n'est pas acceptée par le raccourci font du canvas ; sans effet sur les hauteurs.)
    metrics.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = metrics.measureText('L');
    const ascent = m.fontBoundingBoxAscent ?? size * 0.95;
    const descent = m.fontBoundingBoxDescent ?? size * 0.25;
    const cap = m.actualBoundingBoxAscent || size * 0.72;
    const lineH = parseFloat(cs.lineHeight) || size;
    // Haut de la boîte de ligne → ligne de base, puis milieu des capitales.
    const baseline = (lineH - (ascent + descent)) / 2 + ascent;
    const capMid = baseline - cap / 2;
    el.infoClose.style.marginTop = `${Math.round(capMid - el.infoClose.offsetHeight / 2 || 0)}px`;
  }
  window.addEventListener('resize', alignClose);
  document.fonts?.ready.then(alignClose);

  function renderInfo(w: TourWork) {
    const blocks = w.content?.blocks ?? [];
    el.infoScroll.innerHTML = blocks.length
      ? blocks
          .map((b) =>
            b.type === 'image'
              ? b.src
                ? `<figure class="pv-block pv-block--image"><img src="${esc(withBase(b.src))}" alt="${esc(b.alt)}" loading="lazy"></figure>`
                : ''
              : `<div class="pv-block pv-block--text">${b.html}</div>`,
          )
          .join('')
      : `<div class="pv-block pv-block--text"><p>${esc(w.title)}${w.author ? ` — ${esc(w.author)}` : ''}</p></div>`;
    el.infoScroll.scrollTop = 0;
    updateScrollThumb(el.infoScroll, el.infoThumb);
  }
  /** Mobile : la fiche commence juste sous l'auteur (« Découvrir » n'y est plus). */
  function placeInfo() {
    const top = el.author.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
    el.info.style.top = `${Math.round(top + 22)}px`;
  }
  function revealInfo() {
    gsap.fromTo(
      el.infoScroll.querySelectorAll('.pv-block'),
      { autoAlpha: 0, y: 18 },
      { autoAlpha: 1, y: 0, duration: D(0.55), ease: 'power2.out', stagger: D(0.08), delay: D(0.15), overwrite: true },
    );
  }
  /** Indicateur de défilement vertical (barre blanche sur piste grise). */
  function updateScrollThumb(scroller: HTMLElement, thumb: HTMLElement) {
    const ratio = scroller.clientHeight / Math.max(scroller.scrollHeight, 1);
    const pos = scroller.scrollTop / Math.max(scroller.scrollHeight - scroller.clientHeight, 1);
    thumb.style.height = `${Math.min(ratio, 1) * 100}%`;
    thumb.style.transform = `translateY(${pos * (1 / Math.min(ratio, 1) - 1) * 100}%)`;
  }
  el.infoScroll.addEventListener('scroll', () => updateScrollThumb(el.infoScroll, el.infoThumb), { passive: true });

  // ---- Points d'intérêt -----------------------------------------------------------
  interface HotspotView {
    pos: Vector3;
    dot: HTMLButtonElement;
    text: HTMLDivElement;
    x: number;
    y: number;
    init: boolean;
  }
  let spots: HotspotView[] = [];
  let active = 0;
  let cycle = 0;
  let textSplit: SplitText | null = null;

  function buildHotspots(w: TourWork) {
    el.hotspots.innerHTML = '';
    spots = (w.hotspots ?? []).map((h, k) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'pv-spot';
      dot.setAttribute('aria-label', `Point d'intérêt ${k + 1}`);
      dot.addEventListener('click', () => activate(k));
      const text = document.createElement('div');
      text.className = 'pv-spot__text';
      text.textContent = h.text;
      el.hotspots.append(dot, text);
      return { pos: new Vector3(...h.position), dot, text, x: 0, y: 0, init: false };
    });
    active = -1;
    cycle = 0;
    closeSpotCard();
    // Desktop : premier point affiché d'emblée, puis cycle. Mobile : rien avant un tap.
    if (!MOBILE.matches) activate(0, false);
  }
  /**
   * Point d'intérêt actif. Desktop : son texte flotte à côté du point. Mobile : le
   * texte s'affiche par-dessus le bandeau pendant 5 s (croix pour fermer).
   */
  function activate(k: number, animate = true) {
    if (!spots.length) return;
    active = ((k % spots.length) + spots.length) % spots.length;
    cycle = 0;
    markSpots();
    if (MOBILE.matches) return openSpotCard(spots[active].text.textContent ?? '');
    textSplit?.revert();
    const t = spots[active].text;
    if (animate && !REDUCED && t.textContent) {
      textSplit = new SplitText(t, { type: 'words' });
      gsap.from(textSplit.words, { autoAlpha: 0, y: 8, duration: 0.45, ease: 'power2.out', stagger: 0.02 });
    }
  }
  function markSpots() {
    spots.forEach((s, j) => {
      s.dot.classList.toggle('is-active', j === active);
      s.text.classList.toggle('is-active', j === active);
    });
  }

  // Encart mobile par-dessus le bandeau : 5 s (décompte figé en pause ou en prise en main).
  const SPOTCARD_MS = 5000;
  let cardMs = -1;
  let cardSplit: SplitText | null = null;
  function openSpotCard(text: string) {
    // Annuler l'animation précédente AVANT d'écrire : revert() restaure le contenu
    // d'origine du découpage, sinon le texte du point précédent reviendrait.
    cardSplit?.revert();
    cardSplit = null;
    el.spotcardText.textContent = text;
    cardMs = 0;
    fade(el.spotcard, true);
    if (!REDUCED && text) {
      cardSplit = new SplitText(el.spotcardText, { type: 'words' });
      gsap.from(cardSplit.words, { autoAlpha: 0, y: 8, duration: 0.45, ease: 'power2.out', stagger: 0.02 });
    }
  }
  function closeSpotCard() {
    if (cardMs < 0) return;
    cardMs = -1;
    fade(el.spotcard, false);
    if (MOBILE.matches) {
      active = -1;
      markSpots();
    }
  }
  function onMobileChange() {
    layoutMinimap();
    if (workIndex >= 0) {
      const w = o.works()[workIndex];
      if (w) buildHotspots(w);
    }
    applyScreen();
  }

  const ndc = new Vector3();
  const camSpace = new Vector3();
  let safe = { left: 16, top: 120, right: 0, bottom: 0 };
  /** Zone libre pour le texte : entre le titre (haut) et les commandes (bas). */
  function measureSafe() {
    const r = o.container.getBoundingClientRect();
    const head = el.head.getBoundingClientRect();
    const ctrl = el.row.getBoundingClientRect();
    safe = {
      left: 16,
      right: r.width - 16,
      top: Math.max(head.bottom - r.top + 12, 80),
      bottom: Math.min(ctrl.top - r.top - 12, r.height - 80),
    };
  }

  /**
   * Chaque image : position écran des points. Le point actif (et son texte) reste
   * toujours à l'écran : hors champ ou derrière la caméra, il glisse vers le bord de
   * la zone libre, dans la direction du point (comme un indicateur de cible).
   */
  function updateHotspots(dt: number) {
    if (!spots.length || screen !== 'auto' || status.state !== 'loop') return;
    const W = o.container.clientWidth;
    const H = o.container.clientHeight;
    const cx = (safe.left + safe.right) / 2;
    const cy = (safe.top + safe.bottom) / 2;
    const k = 1 - Math.exp(-12 * dt);
    spots.forEach((s, j) => {
      camSpace.copy(s.pos).applyMatrix4(camera.matrixWorldInverse);
      const behind = camSpace.z > 0;
      ndc.copy(s.pos).project(camera);
      let x = ((ndc.x + 1) / 2) * W;
      let y = ((1 - ndc.y) / 2) * H;
      if (behind) {
        // Derrière la caméra : direction inversée, poussée loin vers le bord.
        x = cx - (x - cx) * 1e3;
        y = cy - (y - cy) * 1e3;
      }
      const inside = !behind && x >= safe.left && x <= safe.right && y >= safe.top && y <= safe.bottom;
      if (j !== active) {
        s.dot.style.visibility = inside ? '' : 'hidden';
        s.dot.style.transform = `translate(${x}px, ${y}px)`;
        return;
      }
      if (!inside) {
        // Magnétisme : intersection de la droite centre → point avec le bord de la zone.
        const dx = x - cx;
        const dy = y - cy;
        const t = Math.min(Math.abs((safe.right - cx) / (dx || 1e-6)), Math.abs((safe.bottom - cy) / (dy || 1e-6)));
        x = cx + dx * Math.min(t, 1);
        y = cy + dy * Math.min(t, 1);
      }
      if (!s.init) {
        s.x = x;
        s.y = y;
        s.init = true;
      }
      s.x += (x - s.x) * k;
      s.y += (y - s.y) * k;
      s.dot.style.visibility = '';
      s.dot.classList.toggle('is-edge', !inside);
      s.dot.style.transform = `translate(${s.x}px, ${s.y}px)`;
      // Texte à droite et au-dessus du point, retourné près des bords.
      const tw = s.text.offsetWidth;
      const th = s.text.offsetHeight;
      const flipX = s.x + 14 + tw > safe.right;
      const flipY = s.y - 10 - th < safe.top;
      const tx = flipX ? s.x - 14 - tw : s.x + 14;
      const ty = flipY ? s.y + 12 : s.y - 10 - th;
      s.text.style.transform = `translate(${Math.max(safe.left, tx)}px, ${ty}px)`;
    });
    // Pause ou prise en main : cycle et décompte de l'encart figés, texte maintenu.
    if (tour.manualPaused || status.userControl) return;
    if (MOBILE.matches) {
      if (cardMs >= 0 && (cardMs += dt * 1000) >= SPOTCARD_MS) closeSpotCard();
    } else if (spots.length > 1) {
      cycle += dt * 1000;
      if (cycle >= o.hotspotIntervalMs()) activate(active + 1);
    }
  }

  // ---- Bandeau de vignettes -------------------------------------------------------
  const thumbHtml = (w: TourWork, cls: string) =>
    w.thumbnail
      ? `<img class="${cls}" src="${esc(withBase(w.thumbnail))}" alt="" loading="lazy">`
      : `<span class="${cls} pv-noimg">${esc(w.title)}</span>`;
  function buildStrip() {
    el.strip.innerHTML = o
      .works()
      // Titre toujours affiché, par-dessus la vignette (ou sur fond sombre sans image).
      .map(
        (w, i) =>
          `<button type="button" class="pv-thumb" data-work="${i}">${
            w.thumbnail ? `<img class="pv-thumb__img" src="${esc(withBase(w.thumbnail))}" alt="" loading="lazy">` : ''
          }<span class="pv-thumb__title">${esc(w.title)}</span></button>`,
      )
      .join('');
    markStrip();
  }
  function markStrip() {
    el.strip.querySelectorAll<HTMLElement>('.pv-thumb').forEach((b) => {
      const on = Number(b.dataset.work) === workIndex;
      b.classList.toggle('is-current', on);
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
      if (on) el.strip.scrollTo({ left: b.offsetLeft - (el.strip.clientWidth - b.offsetWidth) / 2, behavior: REDUCED ? 'auto' : 'smooth' });
    });
  }
  const updateStripBar = () => {
    const s = el.strip;
    const ratio = s.clientWidth / Math.max(s.scrollWidth, 1);
    el.stripBar.style.width = `${Math.min(ratio, 1) * 100}%`;
    el.stripBar.style.transform = `translateX(${(s.scrollLeft / Math.max(s.scrollWidth - s.clientWidth, 1)) * (1 / Math.min(ratio, 1) - 1) * 100}%)`;
  };
  el.strip.addEventListener('scroll', updateStripBar, { passive: true });
  el.strip.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-work]');
    if (b) goToWork(Number(b.dataset.work));
  });
  // Molette verticale → défilement horizontal du bandeau.
  el.strip.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.strip.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    },
    { passive: false },
  );

  // ---- Collection -----------------------------------------------------------------
  let batch: ScrollTrigger[] = [];
  function buildCollection() {
    const works = o.works();
    el.collectionCount.textContent = pad2(works.length);
    el.collectionGrid.innerHTML = works
      .map(
        (w, i) => `<article class="pv-card" data-work="${i}">
          ${thumbHtml(w, 'pv-card__img')}
          <button type="button" class="pv-card__open" data-work="${i}" aria-label="Voir ${esc(w.title)}"></button>
          <div class="pv-card__text"><span>${esc(w.author)}</span><h3>${esc(w.title)}</h3></div>
          <button type="button" class="pv-card__share" data-share="${i}" aria-label="Partager ${esc(w.title)}">${ICONS.share}</button>
        </article>`,
      )
      .join('');
  }
  function openCollection(on: boolean) {
    collectionOpen = on;
    batch.forEach((t) => t.kill());
    batch = [];
    fade(el.collection, on);
    applyScreen();
    if (!on) return;
    const scroller = el.collectionGrid;
    scroller.scrollTop = 0;
    const cards = scroller.querySelectorAll('.pv-card');
    gsap.set(cards, { autoAlpha: 0, y: 40 });
    // Apparition en cascade au fil du défilement (ScrollTrigger.batch).
    requestAnimationFrame(() => {
      batch = ScrollTrigger.batch(cards, {
        scroller,
        start: 'top 98%',
        onEnter: (els) => gsap.to(els, { autoAlpha: 1, y: 0, duration: D(0.6), ease: 'power3.out', stagger: D(0.09), overwrite: true }),
      });
      ScrollTrigger.refresh();
      updateScrollThumb(scroller, el.collectionThumb);
    });
  }
  el.collectionGrid.addEventListener('scroll', () => updateScrollThumb(el.collectionGrid, el.collectionThumb), { passive: true });
  el.collectionGrid.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const share = t.closest<HTMLElement>('[data-share]');
    if (share) return void shareWork(o.works()[Number(share.dataset.share)]);
    const card = t.closest<HTMLElement>('[data-work]');
    if (!card) return;
    openCollection(false);
    goToWork(Number(card.dataset.work));
  });

  // ---- Mini-carte ----------------------------------------------------------------
  let mapRot = 0;
  function layoutMinimap() {
    const m = o.minimap;
    if (!m) return void (el.minimap.style.display = 'none');
    const ui = o.ui();
    mapRot = (((MOBILE.matches ? ui.minimap.rotationMobile : ui.minimap.rotationDesktop) % 360) + 360) % 360;
    const swap = mapRot === 90 || mapRot === 270;
    const w = swap ? m.canvas.height : m.canvas.width;
    const h = swap ? m.canvas.width : m.canvas.height;
    const c = el.minimapCanvas;
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate((mapRot * Math.PI) / 180);
    g.drawImage(m.canvas, -m.canvas.width / 2, -m.canvas.height / 2);
    g.restore();
    planAspect = w / h;
    fitMinimap();
    el.minimapDots.innerHTML = o
      .works()
      .map((wk, i) => {
        const [u, v] = mapUv(wk.focus[0], wk.focus[2]);
        return `<button type="button" class="pv-minimap__dot" data-work="${i}" style="left:${u * 100}%;top:${v * 100}%" aria-label="${esc(wk.title)}"></button>`;
      })
      .join('');
    markMinimap();
  }
  let planAspect = 1;
  /** Plan inscrit dans la zone sous « Plans », proportions conservées (les points suivent). */
  function fitMinimap() {
    const aw = el.minimapArea.clientWidth;
    const ah = el.minimapArea.clientHeight;
    if (!aw || !ah) return;
    const w = Math.min(aw, ah * planAspect);
    el.minimapPlan.style.width = `${w}px`;
    el.minimapPlan.style.height = `${w / planAspect}px`;
  }
  const minimapObserver = new ResizeObserver(fitMinimap);
  minimapObserver.observe(el.minimapArea);
  /** Position (x, z) monde → coordonnées (0–1) dans la mini-carte tournée. */
  function mapUv(x: number, z: number): [number, number] {
    const m = o.minimap!;
    const u = (x - m.minX) / m.sizeX;
    const v = (z - m.minZ) / m.sizeZ;
    if (mapRot === 90) return [1 - v, u];
    if (mapRot === 180) return [1 - u, 1 - v];
    if (mapRot === 270) return [v, 1 - u];
    return [u, v];
  }
  function markMinimap() {
    el.minimapDots.querySelectorAll<HTMLElement>('[data-work]').forEach((d) => d.classList.toggle('is-current', Number(d.dataset.work) === workIndex));
  }
  el.minimapDots.addEventListener('click', (e) => {
    const d = (e.target as HTMLElement).closest<HTMLElement>('[data-work]');
    if (d) goToWork(Number(d.dataset.work));
  });
  MOBILE.addEventListener('change', onMobileChange);

  // ---- Partage, à propos, toast -----------------------------------------------------
  let toastTween: gsap.core.Timeline | null = null;
  function toast(msg: string) {
    el.toast.textContent = msg;
    toastTween?.kill();
    toastTween = gsap
      .timeline()
      .fromTo(el.toast, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: D(0.3) })
      .to(el.toast, { autoAlpha: 0, duration: D(0.4), delay: 1.8 });
  }
  /** Feuille de partage du système si disponible (mobile, Safari…), sinon copie du lien. */
  async function shareWork(w: TourWork | undefined) {
    if (!w) return;
    const url = `${location.origin}${location.pathname}${location.search}#${w.slug}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: w.title, text: w.author ? `${w.title} — ${w.author}` : w.title, url });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien copié');
    } catch {
      toast(url);
    }
  }
  function openAbout(on: boolean) {
    aboutOpen = on;
    if (on) {
      el.aboutText.innerHTML = o.ui().aboutHtml;
      gsap.fromTo(el.aboutText.children, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: D(0.5), stagger: D(0.06), delay: D(0.1) });
    }
    fade(el.about, on);
  }

  // ---- Actions -----------------------------------------------------------------------
  function goToWork(i: number) {
    if (tour.active) tour.goTo(i);
    else tour.start(i);
  }
  function setScreen(s: Screen) {
    screen = s;
    applyScreen();
  }
  const actions: Record<string, () => void> = {
    start: () => tour.start(0),
    prev: () => tour.prev(),
    next: () => tour.next(),
    pause: () => tour.togglePause(),
    stop: () => tour.stop(),
    share: () => shareWork(o.works()[workIndex]),
    collection: () => openCollection(true),
    'collection-close': () => openCollection(false),
    about: () => openAbout(true),
    'about-close': () => openAbout(false),
    'info-open': () => setScreen('info'),
    'info-close': () => setScreen('auto'),
    'spot-close': () => closeSpotCard(),
    // Provisoire : carte interactive (étape « Carte ») et orbite libre (étape « Cube »).
    map: () => mapUi?.open(0),
    // Cube : orbite libre, main qui secoue 1 s (sans texte), à chaque fois.
    orbit: () => {
      tour.orbit();
      if (tour.status().userControl) showHand(false, 1);
    },
    resume: () => {
      hideHand();
      tour.resume();
    },
  };
  if (o.map) {
    mapUi = createMapUi({
      root,
      map: o.map,
      tour,
      works: o.works,
      ui: o.ui,
      mobile: () => MOBILE.matches,
      showHand,
      hideHand,
      goToWork,
      onToggle: (on) => {
        mapOpen = on;
        if (on) {
          openCollection(false);
          if (screen === 'info') screen = 'auto';
        }
        applyScreen();
      },
    });
  }

  root.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) actions[act]?.();
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (mapUi?.onKey(e)) return void e.preventDefault();
    if (mapOpen) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'Escape') {
      if (aboutOpen) openAbout(false);
      else if (status.userControl) actions.resume();
      else if (collectionOpen) openCollection(false);
      else if (screen === 'info') setScreen('auto');
      else if (tour.active) tour.stop();
      else return;
      e.preventDefault();
      return;
    }
    if (!tour.active || aboutOpen || collectionOpen) return;
    const act = { ArrowLeft: 'prev', ArrowRight: 'next', ' ': 'pause' }[e.key];
    if (!act) return;
    e.preventDefault();
    actions[act]();
  };
  window.addEventListener('keydown', onKey);

  // ---- Hash d'URL --------------------------------------------------------------------
  const indexOfSlug = (slug: string) => o.works().findIndex((w) => w.slug === slug);
  const workFromHash = () => {
    const slug = decodeURIComponent(location.hash.slice(1));
    return slug ? indexOfSlug(slug) : -1;
  };
  const setHash = (slug: string | null) => {
    if (!o.hash) return;
    const want = slug ? `#${slug}` : '';
    if (location.hash !== want) history.replaceState(null, '', want || location.pathname + location.search);
  };
  const onHash = () => {
    const i = workFromHash();
    if (i < 0) return;
    if (tour.active) {
      if (tour.status().index !== i) tour.goTo(i);
    } else tour.start(i);
  };
  if (o.hash) window.addEventListener('hashchange', onHash);

  // ---- État de la visite ---------------------------------------------------------------
  function onStatus(s: TourStatus) {
    const prev = status;
    status = s;
    const inTour = s.state !== 'idle' && s.state !== 'exit';
    if (inTour && screen === 'exterior') screen = 'auto';
    if (!inTour) screen = 'exterior';
    if (s.index >= 0 && s.index !== workIndex) setWork(s.index);
    hidden = s.userControl;
    // Nouvelle entrée depuis l'extérieur : la main d'arrivée pourra s'afficher.
    if (s.state === 'enter' && prev.state !== 'enter') arrivalHand = false;
    // Glisser pendant la main : elle disparaît (le geste est compris).
    if (s.orbitMode === 'drag') hideHand();
    // Fin de l'orbite : plus de main.
    if (!s.userControl && prev.userControl) hideHand();
    el.pause.innerHTML = tour.manualPaused ? ICONS.play : ICONS.pause;
    el.pause.setAttribute('aria-label', tour.manualPaused ? 'Reprendre' : 'Pause');
    if (inTour && s.work) setHash(s.work.slug);
    else if (!inTour && prev.state !== 'idle') setHash(null);
    if (!inTour) workIndex = -1;
    applyScreen();
  }
  const off = tour.onChange(onStatus);

  let measureT = 0;
  function refresh() {
    mapUi?.refresh();
    buildExtDots();
    buildStrip();
    buildCollection();
    layoutMinimap();
    updateStripBar();
    if (workIndex >= 0) {
      const w = o.works()[workIndex];
      if (w) {
        el.title.textContent = w.title;
        el.author.textContent = w.author;
        renderInfo(w);
        buildHotspots(w);
      }
    }
  }
  refresh();
  onStatus(tour.status());
  measureSafe();

  return {
    /** Chaque image, après la mise à jour de la caméra. */
    update(dt: number) {
      measureT += dt;
      if (measureT > 0.5) {
        measureT = 0;
        measureSafe();
      }
      // Main d'arrivée : de 1 s avant l'arrivée sur l'œuvre à 1 s après, puis l'interface.
      if (!arrivalHand && status.state === 'enter' && tour.phaseRemaining <= 1) {
        arrivalHand = true;
        if (!tour.hasDragged) showHand(true, 2);
      }
      updateHotspots(dt);
      updateExtDots(dt);
      mapUi?.update(dt);
    },
    /** Œuvres ou réglages d'interface modifiés (back-office). */
    refresh,
    /** Œuvre demandée par le hash au chargement, ou -1. */
    /** Carte interactive (back-office : aperçu d'une vue). */
    openMap: (view = 0) => mapUi?.open(view),
    closeMap: () => mapUi?.close(),
    initialIndex: () => (o.hash ? workFromHash() : -1),
    dispose() {
      off();
      mapUi?.dispose();
      batch.forEach((t) => t.kill());
      titleSplit?.revert();
      textSplit?.revert();
      cardSplit?.revert();
      handTl?.kill();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', alignClose);
      window.removeEventListener('hashchange', onHash);
      MOBILE.removeEventListener('change', onMobileChange);
      MOBILE.dispose();
      minimapObserver.disconnect();
      gsap.killTweensOf(root.querySelectorAll('*'));
      root.remove();
    },
  };
}

export type TourUi = ReturnType<typeof createTourUi>;
