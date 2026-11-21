import {
  DepthTexture,
  HalfFloatType,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { SceneConfig } from '../config/types';

type DofConfig = SceneConfig['dof'];

/**
 * Flou de profondeur de champ, désactivable.
 *
 * La scène est rendue une fois dans une cible intermédiaire (couleur + texture de
 * profondeur), puis un quad plein écran floute chaque pixel selon sa distance au
 * plan de netteté. La profondeur vient du rendu réel : la découpe (discard) est
 * respectée, contrairement au BokehPass de Three qui re-rend la scène avec un
 * matériau de profondeur générique, sans découpe.
 *
 * Désactivé, rien n'est alloué et le rendu reste direct (coût nul).
 */
export function createDof(renderer: WebGLRenderer, initial: DofConfig, samples: number) {
  const cfg = { ...initial };
  let target: WebGLRenderTarget | null = null;
  const size = new Vector2();

  const material = new ShaderMaterial({
    defines: { SAMPLES: samples },
    uniforms: {
      tColor: { value: null },
      tDepth: { value: null },
      uTexel: { value: new Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uFocus: { value: cfg.focusDistance },
      uRange: { value: cfg.focusRange },
      uAperture: { value: cfg.aperture },
      uMaxBlur: { value: cfg.maxBlur },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      #include <packing>
      varying vec2 vUv;
      uniform sampler2D tColor;
      uniform sampler2D tDepth;
      uniform vec2 uTexel;
      uniform float uNear;
      uniform float uFar;
      uniform float uFocus;
      uniform float uRange;
      uniform float uAperture;
      uniform float uMaxBlur;

      // Rayon de flou (en pixels) d'un point situé à la distance d de la caméra :
      // nul dans la zone nette [focus ± range/2], puis croissant comme une lentille
      // mince (|d - f| / d), plafonné à uMaxBlur.
      float coc(vec2 uv) {
        float d = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
        float off = max(abs(d - uFocus) - 0.5 * uRange, 0.0);
        return uMaxBlur * clamp(uAperture * off / max(d, 1e-3), 0.0, 1.0);
      }

      void main() {
        float c0 = coc(vUv);
        vec4 sum = vec4(texture2D(tColor, vUv).rgb, 1.0);
        // Disque échantillonné en spirale d'angle d'or, rayon = flou du pixel.
        // Un échantillon net ne déborde pas sur un voisin flou : il ne compte que
        // si son propre flou atteint la distance qui le sépare du pixel.
        const float GOLDEN = 2.39996323;
        for (int i = 1; i < SAMPLES; i++) {
          float fi = float(i);
          float r = c0 * sqrt(fi / float(SAMPLES));
          vec2 uv = vUv + vec2(cos(fi * GOLDEN), sin(fi * GOLDEN)) * r * uTexel;
          float ci = coc(uv);
          float w = clamp(ci - r + 1.0, 0.0, 1.0);
          sum += vec4(texture2D(tColor, uv).rgb * w, w);
        }
        gl_FragColor = vec4(sum.rgb / sum.a, 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(material);

  function ensureTarget() {
    renderer.getDrawingBufferSize(size);
    if (target && target.width === size.x && target.height === size.y) return target;
    target?.dispose();
    target = new WebGLRenderTarget(size.x, size.y, {
      type: HalfFloatType,
      // MSAA conservé (le rendu direct est antialiasé) ; la profondeur est résolue avec.
      samples: 4,
      depthTexture: new DepthTexture(size.x, size.y),
    });
    material.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    return target;
  }

  function release() {
    target?.dispose();
    target?.depthTexture?.dispose();
    target = null;
  }

  /**
   * Rend la scène, avec ou sans flou. `autoFocusDistance` : distance caméra–cible
   * utilisée quand la mise au point automatique est active.
   */
  function render(scene: Scene, camera: PerspectiveCamera, autoFocusDistance: number) {
    if (!cfg.enabled) {
      if (target) release();
      renderer.render(scene, camera);
      return;
    }
    const rt = ensureTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    const u = material.uniforms;
    u.tColor.value = rt.texture;
    u.tDepth.value = rt.depthTexture;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uFocus.value = cfg.autoFocus ? autoFocusDistance : cfg.focusDistance;
    // Flou exprimé en pixels CSS : identique quelle que soit la densité d'écran.
    u.uMaxBlur.value = cfg.maxBlur * renderer.getPixelRatio();
    quad.render(renderer);
  }

  /** Modifie des réglages à chaud (back-office). */
  function set(patch: Partial<DofConfig>) {
    Object.assign(cfg, patch);
    material.uniforms.uRange.value = cfg.focusRange;
    material.uniforms.uAperture.value = cfg.aperture;
  }

  function dispose() {
    release();
    quad.dispose();
    material.dispose();
  }

  return { settings: cfg as Readonly<DofConfig>, render, set, dispose };
}
