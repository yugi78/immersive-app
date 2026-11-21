import { Mesh, type Material, type Object3D } from 'three';
import type { SceneConfig } from '../config/types';

type ClayConfig = SceneConfig['clay'];

/**
 * Réglage colorimétrique commun aux maquettes clay (ville, Panthéon, sol) :
 * teinte, saturation, contraste, luminosité, gamma. Tous les matériaux
 * partagent les mêmes uniforms : un réglage agit sur les trois à la fois.
 *
 * Appliqué juste après la lecture de la texture (<map_fragment>), donc avant
 * la couleur de coupe des faces arrière (<color_fragment>), qui reste intacte.
 * Les calculs se font en espace sRGB approché (gamma 2.2), plus intuitif.
 *
 * Se chaîne avec un onBeforeCompile existant : appliquer APRÈS la découpe.
 */
export function createClayGrade(initial: ClayConfig) {
  const cfg = { ...initial };
  const uniforms = {
    uGradeHue: { value: 0 },
    uGradeSaturation: { value: 1 },
    uGradeContrast: { value: 1 },
    uGradeBrightness: { value: 0 },
    uGradeGamma: { value: 1 },
  };

  const fragmentPars = /* glsl */ `
    uniform float uGradeHue;
    uniform float uGradeSaturation;
    uniform float uGradeContrast;
    uniform float uGradeBrightness;
    uniform float uGradeGamma;`;
  const fragmentGrade = /* glsl */ `
    #include <map_fragment>
    {
      vec3 g = pow(max(diffuseColor.rgb, 0.0), vec3(1.0 / 2.2));
      // Teinte : rotation autour de l'axe des gris (formule de Rodrigues).
      const vec3 k = vec3(0.57735);
      float ca = cos(uGradeHue), sa = sin(uGradeHue);
      g = g * ca + cross(k, g) * sa + k * dot(k, g) * (1.0 - ca);
      float luma = dot(g, vec3(0.2126, 0.7152, 0.0722));
      g = mix(vec3(luma), g, uGradeSaturation);
      g = (g - 0.5) * uGradeContrast + 0.5;
      g += uGradeBrightness;
      g = pow(clamp(g, 0.0, 1.0), vec3(1.0 / uGradeGamma));
      diffuseColor.rgb = pow(g, vec3(2.2));
    }`;

  const done = new WeakSet<Material>();
  function applyToMaterial(material: Material) {
    const prevCompile = material.onBeforeCompile.bind(material);
    const prevKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      prevCompile(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
${fragmentPars}`)
        .replace('#include <map_fragment>', fragmentGrade);
    };
    material.customProgramCacheKey = () => `${prevKey()}|clayGrade`;
    material.needsUpdate = true;
  }

  function apply(root: Object3D) {
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (done.has(m)) continue;
        done.add(m);
        applyToMaterial(m);
      }
    });
  }

  function sync() {
    uniforms.uGradeHue.value = (cfg.hue * Math.PI) / 180;
    uniforms.uGradeSaturation.value = cfg.saturation;
    uniforms.uGradeContrast.value = cfg.contrast;
    uniforms.uGradeBrightness.value = cfg.brightness;
    uniforms.uGradeGamma.value = Math.max(cfg.gamma, 0.01);
  }
  sync();

  /** Modifie des réglages à chaud (back-office) et répercute sur les uniforms. */
  function set(patch: Partial<ClayConfig>) {
    Object.assign(cfg, patch);
    sync();
  }

  return { uniforms, settings: cfg as Readonly<ClayConfig>, apply, set };
}
