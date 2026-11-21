import { FieldGroup, FieldTab, Puck, type Config, type Data } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
import { useEffect, useRef, useState } from 'react';
import { createViewer, type Viewer } from '../viewer';
import { defaultConfig, type TourConfig, type Vec3 } from '../viewer/config/types';
import { newWorkId, uniqueSlugs } from '../viewer/tour/slug';
import { bridge } from './bridge';
import { checkbox, colorField, slider } from './fields';
import { cameraPointsField, pointField, previewField } from './tourFields';

/**
 * Back-office Puck : réglages de scène (hauteur du focus, découpe) avec aperçu
 * 3D en direct. « Publier » écrit les valeurs dans src/viewer/config/scene.json
 * via l'API de dev (integrations/scene-config-api.ts).
 */

type SceneProps = {
  focusHeightOffset: number;
  cutRadius: number;
  cutFeather: number;
  cutFadeStart: number;
  cutFadeEnd: number;
  cutColor: string;
  mistStart: number;
  mistEnd: number;
  mistColor: string;
  clayHue: number;
  claySaturation: number;
  clayContrast: number;
  clayBrightness: number;
  clayGamma: number;
  dofEnabled: boolean;
  dofAutoFocus: boolean;
  dofFocusDistance: number;
  dofFocusRange: number;
  dofAperture: number;
  dofMaxBlur: number;
  // Visite guidée (durées en secondes dans Puck, en ms dans scene.json).
  tourEnterS: number;
  tourBetweenS: number;
  tourExitS: number;
  tourSegmentS: number;
  tourCutFadeStart: number;
  tourResumeS: number;
  tourHub: Vec3;
  tourWorks: TourWorkItem[];
  // Debug (non enregistré).
  flyEnabled: boolean;
  flySpeed: number;
  showTourHelpers: boolean;
};

/** Œuvre telle qu'éditée dans Puck (le slug est recalculé à la publication). */
type TourWorkItem = {
  id: string;
  title: string;
  focus: Vec3;
  cameraPoints: Vec3[];
  content?: Record<string, unknown>;
};

const SCENE_KEYS = [
  'focusHeightOffset',
  'cutRadius',
  'cutFeather',
  'cutFadeStart',
  'cutFadeEnd',
  'cutColor',
  'mistStart',
  'mistEnd',
  'mistColor',
  'clayHue',
  'claySaturation',
  'clayContrast',
  'clayBrightness',
  'clayGamma',
  'dofEnabled',
  'dofAutoFocus',
  'dofFocusDistance',
  'dofFocusRange',
  'dofAperture',
  'dofMaxBlur',
  'tourEnterS',
  'tourBetweenS',
  'tourExitS',
  'tourSegmentS',
  'tourCutFadeStart',
  'tourResumeS',
  'tourHub',
  'tourWorks',
  'flyEnabled',
  'flySpeed',
  'showTourHelpers',
] as const satisfies readonly (keyof SceneProps)[];

/** Extrait nos réglages des props Puck (qui contiennent aussi puck, id, children…). */
function pickSceneProps(props: Record<string, unknown>): SceneProps {
  return Object.fromEntries(SCENE_KEYS.map((k) => [k, props[k]])) as SceneProps;
}

/** Réglage colorimétrique commun aux maquettes clay (ville, Panthéon, sol). */
function clayPatch(p: SceneProps) {
  return {
    hue: p.clayHue,
    saturation: p.claySaturation,
    contrast: p.clayContrast,
    brightness: p.clayBrightness,
    gamma: p.clayGamma,
  };
}

/** Flou de profondeur de champ. */
function dofPatch(p: SceneProps) {
  return {
    enabled: p.dofEnabled,
    autoFocus: p.dofAutoFocus,
    focusDistance: p.dofFocusDistance,
    focusRange: p.dofFocusRange,
    aperture: p.dofAperture,
    maxBlur: p.dofMaxBlur,
  };
}

/** Données de la visite au format de scene.json (slugs dérivés des titres, uniques). */
function tourFromProps(p: SceneProps): TourConfig {
  const works = p.tourWorks ?? [];
  const slugs = uniqueSlugs(works.map((w) => w.title ?? ''));
  return {
    durations: {
      enterMs: Math.round(p.tourEnterS * 1000),
      betweenMs: Math.round(p.tourBetweenS * 1000),
      exitMs: Math.round(p.tourExitS * 1000),
      segmentMs: Math.round(p.tourSegmentS * 1000),
    },
    cutFadeStart: p.tourCutFadeStart,
    resumeDelayMs: Math.round(p.tourResumeS * 1000),
    hub: { position: p.tourHub },
    works: works.map((w, i) => ({
      id: w.id || `w-sans-id-${i}`,
      title: w.title ?? '',
      slug: slugs[i],
      focus: w.focus ?? p.tourHub,
      cameraPoints: w.cameraPoints ?? [],
      content: w.content ?? {},
    })),
  };
}

/** Aperçu 3D : le viewer est créé une fois, puis piloté à chaud par les props. */
function ViewerPreview(props: SceneProps) {
  const el = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const apply = (v: Viewer, p: SceneProps) => {
    v.setFocusHeightOffset(p.focusHeightOffset);
    v.setCutaway({
      radius: p.cutRadius,
      feather: p.cutFeather,
      fadeStartDistance: p.cutFadeStart,
      fadeEndDistance: p.cutFadeEnd,
      cutColor: p.cutColor,
    });
    v.setMist({ startDistance: p.mistStart, endDistance: p.mistEnd, color: p.mistColor });
    v.setClay(clayPatch(p));
    v.setDof(dofPatch(p));
    const tour = tourFromProps(p);
    v.setTour(tour);
    v.editor?.setHelpers(tour, p.showTourHelpers);
    v.editor?.setFly(p.flyEnabled, p.flySpeed);
  };

  useEffect(() => {
    let disposed = false;
    createViewer(el.current!, { skipIntro: true, debug: true, urlHash: false, editor: true }).then((v) => {
      if (disposed) return v.dispose();
      viewer.current = v;
      apply(v, latest.current);
      bridge.setViewer(v);
    });
    return () => {
      disposed = true;
      if (bridge.viewer === viewer.current) bridge.setViewer(null);
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    if (viewer.current) apply(viewer.current, props);
  }, [props]);

  return <div ref={el} className="pantheon-viewer" style={{ height: 'calc(100vh - 140px)', minHeight: 360 }} />;
}

const config: Config<{}, Record<string, unknown>> = {
  components: {},
  root: {
    fields: {
      focusHeightOffset: slider('Hauteur du focus / centre bbox', -40, 60, 0.5),
      cutRadius: slider('Rayon de découpe', 5, 200, 1),
      cutFeather: slider('Dégradé du bord', 0, 15, 0.5),
      cutFadeStart: slider('Début du fondu (distance)', 20, 800, 5),
      cutFadeEnd: slider('Fin du fondu (distance)', 10, 800, 5),
      cutColor: colorField('Couleur de coupe (épaisseur des murs)'),
      mistStart: slider('Brume — début (distance au Panthéon)', 0, 3000, 10),
      mistEnd: slider('Brume — fin (distance au Panthéon)', 0, 3000, 10),
      mistColor: colorField('Brume — couleur'),
      clayHue: slider('Clay — teinte', -180, 180, 1, '°'),
      claySaturation: slider('Clay — saturation', 0, 2, 0.01, null),
      clayContrast: slider('Clay — contraste', 0, 2, 0.01, null),
      clayBrightness: slider('Clay — luminosité', -0.5, 0.5, 0.01, null),
      clayGamma: slider('Clay — gamma', 0.2, 3, 0.01, null),
      dofEnabled: checkbox('Flou de profondeur — activé'),
      dofAutoFocus: checkbox('Flou — mise au point auto sur le Panthéon'),
      dofFocusDistance: slider('Flou — distance de mise au point (si auto décoché)', 5, 1500, 5),
      dofFocusRange: slider('Flou — profondeur de la zone nette', 0, 300, 1),
      dofAperture: slider('Flou — ouverture (intensité)', 0, 10, 0.1, null),
      dofMaxBlur: slider('Flou — rayon maximal', 0, 30, 0.5, 'px'),
      tourEnterS: slider('Entrée (orbite → première œuvre)', 0.5, 15, 0.1, 's'),
      tourBetweenS: slider('Entre deux œuvres', 0.5, 15, 0.1, 's'),
      tourExitS: slider('Sortie (retour à l’orbite)', 0.5, 15, 0.1, 's'),
      tourSegmentS: slider('Parcours sur l’œuvre, par segment', 1, 30, 0.5, 's'),
      tourCutFadeStart: slider('Extinction de la découpe à l’entrée (fraction du trajet)', 0.3, 0.98, 0.01, null),
      tourResumeS: slider('Reprise après une rotation manuelle', 1, 20, 0.5, 's'),
      tourHub: pointField('Point central (passage entre deux œuvres)', { key: () => 'hub', pick: true, capture: true }),
      tourWorks: {
        type: 'array',
        label: 'Œuvres (glisser pour réordonner)',
        arrayFields: {
          title: { type: 'text', label: 'Titre' },
          focus: pointField('Point de focus', { key: (name) => `focus:${/(\d+)/.exec(name)?.[1]}`, pick: true, capture: true }),
          cameraPoints: cameraPointsField,
          preview: previewField,
        },
        defaultItemProps: (index: number) => ({
          id: newWorkId(),
          title: `Œuvre ${index + 1}`,
          focus: [...defaultConfig.tour.hub.position] as Vec3,
          cameraPoints: [],
          content: {},
        }),
        getItemSummary: (item: TourWorkItem, index?: number) => item.title || `Œuvre ${(index ?? 0) + 1}`,
      },
      flyEnabled: checkbox('Vol libre (ZQSD + clic droit, A/E : bas/haut, Maj : vite)'),
      flySpeed: slider('Vitesse du vol libre (molette)', 0.2, 30, 0.1, 'm/s'),
      showTourHelpers: checkbox('Afficher les repères de la visite'),
    },
    // Réglages rangés par onglets (Puck FieldTab) ; les clés et le JSON sont inchangés.
    renderFields: ({ fields }) => (
      <>
        <FieldTab label="Scène">
          <FieldGroup label="Brume" defaultExpanded>
            {fields.mistStart}
            {fields.mistEnd}
            {fields.mistColor}
          </FieldGroup>
          <FieldGroup label="Couleur des maquettes (clay)" defaultExpanded>
            {fields.clayHue}
            {fields.claySaturation}
            {fields.clayContrast}
            {fields.clayBrightness}
            {fields.clayGamma}
          </FieldGroup>
          <FieldGroup label="Flou de profondeur de champ" defaultExpanded>
            {fields.dofEnabled}
            {fields.dofAutoFocus}
            {fields.dofFocusDistance}
            {fields.dofFocusRange}
            {fields.dofAperture}
            {fields.dofMaxBlur}
          </FieldGroup>
        </FieldTab>
        <FieldTab label="Caméra orbitale">{fields.focusHeightOffset}</FieldTab>
        <FieldTab label="Découpe">
          {fields.cutRadius}
          {fields.cutFeather}
          {fields.cutFadeStart}
          {fields.cutFadeEnd}
          {fields.cutColor}
        </FieldTab>
        <FieldTab label="Visite guidée">
          <FieldGroup label="Œuvres" defaultExpanded>
            {fields.tourWorks}
          </FieldGroup>
          <FieldGroup label="Point central" defaultExpanded>
            {fields.tourHub}
          </FieldGroup>
          <FieldGroup label="Durées et comportement" defaultExpanded>
            {fields.tourEnterS}
            {fields.tourBetweenS}
            {fields.tourExitS}
            {fields.tourSegmentS}
            {fields.tourCutFadeStart}
            {fields.tourResumeS}
          </FieldGroup>
        </FieldTab>
        <FieldTab label="Debug">
          {fields.flyEnabled}
          {fields.flySpeed}
          {fields.showTourHelpers}
        </FieldTab>
      </>
    ),
    render: (props: Record<string, unknown>) => <ViewerPreview {...pickSceneProps(props)} />,
  },
};

const { focus, cutaway, mist, clay, dof, tour } = defaultConfig;
const initialData: Data<{}, Record<string, unknown>> = {
  root: {
    props: {
      focusHeightOffset: focus.heightOffset,
      cutRadius: cutaway.radius,
      cutFeather: cutaway.feather,
      cutFadeStart: cutaway.fadeStartDistance,
      cutFadeEnd: cutaway.fadeEndDistance,
      cutColor: cutaway.cutColor,
      mistStart: mist.startDistance,
      mistEnd: mist.endDistance,
      mistColor: mist.color,
      clayHue: clay.hue,
      claySaturation: clay.saturation,
      clayContrast: clay.contrast,
      clayBrightness: clay.brightness,
      clayGamma: clay.gamma,
      dofEnabled: dof.enabled,
      dofAutoFocus: dof.autoFocus,
      dofFocusDistance: dof.focusDistance,
      dofFocusRange: dof.focusRange,
      dofAperture: dof.aperture,
      dofMaxBlur: dof.maxBlur,
      tourEnterS: tour.durations.enterMs / 1000,
      tourBetweenS: tour.durations.betweenMs / 1000,
      tourExitS: tour.durations.exitMs / 1000,
      tourSegmentS: tour.durations.segmentMs / 1000,
      tourCutFadeStart: tour.cutFadeStart,
      tourResumeS: tour.resumeDelayMs / 1000,
      tourHub: tour.hub.position,
      tourWorks: tour.works.map(({ id, title, focus, cameraPoints, content }) => ({ id, title, focus, cameraPoints, content })),
      flyEnabled: false,
      flySpeed: 3,
      showTourHelpers: true,
    },
  },
  content: [],
};

export default function SceneEditor() {
  const [status, setStatus] = useState<string | null>(null);

  async function publish(data: Data<{}, Record<string, unknown>>) {
    const p = pickSceneProps(data.root.props ?? {});
    setStatus('Enregistrement…');
    try {
      const res = await fetch('/__admin/scene-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          focus: { heightOffset: p.focusHeightOffset },
          cutaway: {
            radius: p.cutRadius,
            feather: p.cutFeather,
            fadeStartDistance: p.cutFadeStart,
            fadeEndDistance: p.cutFadeEnd,
            cutColor: p.cutColor,
          },
          mist: { startDistance: p.mistStart, endDistance: p.mistEnd, color: p.mistColor },
          clay: clayPatch(p),
          dof: dofPatch(p),
          tour: tourFromProps(p),
        }),
      });
      const json = await res.json().catch(() => ({}));
      setStatus(res.ok ? 'Enregistré dans scene.json' : `Erreur : ${json.error ?? res.status}`);
    } catch (err) {
      setStatus(`Erreur : ${err instanceof Error ? err.message : String(err)} (serveur de dev lancé ?)`);
    }
  }

  return (
    <>
      <Puck
        config={config}
        data={initialData}
        onPublish={publish}
        headerTitle="Panthéon — réglages de scène"
        iframe={{ enabled: false }}
      />
      {status && (
        <div role="status" className="admin-status">
          {status}
        </div>
      )}
    </>
  );
}
