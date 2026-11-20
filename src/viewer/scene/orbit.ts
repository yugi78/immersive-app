import { MathUtils, PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneConfig } from '../config/types';
import type { SceneReference } from './reference';

export function createCamera(cfg: SceneConfig['camera'], ref: SceneReference, aspect: number) {
  const camera = new PerspectiveCamera(cfg.fov, aspect, cfg.near, cfg.far);
  const { distance, azimuthDeg, elevationDeg } = cfg.start;
  const az = MathUtils.degToRad(azimuthDeg);
  const el = MathUtils.degToRad(elevationDeg);
  camera.position
    .set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
    .multiplyScalar(distance)
    .add(ref.center);
  camera.lookAt(ref.center);
  return camera;
}

/**
 * Vue orbitale autour du centre du Panthéon : autoRotate lent, coupé dès que
 * l'utilisateur prend la main, repris après un délai d'inactivité. La caméra
 * ne descend jamais sous le sol (min.y de la bbox + marge).
 */
export function createOrbit(
  camera: PerspectiveCamera,
  dom: HTMLElement,
  cfg: SceneConfig['orbit'],
  ref: SceneReference,
) {
  const controls = new OrbitControls(camera, dom);
  controls.target.copy(ref.center);
  controls.enableDamping = true;
  controls.dampingFactor = cfg.dampingFactor;
  controls.minDistance = cfg.minDistance;
  controls.maxDistance = cfg.maxDistance;
  controls.autoRotate = true;
  controls.autoRotateSpeed = cfg.autoRotateSpeed;
  controls.screenSpacePanning = false;

  let resumeTimer: number | undefined;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    window.clearTimeout(resumeTimer);
  });
  controls.addEventListener('end', () => {
    window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(() => (controls.autoRotate = true), cfg.autoRotateResumeDelayMs);
  });

  const minY = ref.groundY + cfg.groundMargin;

  function update(delta: number) {
    controls.update(delta);
    // Contrainte de sol, quel que soit le zoom ou l'angle.
    if (camera.position.y < minY) {
      camera.position.y = minY;
      // La cible ne doit pas non plus passer sous le sol (pan).
      if (controls.target.y < minY) controls.target.y = minY;
      camera.lookAt(controls.target);
    }
  }

  function dispose() {
    window.clearTimeout(resumeTimer);
    controls.dispose();
  }

  return { controls, update, dispose };
}
