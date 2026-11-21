import type { Tour, TourStatus } from '../tour/tour';

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" class="fill"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

/**
 * Commandes publiques de la visite : bouton « Visite » en bas au centre ;
 * en visite, précédent | pause | suivant au centre et stop à droite.
 * Clavier : ← →, Espace, Échap. Hash d'URL par œuvre (#slug).
 */
export function createTourControls(container: HTMLElement, tour: Tour, opts: { hash: boolean }) {
  const root = document.createElement('div');
  root.className = 'pv-tour';
  root.innerHTML = `
    <div class="pv-tour__title" aria-live="polite"></div>
    <button type="button" class="pv-tour__start">Visite</button>
    <div class="pv-tour__bar" hidden>
      <button type="button" data-act="prev" aria-label="Œuvre précédente">${ICONS.prev}</button>
      <button type="button" data-act="pause" aria-label="Pause">${ICONS.pause}</button>
      <button type="button" data-act="next" aria-label="Œuvre suivante">${ICONS.next}</button>
    </div>
    <button type="button" class="pv-tour__stop" data-act="stop" aria-label="Quitter la visite" hidden>${ICONS.stop}</button>`;
  container.appendChild(root);

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const startBtn = $('.pv-tour__start');
  const bar = $('.pv-tour__bar');
  const stopBtn = $('.pv-tour__stop');
  const pauseBtn = $('[data-act="pause"]');
  const title = $('.pv-tour__title');

  const actions: Record<string, () => void> = {
    prev: () => tour.prev(),
    next: () => tour.next(),
    pause: () => tour.togglePause(),
    stop: () => tour.stop(),
  };
  startBtn.addEventListener('click', () => tour.start(0));
  root.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) actions[act]();
  });

  const onKey = (e: KeyboardEvent) => {
    if (!tour.active || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const act = { ArrowLeft: 'prev', ArrowRight: 'next', ' ': 'pause', Escape: 'stop' }[e.key];
    if (!act) return;
    e.preventDefault();
    actions[act]();
  };
  window.addEventListener('keydown', onKey);

  // Hash d'URL : #slug de l'œuvre courante ; un lien direct (ou « retour ») y mène.
  const setHash = (slug: string | null) => {
    if (!opts.hash) return;
    const want = slug ? `#${slug}` : '';
    if (location.hash !== want) history.replaceState(null, '', want || location.pathname + location.search);
  };
  let indexOfSlug = (_slug: string) => -1;
  const workFromHash = () => {
    const slug = decodeURIComponent(location.hash.slice(1));
    return slug ? indexOfSlug(slug) : -1;
  };
  const onHash = () => {
    const i = workFromHash();
    if (i < 0) return;
    if (tour.active) {
      if (tour.status().index !== i) tour.goTo(i);
    } else {
      tour.start(i);
    }
  };
  if (opts.hash) window.addEventListener('hashchange', onHash);

  let wasActive = false;
  function render(s: TourStatus) {
    const active = s.state !== 'idle';
    const leaving = s.state === 'exit';
    startBtn.hidden = active;
    bar.hidden = !active || leaving;
    stopBtn.hidden = !active || leaving;
    root.classList.toggle('is-active', active && !leaving);
    title.textContent = active && !leaving ? (s.work?.title ?? '') : '';
    pauseBtn.innerHTML = s.paused ? ICONS.play : ICONS.pause;
    pauseBtn.setAttribute('aria-label', s.paused ? 'Reprendre' : 'Pause');
    if (active && !leaving && s.work) setHash(s.work.slug);
    // Hash retiré seulement en quittant la visite (jamais au chargement : lien direct).
    else if (!active && wasActive) setHash(null);
    wasActive = active;
  }
  const off = tour.onChange(render);
  render(tour.status());

  return {
    /** Liste des œuvres (pour le hash) ; masque le bouton s'il n'y en a aucune. */
    setWorks(slugs: string[]) {
      indexOfSlug = (slug) => slugs.indexOf(slug);
      root.classList.toggle('is-empty', slugs.length === 0);
    },
    /** Œuvre demandée par le hash au chargement, ou -1. */
    initialIndex: () => (opts.hash ? workFromHash() : -1),
    dispose() {
      off();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
      root.remove();
    },
  };
}
