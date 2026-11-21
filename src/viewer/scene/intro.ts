import { MathUtils, type PerspectiveCamera, type Vector3 } from 'three';
import type { SceneConfig } from '../config/types';
import type { SceneReference } from './reference';

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * Ease-in-out asymétrique : départ en douceur mais accélération rapide, puis
 * longue approche finale. La caméra parcourt ~80 % du trajet à mi-durée.
 */
const introEase = (t: number) => easeInOutCubic(Math.pow(t, 0.65));

/**
 * Intro : la caméra part du ciel (startHeightAboveGround au-dessus du sol,
 * startDistance horizontale du Panthéon) et rejoint la position orbitale de
 * départ en décrivant un arc de sweepDeg autour du monument, dans le sens de
 * l'autoRotate qui prend le relais. Elle vise le centre en continu.
 */
export function createIntro(
  camera: PerspectiveCamera,
  cfg: SceneConfig['intro'],
  ref: SceneReference,
  end: Vector3,
) {
  const c = ref.focus;
  // Coordonnées cylindriques autour de l'axe vertical passant par le centre.
  const endAz = Math.atan2(end.x - c.x, end.z - c.z);
  const endR = Math.hypot(end.x - c.x, end.z - c.z);
  // L'autoRotate d'OrbitControls fait décroître l'azimut : on arrive donc depuis un azimut plus grand.
  const startAz = endAz + MathUtils.degToRad(cfg.sweepDeg);
  const startR = cfg.startDistance;
  const startY = ref.groundY + cfg.startHeightAboveGround;

  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : cfg.durationMs / 1000;
  let elapsed = 0;
  let done = false;

  function place(e: number) {
    const az = MathUtils.lerp(startAz, endAz, e);
    const r = MathUtils.lerp(startR, endR, e);
    camera.position.set(c.x + Math.sin(az) * r, MathUtils.lerp(startY, end.y, e), c.z + Math.cos(az) * r);
    camera.lookAt(c);
  }
  place(0);

  return {
    get done() {
      return done;
    },
    /** Avance l'animation ; renvoie true à la dernière image. */
    update(delta: number): boolean {
      if (done) return false;
      elapsed += delta;
      const t = duration > 0 ? Math.min(elapsed / duration, 1) : 1;
      if (t >= 1) {
        camera.position.copy(end);
        camera.lookAt(c);
        done = true;
      } else {
        place(introEase(t));
      }
      return done;
    },
  };
}
