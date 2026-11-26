import { Color, DoubleSide, MathUtils, Mesh, Vector3, type Material, type Object3D } from 'three';
import type { SceneConfig } from '../config/types';

type CutawayConfig = SceneConfig['cutaway'];

/**
 * Découpe « voir à travers les murs », entièrement dans le fragment shader :
 * un fragment situé entre la caméra et la cible, dans un cylindre de rayon
 * `radius` autour de l'axe caméra–cible, est effacé (discard). Le bord est un
 * dégradé obtenu par dithering de Bayer : le matériau reste opaque, sans tri.
 * Coût constant, aucun raycast.
 */
export function createCutaway(initial: CutawayConfig) {
  // Copie modifiable (tirettes de réglage) ; la config d'origine reste intacte.
  const cfg = { ...initial };
  const uniforms = {
    uCutCam: { value: new Vector3() },
    uCutTarget: { value: new Vector3() },
    uCutRadius: { value: cfg.radius },
    uCutFeather: { value: cfg.feather },
    uCutSphere: { value: cfg.cameraRadius },
    // Sphère des transitions entre œuvres : rayon, dégradé, intensité (0–1, pilotée par la visite).
    uTransitRadius: { value: cfg.transitRadius ?? 8 },
    uTransitFeather: { value: cfg.transitFeather ?? 3 },
    uTransitStrength: { value: 0 },
    uCutStrength: { value: 0 },
    uCutColor: { value: new Color(cfg.cutColor) },
  };

  const vertexPars = /* glsl */ `
    varying vec3 vCutWorld;`;
  const vertexMain = /* glsl */ `
    #include <project_vertex>
    vCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

  const fragmentPars = /* glsl */ `
    varying vec3 vCutWorld;
    uniform vec3 uCutCam;
    uniform vec3 uCutTarget;
    uniform float uCutRadius;
    uniform float uCutFeather;
    uniform float uCutSphere;
    uniform float uTransitRadius;
    uniform float uTransitFeather;
    uniform float uTransitStrength;
    uniform float uCutStrength;
    uniform vec3 uCutColor;

    float cutBayer4(vec2 p) {
      ivec2 i = ivec2(mod(floor(p), 4.0));
      const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
      return (m[i.x + i.y * 4] + 0.5) / 16.0;
    }`;
  const fragmentCut = /* glsl */ `
    #include <clipping_planes_fragment>
    // Position du fragment dans le repère du cylindre : t le long de l'axe
    // caméra (0) → cible (1), d la distance à l'axe en mètres.
    vec3 cutAxis = uCutTarget - uCutCam;
    float cutLen = max(length(cutAxis), 1e-3);
    float cutT = dot(vCutWorld - uCutCam, cutAxis) / (cutLen * cutLen);
    float cutD = distance(vCutWorld, uCutCam + cutAxis * cutT);
    bool cutInFront = uCutStrength > 0.0 && cutT > 0.0 && cutT < 1.0;
    if (cutInFront) {
      // 1 au cœur du cylindre, 0 au-delà du rayon, dégradé sur uCutFeather mètres.
      float radial = 1.0 - smoothstep(uCutRadius - uCutFeather, uCutRadius, cutD);
      // Fondu à l'approche de la cible, pour éviter un fond de cylindre net.
      float cap = 1.0 - smoothstep(1.0 - uCutFeather / cutLen, 1.0, cutT);
      if (radial * cap * uCutStrength > cutBayer4(gl_FragCoord.xy)) discard;
    }
    // Sphère autour de la caméra : rien ne s'interpose de près, quel que soit l'angle
    // (passage des murs à l'entrée et à la sortie de la visite). Même intensité que
    // le cylindre, donc éteinte avec lui.
    // Sphère des transitions : tout ce qui entoure la caméra en mouvement s'efface
    // (piliers, murs), avec un dégradé sur uTransitFeather mètres.
    if (uTransitStrength > 0.0 && uTransitRadius > 0.0) {
      float trFeather = min(uTransitFeather, uTransitRadius);
      float tr = 1.0 - smoothstep(uTransitRadius - trFeather, uTransitRadius, distance(vCutWorld, uCutCam));
      if (tr * uTransitStrength > cutBayer4(gl_FragCoord.xy)) discard;
    }
    if (uCutStrength > 0.0 && uCutSphere > 0.0) {
      float sphFeather = min(uCutFeather, uCutSphere * 0.5);
      float sph = 1.0 - smoothstep(uCutSphere - sphFeather, uCutSphere, distance(vCutWorld, uCutCam));
      if (sph * uCutStrength > cutBayer4(gl_FragCoord.xy)) discard;
    }`;
  const fragmentTint = /* glsl */ `
    #include <color_fragment>
    // Épaisseur des murs : toute face arrière visible (mur coupé vu de l'intérieur)
    // est remplie d'une couleur de coupe unie, sans texture ni teinte de sommet.
    if (!gl_FrontFacing) diffuseColor = vec4(uCutColor, 1.0);`;

  /**
   * Injecte la découpe et le remplissage des faces arrière dans un matériau
   * (MeshBasicMaterial, donc sans éclairage) et le passe en DoubleSide.
   */
  function applyToMaterial(material: Material) {
    material.side = DoubleSide;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
${vertexPars}`)
        .replace('#include <project_vertex>', vertexMain);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
${fragmentPars}`)
        .replace('#include <clipping_planes_fragment>', fragmentCut)
        .replace('#include <color_fragment>', fragmentTint);
    };
    material.customProgramCacheKey = () => 'cutaway';
    material.needsUpdate = true;
  }

  function apply(root: Object3D) {
    const done = new Set<Material>();
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (done.has(m)) continue;
        done.add(m);
        applyToMaterial(m);
      }
    });
  }

  /**
   * À appeler chaque image : met à jour l'axe et l'intensité selon la distance caméra–cible.
   * `target` est l'extrémité du cylindre (cible d'orbite, ou focus d'une œuvre pendant
   * l'entrée de la visite) ; `scale` (0–1) éteint progressivement la découpe (visite).
   */
  function update(camera: Vector3, target: Vector3, scale = 1) {
    uniforms.uCutCam.value.copy(camera);
    uniforms.uCutTarget.value.copy(target);
    const d = camera.distanceTo(target);
    // Transition progressive : 0 au-delà de fadeStartDistance, 1 en dessous de fadeEndDistance.
    uniforms.uCutStrength.value =
      MathUtils.clamp((cfg.fadeStartDistance - d) / Math.max(cfg.fadeStartDistance - cfg.fadeEndDistance, 1e-3), 0, 1) *
      MathUtils.clamp(scale, 0, 1);
  }

  /** Modifie des réglages à chaud (tirettes, back-office) et répercute sur les uniforms. */
  function set(patch: Partial<CutawayConfig>) {
    Object.assign(cfg, patch);
    uniforms.uCutRadius.value = cfg.radius;
    uniforms.uCutFeather.value = cfg.feather;
    uniforms.uCutSphere.value = cfg.cameraRadius;
    uniforms.uTransitRadius.value = cfg.transitRadius ?? 8;
    uniforms.uTransitFeather.value = cfg.transitFeather ?? 3;
    uniforms.uCutColor.value.set(cfg.cutColor);
  }

  /**
   * Intensité de la sphère autour de la caméra (0 : éteinte, 1 : pleine). Rayon et
   * dégradé : ceux des transitions, ou ceux donnés (vol libre du back-office).
   */
  function setTransit(strength: number, radius?: number, feather?: number) {
    uniforms.uTransitStrength.value = MathUtils.clamp(strength, 0, 1);
    uniforms.uTransitRadius.value = radius ?? cfg.transitRadius ?? 8;
    uniforms.uTransitFeather.value = feather ?? cfg.transitFeather ?? 3;
  }

  return { uniforms, settings: cfg as Readonly<CutawayConfig>, apply, update, set, setTransit };
}
