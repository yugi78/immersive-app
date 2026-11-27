import { Color, DoubleSide, MathUtils, Mesh, Vector3, type Material, type Object3D } from 'three';
import type { CutawayConfig, CutPreset } from '../config/types';

/**
 * Découpe « voir à travers les murs », entièrement dans le fragment shader. Deux
 * formes, réglées à chaque image par la découpe du moment (config/cutaway.ts) :
 * - le cylindre (+ sa petite sphère autour de la caméra), décrit ci-dessous ;
 * - la sphère autour de la caméra (uniforms uTransit*).
 *
 * Cylindre :
 * un fragment situé entre la caméra et la cible, dans un cylindre de rayon
 * `radius` autour de l'axe caméra–cible, est effacé (discard). Le bord est un
 * dégradé obtenu par dithering de Bayer : le matériau reste opaque, sans tri.
 * Coût constant, aucun raycast.
 */
export function createCutaway(initial: CutawayConfig) {
  let cfg = structuredClone(initial);
  const uniforms = {
    uCutCam: { value: new Vector3() },
    uCutTarget: { value: new Vector3() },
    uCutRadius: { value: 0 },
    uCutFeather: { value: 1 },
    uCutSphere: { value: 0 },
    // Sphère autour de la caméra : rayon, dégradé, intensité (0–1).
    uTransitRadius: { value: 4 },
    uTransitFeather: { value: 2 },
    uTransitStrength: { value: 0 },
    uCutStrength: { value: 0 },
    uCutColor: { value: new Color(cfg.cutColor) },
    // Vue de contrôle du back-office : découpe propre à sa caméra (cylindre, sphère).
    uObsCam: { value: new Vector3() },
    uObsTarget: { value: new Vector3() },
    uObsCylR: { value: 0 },
    uObsCylF: { value: 1 },
    uObsCylS: { value: 0 },
    uObsSphR: { value: 0 },
    uObsSphF: { value: 1 },
    uObsSphS: { value: 0 },
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
    uniform float uCutMaskCyl;
    uniform float uCutMaskSph;
    uniform vec3 uObsCam;
    uniform vec3 uObsTarget;
    uniform float uObsCylR;
    uniform float uObsCylF;
    uniform float uObsCylS;
    uniform float uObsSphR;
    uniform float uObsSphF;
    uniform float uObsSphS;
    uniform float uCutMaskObsCyl;
    uniform float uCutMaskObsSph;
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
    // Ce matériau réagit-il aux formes actives ? (abonnement du matériau, 0 ou 1)
    float cutS = uCutStrength * uCutMaskCyl;
    float trS = uTransitStrength * uCutMaskSph;
    bool cutInFront = cutS > 0.0 && cutT > 0.0 && cutT < 1.0;
    if (cutInFront) {
      // 1 au cœur du cylindre, 0 au-delà du rayon, dégradé sur uCutFeather mètres.
      float radial = 1.0 - smoothstep(uCutRadius - uCutFeather, uCutRadius, cutD);
      // Fondu à l'approche de la cible, pour éviter un fond de cylindre net.
      float cap = 1.0 - smoothstep(1.0 - uCutFeather / cutLen, 1.0, cutT);
      if (radial * cap * cutS > cutBayer4(gl_FragCoord.xy)) discard;
    }
    // Sphère autour de la caméra : rien ne s'interpose de près, quel que soit l'angle
    // (passage des murs à l'entrée et à la sortie de la visite). Même intensité que
    // le cylindre, donc éteinte avec lui.
    // Sphère des transitions : tout ce qui entoure la caméra en mouvement s'efface
    // (piliers, murs), avec un dégradé sur uTransitFeather mètres.
    if (trS > 0.0 && uTransitRadius > 0.0) {
      float trFeather = min(uTransitFeather, uTransitRadius);
      float tr = 1.0 - smoothstep(uTransitRadius - trFeather, uTransitRadius, distance(vCutWorld, uCutCam));
      if (tr * trS > cutBayer4(gl_FragCoord.xy)) discard;
    }
    if (cutS > 0.0 && uCutSphere > 0.0) {
      float sphFeather = min(uCutFeather, uCutSphere * 0.5);
      float sph = 1.0 - smoothstep(uCutSphere - sphFeather, uCutSphere, distance(vCutWorld, uCutCam));
      if (sph * cutS > cutBayer4(gl_FragCoord.xy)) discard;
    }
    // Vue de contrôle : cylindre caméra de contrôle -> point visé, sphère autour d'elle.
    float obsCylS = uObsCylS * uCutMaskObsCyl;
    if (obsCylS > 0.0) {
      vec3 oAxis = uObsTarget - uObsCam;
      float oLen = max(length(oAxis), 1e-3);
      float oT = dot(vCutWorld - uObsCam, oAxis) / (oLen * oLen);
      if (oT > 0.0 && oT < 1.0) {
        float oD = distance(vCutWorld, uObsCam + oAxis * oT);
        float oRadial = 1.0 - smoothstep(uObsCylR - uObsCylF, uObsCylR, oD);
        float oCap = 1.0 - smoothstep(1.0 - uObsCylF / oLen, 1.0, oT);
        if (oRadial * oCap * obsCylS > cutBayer4(gl_FragCoord.xy)) discard;
      }
    }
    float obsSphS = uObsSphS * uCutMaskObsSph;
    if (obsSphS > 0.0 && uObsSphR > 0.0) {
      float oFeather = min(uObsSphF, uObsSphR);
      float oSph = 1.0 - smoothstep(uObsSphR - oFeather, uObsSphR, distance(vCutWorld, uObsCam));
      if (oSph * obsSphS > cutBayer4(gl_FragCoord.xy)) discard;
    }`;
  const fragmentTint = /* glsl */ `
    #include <color_fragment>
    // Épaisseur des murs : toute face arrière visible (mur coupé vu de l'intérieur)
    // est remplie d'une couleur de coupe unie, sans texture ni teinte de sommet.
    if (!gl_FrontFacing) diffuseColor = vec4(uCutColor, 1.0);`;

  /**
   * Abonnements : chaque matériau découpable ne réagit qu'à certaines formes (ids), ou
   * à toutes (null). Ses deux interrupteurs (cylindre, sphère) sont des uniforms propres
   * au matériau, mis à jour à chaque image selon les formes actives.
   */
  const subscribers: { only: string[] | null; cyl: { value: number }; sph: { value: number }; ocyl: { value: number }; osph: { value: number } }[] = [];
  let active: { cyl: string | null; sph: string | null; ocyl: string | null; osph: string | null } = { cyl: null, sph: null, ocyl: null, osph: null };
  /** '*' : forme du vol libre (back-office), sur tous les matériaux découpables. */
  const reacts = (only: string[] | null, id: string | null) => (only === null || id === '*' || (id !== null && only.includes(id)) ? 1 : 0);
  function refreshMasks() {
    for (const sub of subscribers) {
      sub.cyl.value = reacts(sub.only, active.cyl);
      sub.sph.value = reacts(sub.only, active.sph);
      sub.ocyl.value = reacts(sub.only, active.ocyl);
      sub.osph.value = reacts(sub.only, active.osph);
    }
  }

  /**
   * Injecte la découpe et le remplissage des faces arrière dans un matériau
   * (MeshBasicMaterial, donc sans éclairage) et le passe en DoubleSide.
   */
  function applyToMaterial(material: Material, only: string[] | null) {
    const sub = {
      only,
      cyl: { value: reacts(only, active.cyl) },
      sph: { value: reacts(only, active.sph) },
      ocyl: { value: reacts(only, active.ocyl) },
      osph: { value: reacts(only, active.osph) },
    };
    subscribers.push(sub);
    material.side = DoubleSide;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms, { uCutMaskCyl: sub.cyl, uCutMaskSph: sub.sph, uCutMaskObsCyl: sub.ocyl, uCutMaskObsSph: sub.osph });
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

  /** Rend découpables les matériaux de `root` ; `only` : ids des formes auxquelles ils réagissent (null : toutes). */
  function apply(root: Object3D, only: string[] | null = null) {
    const done = new Set<Material>();
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (done.has(m)) continue;
        done.add(m);
        applyToMaterial(m, only);
      }
    });
  }

  /**
   * Cylindre, à chaque image : de la caméra vers `target`, réglé par `preset` (null ou
   * une sphère : cylindre éteint). Intensité selon la distance caméra–cible (fondu de
   * la découpe), multipliée par `scale` (0–1 : entrée / sortie de la visite).
   */
  function update(camera: Vector3, target: Vector3, preset: CutPreset | null, scale = 1) {
    uniforms.uCutCam.value.copy(camera);
    uniforms.uCutTarget.value.copy(target);
    const cylId = preset?.kind === 'cylinder' ? preset.id : null;
    if (cylId !== active.cyl) {
      active = { ...active, cyl: cylId };
      refreshMasks();
    }
    if (!preset || preset.kind !== 'cylinder') {
      uniforms.uCutStrength.value = 0;
      return;
    }
    uniforms.uCutRadius.value = preset.radius;
    uniforms.uCutFeather.value = Math.max(preset.feather, 1e-3);
    uniforms.uCutSphere.value = preset.cameraRadius;
    const d = camera.distanceTo(target);
    // Transition progressive : 0 au-delà de fadeStartDistance, 1 en dessous de fadeEndDistance.
    uniforms.uCutStrength.value =
      MathUtils.clamp((preset.fadeStartDistance - d) / Math.max(preset.fadeStartDistance - preset.fadeEndDistance, 1e-3), 0, 1) *
      MathUtils.clamp(scale, 0, 1);
  }

  /**
   * Vue de contrôle (back-office) : découpe autour de sa caméra, indépendante de celle de
   * l'expérience. `cam` null : éteinte.
   */
  function setObserver(cam: Vector3 | null, target: Vector3 | null, cyl: CutPreset | null, sph: CutPreset | null) {
    const ocyl = cam && cyl?.kind === 'cylinder' ? cyl : null;
    const osph = cam && sph?.kind === 'sphere' ? sph : null;
    if ((ocyl?.id ?? null) !== active.ocyl || (osph?.id ?? null) !== active.osph) {
      active = { ...active, ocyl: ocyl?.id ?? null, osph: osph?.id ?? null };
      refreshMasks();
    }
    if (cam) uniforms.uObsCam.value.copy(cam);
    if (target) uniforms.uObsTarget.value.copy(target);
    if (ocyl && cam && target) {
      uniforms.uObsCylR.value = ocyl.radius;
      uniforms.uObsCylF.value = Math.max(ocyl.feather, 1e-3);
      const d = cam.distanceTo(target);
      uniforms.uObsCylS.value = MathUtils.clamp((ocyl.fadeStartDistance - d) / Math.max(ocyl.fadeStartDistance - ocyl.fadeEndDistance, 1e-3), 0, 1);
    } else uniforms.uObsCylS.value = 0;
    if (osph) {
      uniforms.uObsSphR.value = osph.radius;
      uniforms.uObsSphF.value = osph.feather;
      uniforms.uObsSphS.value = 1;
    } else uniforms.uObsSphS.value = 0;
  }

  /** Réglages modifiés à chaud (back-office). */
  function set(next: CutawayConfig) {
    cfg = structuredClone(next);
    uniforms.uCutColor.value.set(cfg.cutColor);
  }

  /** Sphère autour de la caméra : intensité (0 : éteinte, 1 : pleine), rayon, dégradé. */
  function setTransit(strength: number, radius: number, feather: number, id: string | null = active.sph) {
    if (id !== active.sph) {
      active = { ...active, sph: id };
      refreshMasks();
    }
    uniforms.uTransitStrength.value = MathUtils.clamp(strength, 0, 1);
    uniforms.uTransitRadius.value = radius;
    uniforms.uTransitFeather.value = feather;
  }

  return {
    uniforms,
    get settings(): Readonly<CutawayConfig> {
      return cfg;
    },
    apply,
    /** Diagnostic : abonnement et interrupteurs (cylindre, sphère) de chaque matériau découpable. */
    masks: () => subscribers.map((x) => ({ only: x.only, cyl: x.cyl.value, sph: x.sph.value })),
    update,
    set,
    setTransit,
    setObserver,
  };
}
