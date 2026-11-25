import { gsap } from 'gsap';
import { Vector3 } from 'three';
import type { TourWork, UiConfig } from '../config/types';
import type { MapViewer } from '../map/mapView';
import type { Tour } from '../tour/tour';
import { withBase } from '../url';
import { ICONS } from './icons';

export interface MapUiOptions {
  root: HTMLElement;
  map: MapViewer;
  tour: Tour;
  works: () => TourWork[];
  ui: () => UiConfig;
  mobile: () => boolean;
  /** Main « Déplacez-vous librement » (avec texte, durée en s). */
  showHand: (withText: boolean, seconds: number) => void;
  hideHand: () => void;
  goToWork: (i: number) => void;
  /** Ouverture / fermeture : l'interface de la visite se masque ou revient. */
  onToggle: (open: boolean) => void;
}

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const D = (s: number) => (REDUCED ? 0 : s);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Écran « Carte interactive » (maquettes desktop_carte / mobile_carte) : plan et
 * vues de face rendus en direct, zoom et déplacement, 5 vignettes (plan + 4 murs),
 * points des œuvres avec encart « Voir l'œuvre », retour à la visite.
 */
export function createMapUi(o: MapUiOptions) {
  const { map, tour } = o;
  const el = document.createElement('div');
  el.className = 'pv-map';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Carte interactive');
  el.innerHTML = `
    <div class="pv-map__surface"></div>
    <div class="pv-map__bg"></div>
    <header class="pv-map__head">
      <h2 class="pv-map__title"></h2>
      <p class="pv-map__sub"></p>
      <p class="pv-map__hint"></p>
    </header>
    <div class="pv-map__dots"></div>
    <div class="pv-map__card" role="group">
      <div class="pv-map__card-img"></div>
      <div class="pv-map__card-body">
        <h3 class="pv-map__card-title"></h3>
        <p class="pv-map__card-author"></p>
        <button type="button" class="pv-pill pv-pill--dark pv-map__card-go" data-map="go"><i>${ICONS.play}</i><span>Voir l'œuvre</span></button>
      </div>
      <button type="button" class="pv-map__card-close" data-map="card-close" aria-label="Fermer">${ICONS.close}</button>
    </div>
    <div class="pv-map__views" role="tablist" aria-label="Vues">
    </div>
    <button type="button" class="pv-pill pv-pill--dark pv-map__back" data-map="back"><i>${ICONS.play}</i><span class="pv-map__back-text"></span></button>
    <button type="button" class="pv-round pv-round--dark pv-home pv-map__home" data-map="home" aria-label="Revenir à la vue extérieure">${ICONS.pantheon}</button>`;
  o.root.appendChild(el);

  const $ = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const e = {
    surface: $('.pv-map__surface'),
    head: $('.pv-map__head'),
    title: $('.pv-map__title'),
    sub: $('.pv-map__sub'),
    hint: $('.pv-map__hint'),
    dots: $('.pv-map__dots'),
    card: $('.pv-map__card'),
    cardImg: $('.pv-map__card-img'),
    cardTitle: $('.pv-map__card-title'),
    cardAuthor: $('.pv-map__card-author'),
    views: $('.pv-map__views'),
    back: $('.pv-map__back'),
    backText: $('.pv-map__back-text'),
    home: $('.pv-map__home'),
    bg: $('.pv-map__bg'),
  };
  // Une vignette par vue de la configuration (plan, vues de face, plafonds).
  let viewBtns: HTMLButtonElement[] = [];
  let canvases: HTMLCanvasElement[] = [];
  function buildViews() {
    const views = o.ui().map.views;
    e.views.innerHTML = views
      .map((v, i) => `<button type="button" class="pv-map__view" role="tab" data-view="${i}" aria-label="${esc(v.name || `Vue ${i + 1}`)}"><canvas width="240" height="200"></canvas></button>`)
      .join('');
    viewBtns = [...e.views.querySelectorAll<HTMLButtonElement>('.pv-map__view')];
    canvases = viewBtns.map((b) => b.querySelector('canvas')!);
  }
  gsap.set([el, e.card], { autoAlpha: 0 });
  /** Éléments de l'écran qui apparaissent après le glissement du fond. */
  const chrome = () => [e.head, e.dots, e.views, e.back, e.home];

  let open = false;
  /** Visite mise en pause par l'ouverture de la carte (reprise à la fermeture). */
  let pausedByMap = false;
  let card = -1;

  // ---- Textes, points des œuvres -------------------------------------------------
  function renderTexts() {
    const m = o.ui().map;
    e.title.textContent = m.title;
    e.sub.textContent = m.subtitle;
    e.hint.textContent = m.hint;
  }
  let dots: { el: HTMLButtonElement; pos: Vector3 }[] = [];
  function buildDots() {
    e.dots.innerHTML = '';
    dots = o.works().map((w, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pv-map__dot';
      b.dataset.work = String(i);
      b.setAttribute('aria-label', w.title);
      e.dots.appendChild(b);
      return { el: b, pos: new Vector3(...w.focus) };
    });
    markDots();
  }
  function markDots() {
    dots.forEach((d, i) => d.el.classList.toggle('is-current', i === card));
  }

  // ---- Encart d'une œuvre ---------------------------------------------------------
  function openCard(i: number) {
    const w = o.works()[i];
    if (!w) return;
    card = i;
    e.cardImg.innerHTML = w.thumbnail ? `<img src="${esc(withBase(w.thumbnail))}" alt="">` : '';
    e.cardImg.style.display = w.thumbnail ? '' : 'none';
    e.cardTitle.textContent = w.title;
    e.cardAuthor.textContent = w.author;
    markDots();
    map.focusOn(dots[i].pos, Math.max(map.zoom, 2.2));
    gsap.fromTo(e.card, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: D(0.35), ease: 'power2.out', overwrite: true });
    fadeButtons();
  }
  function closeCard() {
    if (card < 0) return;
    card = -1;
    markDots();
    gsap.to(e.card, { autoAlpha: 0, duration: D(0.2), overwrite: true });
    fadeButtons();
  }
  /** Mobile : l'encart prend la place des boutons du bas. */
  function fadeButtons() {
    const hide = card >= 0 && o.mobile();
    gsap.to([e.back, e.home], { autoAlpha: hide ? 0 : 1, duration: D(0.25), overwrite: true });
  }

  // ---- Vues -------------------------------------------------------------------------
  /** Vue choisie : la caméra glisse et pivote jusqu'au point de la vue (transition animée). */
  function selectView(i: number, animate = false) {
    closeCard();
    if (i === map.view && animate) return;
    map.setView(i, animate && map.active && !REDUCED);
    viewBtns.forEach((b, j) => {
      b.classList.toggle('is-current', j === i);
      b.setAttribute('aria-selected', String(j === i));
    });
  }

  /** Zone libre de l'écran pour cadrer la vue (hors titres, vignettes et boutons). */
  const box = (n: HTMLElement) => ({
    left: n.offsetLeft,
    top: n.offsetTop,
    right: n.offsetLeft + n.offsetWidth,
    bottom: n.offsetTop + n.offsetHeight,
  });
  function measureSafe() {
    // Positions de mise en page (offset*) : indépendantes des glissements animés (GSAP),
    // sinon le cadrage suit l'animation d'entrée et le plan saute de quelques pixels.
    const r = { left: 0, top: 0, width: el.clientWidth, height: el.clientHeight };
    const head = box(e.head);
    const views = box(e.views);
    const back = box(e.back);
    if (o.mobile()) {
      const top = head.bottom - r.top + 12;
      const bottom = Math.min(views.top, back.top) - r.top - 12;
      map.setSafeRect({ left: 16, top, width: r.width - 32, height: Math.max(bottom - top, 50) });
    } else {
      const left = views.right - r.left + 40;
      const top = Math.max(head.bottom - r.top + 4, 24);
      const bottom = back.top - r.top - 16;
      map.setSafeRect({ left, top, width: Math.max(r.width - left - 40, 50), height: Math.max(bottom - top, 50) });
    }
  }

  // ---- Zoom et déplacement : souris, molette, pincement -------------------------------
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let pinch = 0;
  const pos = (ev: PointerEvent) => {
    const r = o.root.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  e.surface.addEventListener('pointerdown', (ev) => {
    e.surface.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, pos(ev));
    if (pointers.size === 1) moved = 0;
    if (pointers.size === 2) pinch = spread();
    o.hideHand();
  });
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const mid = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  e.surface.addEventListener('pointermove', (ev) => {
    const prev = pointers.get(ev.pointerId);
    if (!prev) return;
    const p = pos(ev);
    if (pointers.size === 1) {
      map.panBy(p.x - prev.x, p.y - prev.y, true);
      moved += Math.hypot(p.x - prev.x, p.y - prev.y);
      pointers.set(ev.pointerId, p);
      return;
    }
    const m0 = mid();
    pointers.set(ev.pointerId, p);
    const m1 = mid();
    const s = spread();
    if (pinch > 0) map.zoomAt(m1.x, m1.y, s / pinch);
    map.panBy(m1.x - m0.x, m1.y - m0.y, true);
    pinch = s;
    moved += 10;
  });
  const up = (ev: PointerEvent) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = 0;
    // Simple clic sur la carte : ferme l'encart.
    if (pointers.size === 0 && moved < 5) closeCard();
  };
  e.surface.addEventListener('pointerup', up);
  e.surface.addEventListener('pointercancel', up);
  e.surface.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const p = { x: ev.clientX - o.root.getBoundingClientRect().left, y: ev.clientY - o.root.getBoundingClientRect().top };
      map.zoomAt(p.x, p.y, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)));
      o.hideHand();
    },
    { passive: false },
  );
  e.surface.addEventListener('dblclick', (ev) => {
    const p = pos(ev as unknown as PointerEvent);
    map.zoomAt(p.x, p.y, 2);
  });

  el.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const dot = t.closest<HTMLElement>('.pv-map__dot');
    if (dot) return openCard(Number(dot.dataset.work));
    const v = t.closest<HTMLElement>('[data-view]');
    if (v) return selectView(Number(v.dataset.view), true);
    const act = t.closest<HTMLElement>('[data-map]')?.dataset.map;
    if (act === 'back') {
      if (tour.active) close();
      else {
        close();
        tour.start(0);
      }
    } else if (act === 'home') {
      // En visite : retour à la vue extérieure ; dehors : simple fermeture.
      const stop = tour.active;
      close(false);
      if (stop) tour.stop();
    } else if (act === 'card-close') closeCard();
    else if (act === 'go' && card >= 0) {
      const i = card;
      // La pause posée par la carte est levée : la caméra part vers l'œuvre.
      close();
      o.goToWork(i);
    }
  });

  // ---- Ouverture / fermeture -------------------------------------------------------
  let tl: gsap.core.Timeline | null = null;
  function openMap(view = 0) {
    if (open) return selectView(view, true);
    open = true;
    renderTexts();
    buildDots();
    buildViews();
    // Visite : on rend la main au parcours puis on met en pause le temps de la carte.
    pausedByMap = false;
    if (tour.active) {
      if (tour.status().userControl) tour.resume();
      if (!tour.manualPaused) {
        tour.togglePause();
        pausedByMap = true;
      }
    }
    e.backText.innerHTML = tour.active ? 'Retour à<br>la visite' : 'Lancer<br>la visite';
    e.bg.style.background = o.ui().map.background;
    o.onToggle(true);
    tl?.kill();
    gsap.set(el, { autoAlpha: 1 });
    gsap.set(chrome(), { autoAlpha: 0 });
    // 1. Le fond gris glisse sur la vue 3D ; 2. la carte 3D apparaît en fondu dessous.
    tl = gsap
      .timeline()
      .fromTo(e.bg, { xPercent: -100, autoAlpha: 1 }, { xPercent: 0, duration: D(0.6), ease: 'power3.inOut' })
      .add(() => {
        map.open(view);
        selectView(view);
        measureSafe();
        map.update(1);
        lastMobile = o.mobile();
        // Vignettes rendues après une image (programmes de rendu prêts).
        requestAnimationFrame(renderThumbs);
        o.showHand(true, 2);
      })
      .to(e.bg, { autoAlpha: 0, duration: D(0.55), ease: 'power1.inOut' })
      .fromTo(
        [e.head, e.views, e.back, e.home, e.dots],
        { autoAlpha: 0, y: 12 },
        { autoAlpha: 1, y: 0, duration: D(0.5), ease: 'power2.out', stagger: D(0.05), clearProps: 'transform' },
        '<0.1',
      )
      .add(fadeButtons);
  }
  function renderThumbs() {
    try {
      map.thumbnails(canvases);
    } catch (err) {
      console.warn('[carte] vignettes indisponibles', err);
    }
  }
  /** `resume` : relance la visite mise en pause par la carte. */
  function close(resume = true) {
    if (!open) return;
    open = false;
    closeCard();
    o.hideHand();
    if (resume && pausedByMap && tour.active && tour.manualPaused) tour.togglePause();
    pausedByMap = false;
    tl?.kill();
    // 1. La carte 3D s'efface dans le fond gris ; 2. le fond glisse et découvre la visite.
    tl = gsap
      .timeline()
      .to(chrome(), { autoAlpha: 0, duration: D(0.2), ease: 'power2.in' })
      .fromTo(e.bg, { xPercent: 0, autoAlpha: 0 }, { autoAlpha: 1, duration: D(0.4), ease: 'power1.inOut' }, '<')
      .add(() => {
        map.close();
        o.onToggle(false);
      })
      .to(e.bg, { xPercent: 100, duration: D(0.6), ease: 'power3.inOut' })
      .set(el, { autoAlpha: 0 });
  }

  // ---- Chaque image -------------------------------------------------------------------
  let measureT = 0;
  let lastMobile = false;
  const tmp = new Vector3();
  function update(dt: number) {
    if (!open || !map.active) return;
    if (o.mobile() !== lastMobile) {
      lastMobile = o.mobile();
      map.refresh();
      map.setView(map.view);
      measureSafe();
      requestAnimationFrame(renderThumbs);
      fadeButtons();
    }
    measureT += dt;
    if (measureT > 0.5) {
      measureT = 0;
      measureSafe();
    }
    // Points des œuvres et encart suivent la vue (zoom, déplacement).
    let cardPos: { x: number; y: number } | null = null;
    dots.forEach((d, i) => {
      const p = map.project(d.pos, tmp);
      d.el.style.visibility = p ? '' : 'hidden';
      if (p) d.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      if (i === card) cardPos = p;
    });
    if (card >= 0 && !o.mobile()) placeCard(cardPos);
  }
  function placeCard(p: { x: number; y: number } | null) {
    if (!p) return;
    const W = o.root.clientWidth;
    const H = o.root.clientHeight;
    const cw = e.card.offsetWidth;
    const ch = e.card.offsetHeight;
    const right = p.x + 24 + cw < W - 16;
    const x = right ? p.x + 24 : p.x - 24 - cw;
    const y = Math.min(Math.max(p.y - ch / 2, 16), H - ch - 16);
    e.card.style.left = `${x}px`;
    e.card.style.top = `${y}px`;
  }

  return {
    open: openMap,
    close,
    get isOpen() {
      return open;
    },
    update,
    /** Réglages ou œuvres modifiés (back-office). */
    refresh() {
      if (!open) return;
      renderTexts();
      buildDots();
      const current = map.view;
      buildViews();
      viewBtns.forEach((b, j) => b.classList.toggle('is-current', j === current));
      map.refresh();
      requestAnimationFrame(renderThumbs);
    },
    onKey(ev: KeyboardEvent) {
      if (!open) return false;
      if (ev.key === 'Escape') {
        if (card >= 0) closeCard();
        else close();
        return true;
      }
      if (ev.key === '+' || ev.key === '=') map.zoomAt(o.root.clientWidth / 2, o.root.clientHeight / 2, 1.4);
      else if (ev.key === '-') map.zoomAt(o.root.clientWidth / 2, o.root.clientHeight / 2, 1 / 1.4);
      else return false;
      return true;
    },
    dispose() {
      gsap.killTweensOf(el.querySelectorAll('*'));
      el.remove();
    },
  };
}

export type MapUi = ReturnType<typeof createMapUi>;
