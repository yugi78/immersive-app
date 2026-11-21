import { Color, Mesh, Vector3, type Material, type Object3D } from 'three';
import type { SceneConfig } from '../config/types';

type MistConfig = SceneConfig['mist'];

/**
 * Brume d'arrière-plan centrée sur le Panthéon (et non sur la caméra) : un
 * fragment se fond dans `color` selon sa distance horizontale (plan XZ) au
 * centre du Panthéon, de 0 à `startDistance` jusqu'à 1 à `endDistance`. La
 * ville lointaine s'estompe donc toujours au même endroit, quel que soit le
 * point de vue. Injectée dans le fragment shader, coût constant.
 *
 * Se chaîne avec un onBeforeCompile existant (découpe) : appliquer la brume
 * APRÈS la découpe, qui écrase onBeforeCompile.
 */
export function createMist(initial: MistConfig, center: Vector3) {
  const cfg = { ...initial };
  const uniforms = {
    uMistCenter: { value: center.clone() },
    uMistStart: { value: cfg.startDistance },
    uMistEnd: { value: cfg.endDistance },
    uMistColor: { value: new Color(cfg.color) },
  };

  const vertexPars = /* glsl */ `
    varying vec3 vMistWorld;`;
  const vertexMain = /* glsl */ `
    #include <project_vertex>
    vMistWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

  const fragmentPars = /* glsl */ `
    varying vec3 vMistWorld;
    uniform vec3 uMistCenter;
    uniform float uMistStart;
    uniform float uMistEnd;
    uniform vec3 uMistColor;`;
  const fragmentMist = /* glsl */ `
    #include <opaque_fragment>
    // Mélange en couleurs linéaires, AVANT la conversion de sortie
    // (<colorspace_fragment>) : juste en rendu direct comme vers une cible
    // intermédiaire (flou de profondeur), et identique au fond de scène.
    {
      float mistD = distance(vMistWorld.xz, uMistCenter.xz);
      float mistF = clamp((mistD - uMistStart) / max(uMistEnd - uMistStart, 1e-3), 0.0, 1.0);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistColor, mistF);
    }`;

  function applyToMaterial(material: Material) {
    const prevCompile = material.onBeforeCompile.bind(material);
    const prevKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      prevCompile(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
${vertexPars}`)
        .replace('#include <project_vertex>', vertexMain);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
${fragmentPars}`)
        .replace('#include <opaque_fragment>', fragmentMist);
    };
    material.customProgramCacheKey = () => `${prevKey()}|mist`;
    material.needsUpdate = true;
  }

  // Partagé entre les appels : un matériau commun à plusieurs assets n'est injecté qu'une fois.
  const done = new WeakSet<Material>();
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

  /** Modifie des réglages à chaud (back-office) et répercute sur les uniforms. */
  function set(patch: Partial<MistConfig>) {
    Object.assign(cfg, patch);
    uniforms.uMistStart.value = cfg.startDistance;
    uniforms.uMistEnd.value = cfg.endDistance;
    uniforms.uMistColor.value.set(cfg.color);
  }

  return { uniforms, settings: cfg as Readonly<MistConfig>, apply, set };
}
