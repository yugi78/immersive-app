import { DirectionalLight, HemisphereLight, MathUtils, Vector3, type Scene } from 'three';
import type { SceneConfig } from '../config/types';

/** Éclairage léger : hémisphère + soleil, sans ombres temps réel (AO bakée dans les textures). */
export function addLighting(scene: Scene, cfg: SceneConfig['lighting'], target: Vector3) {
  const { hemisphere: h, sun: s } = cfg;
  scene.add(new HemisphereLight(h.sky, h.ground, h.intensity));

  const sun = new DirectionalLight(s.color, s.intensity);
  const az = MathUtils.degToRad(s.azimuthDeg);
  const el = MathUtils.degToRad(s.elevationDeg);
  sun.position.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(500).add(target);
  sun.target.position.copy(target);
  scene.add(sun, sun.target);
}
