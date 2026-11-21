/**
 * Regard libre pendant la visite : glisser (souris ou un doigt) fait pivoter la
 * caméra sur place, sans la déplacer (pas de risque de traverser un pilier).
 * Renvoie un décalage lacet / tangage, ramené en douceur à zéro par la visite.
 */
export function createLookAround(dom: HTMLElement, onInteract: () => void) {
  const state = { yaw: 0, pitch: 0, enabled: false };
  let dragging: number | null = null;
  let lastX = 0;
  let lastY = 0;
  const MAX_PITCH = 1.2;

  const down = (e: PointerEvent) => {
    if (!state.enabled || dragging !== null || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
    dragging = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    dom.setPointerCapture(e.pointerId);
    onInteract();
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== dragging) return;
    // ~180° pour une largeur d'écran.
    const k = Math.PI / Math.max(dom.clientWidth, 1);
    state.yaw += (e.clientX - lastX) * k;
    state.pitch = Math.min(Math.max(state.pitch + (e.clientY - lastY) * k, -MAX_PITCH), MAX_PITCH);
    lastX = e.clientX;
    lastY = e.clientY;
    onInteract();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== dragging) return;
    dragging = null;
    onInteract();
  };
  const noMenu = (e: Event) => state.enabled && e.preventDefault();

  dom.addEventListener('pointerdown', down);
  dom.addEventListener('pointermove', move);
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', up);
  dom.addEventListener('contextmenu', noMenu);

  return {
    state,
    get dragging() {
      return dragging !== null;
    },
    /** Ramène le regard vers l'axe de la visite (amortissement exponentiel). */
    relax(dt: number, rate = 2.5) {
      const k = Math.exp(-rate * dt);
      state.yaw *= k;
      state.pitch *= k;
    },
    reset() {
      state.yaw = 0;
      state.pitch = 0;
    },
    dispose() {
      dom.removeEventListener('pointerdown', down);
      dom.removeEventListener('pointermove', move);
      dom.removeEventListener('pointerup', up);
      dom.removeEventListener('pointercancel', up);
      dom.removeEventListener('contextmenu', noMenu);
    },
  };
}
