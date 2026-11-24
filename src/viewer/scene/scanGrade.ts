import { Mesh, type Material, type Object3D } from 'three';
import type { SceneConfig } from '../config/types';

type ScanGradeConfig = SceneConfig['scanGrade'];

/**
 * Réglage colorimétrique des textures du scan : saturation, contraste, ombres,
 * hautes lumières. Quelques opérations par pixel dans le shader, appliquées à
 * n'importe quel niveau de texture (LOD) : aucun coût de chargement ni de mémoire.
 *
 * Toutes les tuiles partagent les mêmes uniforms. Injecté juste après la lecture
 * de la texture (<map_fragment>), avant la couleur de coupe des faces arrière.
 * Calculs en espace sRGB approché (gamma 2.2), plus intuitif.
 *
 * Se chaîne avec un onBeforeCompile existant : appliquer APRÈS la découpe.
 */
export function createScanGrade(initial: ScanGradeConfig) {
  const cfg = { ...initial };
  const uniforms = {
    uScanSaturation: { value: 1 },
    uScanContrast: { value: 1 },
    uScanShadows: { value: 0 },
    uScanHighlights: { value: 0 },
  };

  const fragmentPars = /* glsl */ `
    uniform float uScanSaturation;
    uniform float uScanContrast;
    uniform float uScanShadows;
    uniform float uScanHighlights;`;
  const fragmentGrade = /* glsl */ `
    #include <map_fragment>
    {
      vec3 g = pow(max(diffuseColor.rgb, 0.0), vec3(1.0 / 2.2));
      float luma = dot(g, vec3(0.2126, 0.7152, 0.0722));
      g = mix(vec3(luma), g, uScanSaturation);
      g = (g - 0.5) * uScanContrast + 0.5;
      // Ombres / hautes lumières : décalage pondéré par la luminance d'origine
      // (tons sombres d'un côté, tons clairs de l'autre), comme en retouche photo.
      float wS = 1.0 - smoothstep(0.0, 0.55, luma);
      float wH = smoothstep(0.45, 1.0, luma);
      g += vec3(uScanShadows * wS + uScanHighlights * wH) * 0.35;
      diffuseColor.rgb = pow(clamp(g, 0.0, 1.0), vec3(2.2));
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
    material.customProgramCacheKey = () => `${prevKey()}|scanGrade`;
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
    uniforms.uScanSaturation.value = cfg.saturation;
    uniforms.uScanContrast.value = cfg.contrast;
    uniforms.uScanShadows.value = cfg.shadows;
    uniforms.uScanHighlights.value = cfg.highlights;
  }
  sync();

  /** Modifie des réglages à chaud (back-office) et répercute sur les uniforms. */
  function set(patch: Partial<ScanGradeConfig>) {
    Object.assign(cfg, patch);
    sync();
  }

  return { uniforms, settings: cfg as Readonly<ScanGradeConfig>, apply, set };
}
