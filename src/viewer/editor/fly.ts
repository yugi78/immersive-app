import { Euler, Vector3, type PerspectiveCamera } from 'three';

/**
 * Vol libre (back-office) : déplacement au clavier, regard au clic droit maintenu.
 * Touches lues par position physique (e.code) : ZQSD sur AZERTY = WASD sur QWERTY ;
 * A / E (AZERTY) pour descendre / monter ; Maj pour aller 4× plus vite.
 * La molette règle la vitesse. Actif seulement quand la souris survole la vue.
 */
export function createFly(camera: PerspectiveCamera, dom: HTMLElement, onSpeed?: (speed: number) => void) {
  let enabled = false;
  let speed = 3; // m/s
  let hover = false;
  let looking: number | null = null;
  let lastX = 0;
  let lastY = 0;
  const keys = new Set<string>();
  const euler = new Euler(0, 0, 0, 'YXZ');
  const move = new Vector3();

  const isTyping = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  };
  const keyDown = (e: KeyboardEvent) => {
    if (!enabled || !hover || isTyping(e)) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
      keys.add(e.code);
      e.preventDefault();
    }
  };
  const keyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const blur = () => keys.clear();
  const enter = () => (hover = true);
  const leave = () => {
    hover = false;
    keys.clear();
  };
  const down = (e: PointerEvent) => {
    if (!enabled || e.button !== 2) return;
    looking = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    dom.setPointerCapture(e.pointerId);
  };
  const pmove = (e: PointerEvent) => {
    if (e.pointerId !== looking) return;
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= (e.clientX - lastX) * 0.003;
    euler.x = Math.max(-1.5, Math.min(1.5, euler.x - (e.clientY - lastY) * 0.003));
    camera.quaternion.setFromEuler(euler);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId === looking) looking = null;
  };
  const wheel = (e: WheelEvent) => {
    if (!enabled) return;
    e.preventDefault();
    speed = Math.min(Math.max(speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.2), 60);
    onSpeed?.(speed);
  };
  const menu = (e: Event) => enabled && e.preventDefault();

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  dom.addEventListener('pointerenter', enter);
  dom.addEventListener('pointerleave', leave);
  dom.addEventListener('pointerdown', down);
  dom.addEventListener('pointermove', pmove);
  dom.addEventListener('pointerup', up);
  dom.addEventListener('wheel', wheel, { passive: false });
  dom.addEventListener('contextmenu', menu);

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on: boolean) {
      enabled = on;
      keys.clear();
      looking = null;
    },
    setSpeed(v: number) {
      speed = v;
    },
    update(dt: number) {
      if (!enabled) return;
      move.set(
        (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
        (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
        (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0),
      );
      if (move.lengthSq() === 0) return;
      const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
      // Avant / côté dans le repère de la caméra ; haut / bas toujours vertical.
      const vertical = move.y;
      move.y = 0;
      move.normalize().applyQuaternion(camera.quaternion);
      move.y += vertical;
      camera.position.addScaledVector(move, speed * fast * dt);
    },
    dispose() {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      dom.removeEventListener('pointerenter', enter);
      dom.removeEventListener('pointerleave', leave);
      dom.removeEventListener('pointerdown', down);
      dom.removeEventListener('pointermove', pmove);
      dom.removeEventListener('pointerup', up);
      dom.removeEventListener('wheel', wheel);
      dom.removeEventListener('contextmenu', menu);
    },
  };
}
