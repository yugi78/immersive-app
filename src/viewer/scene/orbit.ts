import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ControlStep, SceneConfig } from '../config/types';
import type { SceneReference } from './reference';

/** Caméra (objectif) ; sa position de départ est posée par le scénario. */
export function createCamera(cfg: SceneConfig['camera'], aspect: number) {
  return new PerspectiveCamera(cfg.fov, aspect, cfg.near, cfg.far);
}

/**
 * Vue orbitale autour du point de focus (prise en main du scénario). La rotation
 * automatique et l'inactivité sont gérées par le scénario (scene/scenario.ts). La
 * caméra ne descend jamais sous le sol (min.y de la bbox + marge).
 */
export function createOrbit(
  camera: PerspectiveCamera,
  dom: HTMLElement,
  cfg: Pick<ControlStep, 'dampingFactor' | 'minDistance' | 'maxDistance' | 'autoRotateSpeed' | 'groundMargin'>,
  ref: SceneReference,
) {
  const controls = new OrbitControls(camera, dom);
  controls.target.copy(ref.focus);
  controls.enableDamping = true;
  controls.dampingFactor = cfg.dampingFactor;
  controls.minDistance = cfg.minDistance;
  controls.maxDistance = cfg.maxDistance;
  // Désactivés tant que le scénario pilote la caméra.
  controls.enabled = false;
  controls.autoRotate = false;
  controls.autoRotateSpeed = cfg.autoRotateSpeed;
  controls.screenSpacePanning = false;

  let minY = ref.groundY + cfg.groundMargin;

  /** Réglages modifiés à chaud (back-office). */
  function set(next: Pick<ControlStep, 'dampingFactor' | 'minDistance' | 'maxDistance' | 'autoRotateSpeed' | 'groundMargin'>) {
    controls.dampingFactor = next.dampingFactor;
    controls.minDistance = next.minDistance;
    controls.maxDistance = next.maxDistance;
    controls.autoRotateSpeed = next.autoRotateSpeed;
    minY = ref.groundY + next.groundMargin;
  }

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
    controls.dispose();
  }

  return { controls, update, set, dispose };
}
