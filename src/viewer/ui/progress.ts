/** Barre de progression du chargement, masquée une fois tous les assets prêts. */
export function createProgress(container: HTMLElement) {
  const root = document.createElement('div');
  root.className = 'pv-loader';
  root.innerHTML = `
    <div class="pv-loader__label">Chargement de la maquette… <span>0 %</span></div>
    <div class="pv-loader__track"><div class="pv-loader__bar"></div></div>`;
  container.appendChild(root);
  const bar = root.querySelector<HTMLElement>('.pv-loader__bar')!;
  const pct = root.querySelector<HTMLElement>('span')!;

  return {
    set(ratio: number) {
      const p = Math.round(ratio * 100);
      bar.style.transform = `scaleX(${ratio})`;
      pct.textContent = `${p} %`;
    },
    error(message: string) {
      root.classList.add('is-error');
      root.querySelector('.pv-loader__label')!.textContent = message;
    },
    hide() {
      root.classList.add('is-done');
      // transitionend peut ne jamais arriver (onglet en arrière-plan) : retrait de secours.
      window.setTimeout(() => root.remove(), 800);
    },
  };
}
