import type { StartConfig } from '../config/types';
import { withBase } from '../url';

/**
 * Écran de démarrage : titre, description, image de fond (ou la scène derrière un
 * voile), bouton « Entrer » qui sert aussi de barre de chargement. Le scénario
 * (intro, boucle…) ne démarre qu'au clic.
 *
 * Même interface que la barre de chargement (set / error / hide) : il la remplace
 * quand il est affiché. `hide()` = chargement terminé → bouton actif.
 */
export function createStartScreen(container: HTMLElement, initial: StartConfig) {
  const root = document.createElement('div');
  root.className = 'pv-splash';
  root.innerHTML = `
    <div class="pv-splash__bg"></div>
    <div class="pv-splash__shade"></div>
    <div class="pv-splash__content">
      <h1 class="pv-splash__title"></h1>
      <div class="pv-splash__desc"></div>
      <button type="button" class="pv-splash__btn" disabled>
        <span class="pv-splash__fill"></span>
        <span class="pv-splash__label"></span>
      </button>
    </div>`;
  container.appendChild(root);
  const bg = root.querySelector<HTMLElement>('.pv-splash__bg')!;
  const title = root.querySelector<HTMLElement>('.pv-splash__title')!;
  const desc = root.querySelector<HTMLElement>('.pv-splash__desc')!;
  const btn = root.querySelector<HTMLButtonElement>('.pv-splash__btn')!;
  const fill = root.querySelector<HTMLElement>('.pv-splash__fill')!;
  const label = root.querySelector<HTMLElement>('.pv-splash__label')!;

  let cfg = initial;
  let loaded = false;
  let ratio = 0;
  let resolveEnter!: () => void;
  const entered = new Promise<void>((r) => (resolveEnter = r));

  function render() {
    title.textContent = cfg.title;
    title.hidden = !cfg.title;
    desc.innerHTML = cfg.description ?? '';
    desc.hidden = !desc.textContent?.trim() && !desc.querySelector('img');
    root.classList.toggle('has-image', !!cfg.image);
    bg.style.backgroundImage = cfg.image ? `url("${withBase(cfg.image).replace(/"/g, '%22')}")` : '';
    label.textContent = loaded ? cfg.button || 'Entrer' : `Chargement… ${Math.round(ratio * 100)} %`;
  }
  render();
  requestAnimationFrame(() => root.classList.add('is-in'));

  btn.addEventListener('click', () => {
    if (!loaded) return;
    root.classList.add('is-out');
    resolveEnter();
    // transitionend peut ne jamais arriver (onglet en arrière-plan) : retrait de secours.
    window.setTimeout(() => root.remove(), 900);
  });

  return {
    /** Résolue au clic sur le bouton. */
    entered,
    set(r: number) {
      ratio = r;
      fill.style.transform = `scaleX(${r})`;
      if (!loaded) label.textContent = `Chargement… ${Math.round(r * 100)} %`;
    },
    error(message: string) {
      root.classList.add('is-error');
      label.textContent = message;
    },
    /** Chargement terminé : le bouton devient actif. */
    hide() {
      loaded = true;
      fill.style.transform = 'scaleX(1)';
      btn.disabled = false;
      root.classList.add('is-ready');
      render();
    },
    /** Réglages modifiés à chaud (back-office). */
    update(next: StartConfig) {
      cfg = next;
      render();
    },
    dispose() {
      root.remove();
    },
  };
}

export type StartScreen = ReturnType<typeof createStartScreen>;
