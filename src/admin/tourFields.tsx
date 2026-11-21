import { FieldLabel, type CustomField } from '@puckeditor/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { TourBounds, Vec3 } from '../viewer/config/types';
import { bridge, useBoundsWork, useGizmoKey, useViewer } from './bridge';

/**
 * Champs Puck de la visite guidée : point XYZ (pointage, capture, gizmo),
 * liste de points caméra réordonnable, boutons d'aperçu.
 */

/** Index de l'œuvre dans la liste, lu dans le nom du champ Puck (« tourWorks[2].focus »). */
export const workIndex = (name: string) => Number(/(\d+)/.exec(name)?.[1] ?? -1);

const btn: CSSProperties = {
  padding: '4px 8px',
  font: '12px system-ui, sans-serif',
  border: '1px solid #c9ced6',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
};
const btnOn: CSSProperties = { ...btn, background: '#1c7ed6', borderColor: '#1c7ed6', color: '#fff' };
const row: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' };

function Button({ on, children, ...p }: { on?: boolean; children: ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button type="button" style={{ ...(on ? btnOn : btn), opacity: p.disabled ? 0.5 : 1 }} {...p}>
      {children}
    </button>
  );
}

/** Trois saisies x / y / z. */
function XYZ({ value, onChange, readOnly }: { value: Vec3; onChange: (v: Vec3) => void; readOnly?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
      {(['x', 'y', 'z'] as const).map((axis, k) => (
        <label key={axis} style={{ display: 'flex', alignItems: 'center', gap: 2, font: '11px system-ui' }}>
          {axis}
          <input
            type="number"
            step={0.1}
            value={value?.[k] ?? 0}
            disabled={readOnly}
            onChange={(e) => {
              const n = Number(e.currentTarget.value);
              if (!Number.isFinite(n)) return;
              const next = [...(value ?? [0, 0, 0])] as Vec3;
              next[k] = n;
              onChange(next);
            }}
            style={{ width: '100%', minWidth: 0 }}
          />
        </label>
      ))}
    </div>
  );
}

/**
 * Bouton « Gizmo » : attache le repère `markerKey` au gizmo ; les déplacements
 * appellent onMove. Avec `onRotate` : gizmo de rotation autour de la verticale.
 */
function GizmoButton({
  markerKey,
  onMove,
  onRotate,
  label = 'Gizmo',
}: {
  markerKey: string;
  onMove?: (v: Vec3) => void;
  onRotate?: (deg: number) => void;
  label?: string;
}) {
  const viewer = useViewer();
  const id = `${markerKey}|${onRotate ? 'rotate' : 'move'}`;
  const active = useGizmoKey() === id;
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const rotRef = useRef(onRotate);
  rotRef.current = onRotate;
  // Détache le gizmo si le champ disparaît (œuvre repliée, point supprimé).
  useEffect(
    () => () => {
      if (bridge.gizmoKey === id) {
        bridge.viewer?.editor?.detachGizmo(markerKey);
        bridge.setGizmoKey(null);
      }
    },
    [id, markerKey],
  );
  return (
    <Button
      on={active}
      disabled={!viewer?.editor}
      title={onRotate ? 'Tourner dans la vue 3D (autour de la verticale)' : 'Déplacer dans la vue 3D'}
      onClick={() => {
        const ed = viewer?.editor;
        if (!ed) return;
        if (active) {
          ed.detachGizmo();
          bridge.setGizmoKey(null);
          return;
        }
        const ok = ed.attachGizmo(markerKey, (v) => moveRef.current?.(v), onRotate ? { rotate: (d) => rotRef.current?.(d) } : {});
        if (ok) bridge.setGizmoKey(id);
      }}
    >
      {label}
    </Button>
  );
}

function PointUI(props: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  markerKey: string;
  pick?: boolean;
  capture?: boolean;
  readOnly?: boolean;
}) {
  const viewer = useViewer();
  const [picking, setPicking] = useState(false);
  return (
    <FieldLabel label={props.label} readOnly={props.readOnly}>
      <div style={{ display: 'grid', gap: 6 }}>
        <XYZ value={props.value} onChange={props.onChange} readOnly={props.readOnly} />
        <div style={row}>
          {props.pick && (
            <Button
              on={picking}
              disabled={!viewer?.editor}
              title="Cliquer ensuite sur le scan dans la vue 3D (Échap : annuler)"
              onClick={async () => {
                setPicking(true);
                const p = await viewer!.editor!.pick();
                setPicking(false);
                if (p) props.onChange(p);
              }}
            >
              {picking ? 'Cliquez sur le scan…' : 'Pointer sur le scan'}
            </Button>
          )}
          {props.capture && (
            <Button disabled={!viewer?.editor} onClick={() => props.onChange(viewer!.editor!.capture())}>
              Capturer la caméra
            </Button>
          )}
          <GizmoButton markerKey={props.markerKey} onMove={props.onChange} />
        </div>
      </div>
    </FieldLabel>
  );
}

/** Champ point XYZ. `key` : repère 3D correspondant (« hub », « focus:2 »…). */
export function pointField(label: string, opts: { key: (name: string) => string; pick?: boolean; capture?: boolean }): CustomField<Vec3> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly, name }) => (
      <PointUI label={label} value={value} onChange={onChange} readOnly={readOnly} markerKey={opts.key(name)} pick={opts.pick} capture={opts.capture} />
    ),
  };
}

function CameraPointsUI({ value, onChange, name, readOnly }: { value: Vec3[]; onChange: (v: Vec3[]) => void; name: string; readOnly?: boolean }) {
  const viewer = useViewer();
  const points = value ?? [];
  const work = workIndex(name);
  const [drag, setDrag] = useState<number | null>(null);
  const latest = useRef(points);
  latest.current = points;

  const set = (j: number, v: Vec3) => onChange(latest.current.map((p, k) => (k === j ? v : p)));
  const move = (from: number, to: number) => {
    const next = [...points];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    // Le gizmo suit l'ordre des points : on le détache pour éviter un mauvais repère.
    viewer?.editor?.detachGizmo();
    bridge.setGizmoKey(null);
    onChange(next);
  };

  return (
    <FieldLabel label="Points caméra (parcours aller-retour)" readOnly={readOnly}>
      <div style={{ display: 'grid', gap: 6 }}>
        {points.map((p, j) => (
          <div
            key={j}
            draggable={!readOnly}
            onDragStart={(e) => {
              setDrag(j);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null && drag !== j) move(drag, j);
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
            style={{
              display: 'grid',
              gap: 4,
              padding: 6,
              border: '1px solid #e1e4e8',
              borderRadius: 4,
              background: drag === j ? '#e7f1fb' : '#fafbfc',
            }}
          >
            <div style={{ ...row, justifyContent: 'space-between' }}>
              <span style={{ cursor: 'grab', font: '600 12px system-ui' }} title="Glisser pour réordonner">
                ⠿ Point {j + 1}
              </span>
              <span style={row}>
                <GizmoButton markerKey={`cam:${work}:${j}`} onMove={(v) => set(j, v)} />
                <Button
                  disabled={!viewer?.editor}
                  title="Remplacer par la position actuelle de la caméra"
                  onClick={() => set(j, viewer!.editor!.capture())}
                >
                  ⟳
                </Button>
                <Button title="Supprimer ce point" onClick={() => onChange(points.filter((_, k) => k !== j))}>
                  ✕
                </Button>
              </span>
            </div>
            <XYZ value={p} onChange={(v) => set(j, v)} readOnly={readOnly} />
          </div>
        ))}
        <Button disabled={!viewer?.editor} onClick={() => onChange([...points, viewer!.editor!.capture()])}>
          + Capturer la position actuelle
        </Button>
      </div>
    </FieldLabel>
  );
}

export const cameraPointsField: CustomField<Vec3[]> = {
  type: 'custom',
  label: 'Points caméra',
  render: (p) => <CameraPointsUI value={p.value} onChange={p.onChange} name={p.name} readOnly={p.readOnly} />,
};

type Bounds = TourBounds;

function BoundsUI({ value, onChange, name, readOnly }: { value: Bounds | null; onChange: (v: Bounds | null) => void; name: string; readOnly?: boolean }) {
  const viewer = useViewer();
  const ed = viewer?.editor;
  const work = workIndex(name);
  const editing = useBoundsWork() === work;
  const latest = useRef(onChange);
  latest.current = onChange;
  const boxKey = `bounds:${work}`;
  const setEditing = (on: boolean) => {
    if (!ed) return;
    bridge.setBoundsWork(on ? work : null);
    if (on) ed.editBounds(work, (b) => latest.current(b));
    else ed.editBounds(null);
  };
  // Poignées masquées si l'œuvre est repliée (champ démonté).
  useEffect(
    () => () => {
      if (bridge.boundsWork === work) {
        bridge.viewer?.editor?.editBounds(null);
        bridge.setBoundsWork(null);
      }
    },
    [work],
  );

  const label = 'Zone permise à la caméra (prise en main)';
  if (!value) {
    return (
      <FieldLabel label={label} readOnly={readOnly}>
        <div style={{ display: 'grid', gap: 6, font: '12px system-ui', color: '#59606b' }}>
          Aucune limite : l'orbite autour du focus peut traverser les murs.
          <Button
            disabled={!ed}
            onClick={() => {
              const b = ed!.suggestBounds(work);
              if (b) {
                onChange(b);
                setEditing(true);
              }
            }}
          >
            Définir la boîte (autour des points)
          </Button>
        </div>
      </FieldLabel>
    );
  }
  const small: CSSProperties = { font: '11px system-ui', color: '#59606b' };
  return (
    <FieldLabel label={label} readOnly={readOnly}>
      <div style={{ display: 'grid', gap: 6 }}>
        <span style={small}>Centre</span>
        <XYZ value={value.center} onChange={(center) => onChange({ ...value, center })} readOnly={readOnly} />
        <span style={small}>Dimensions (m)</span>
        <XYZ value={value.size} onChange={(size) => onChange({ ...value, size: size.map((v) => Math.max(v, 0.2)) as Vec3 })} readOnly={readOnly} />
        <label style={{ ...row, ...small }}>
          Rotation (°)
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={value.rotationY ?? 0}
            disabled={readOnly}
            onChange={(e) => onChange({ ...value, rotationY: Number(e.currentTarget.value) })}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            step={1}
            value={value.rotationY ?? 0}
            disabled={readOnly}
            onChange={(e) => {
              const n = Number(e.currentTarget.value);
              if (Number.isFinite(n)) onChange({ ...value, rotationY: n });
            }}
            style={{ width: 56 }}
          />
        </label>
        <div style={row}>
          <Button on={editing} disabled={!ed} title="Poignées sur les faces : glisser pour déplacer chaque face" onClick={() => setEditing(!editing)}>
            Poignées
          </Button>
          <GizmoButton markerKey={boxKey} label="Déplacer" onMove={(center) => onChange({ ...value, center })} />
          <GizmoButton markerKey={boxKey} label="Tourner" onRotate={(rotationY) => onChange({ ...value, rotationY })} />
          <Button disabled={!ed} title="Recalculer autour du focus et des points caméra" onClick={() => onChange(ed!.suggestBounds(work))}>
            Ajuster aux points
          </Button>
          <Button
            title="Supprimer la limite"
            onClick={() => {
              setEditing(false);
              onChange(null);
            }}
          >
            ✕
          </Button>
        </div>
      </div>
    </FieldLabel>
  );
}

/** Boîte limitant la caméra quand l'utilisateur prend la main sur l'œuvre. */
export const boundsField: CustomField<Bounds | null> = {
  type: 'custom',
  label: 'Zone permise à la caméra',
  render: (p) => <BoundsUI value={p.value} onChange={p.onChange} name={p.name} readOnly={p.readOnly} />,
};

function PreviewUI({ name }: { name: string }) {
  const viewer = useViewer();
  const i = workIndex(name);
  // Champs montés = œuvre dépliée : ses points, son tracé et sa boîte s'affichent.
  useEffect(() => bridge.openWork(i), [i]);
  const ed = viewer?.editor;
  return (
    <FieldLabel label="Aperçu">
      <div style={row}>
        <Button disabled={!ed} onClick={() => ed!.previewWork(i)}>
          ▶ Parcours
        </Button>
        <Button disabled={!ed || i < 1} title="Depuis l'œuvre précédente, via le point central" onClick={() => ed!.previewTransition(i - 1, i)}>
          ▶ Transition depuis la précédente
        </Button>
        <Button disabled={!ed} onClick={() => ed!.stopPreview()}>
          ■ Arrêter
        </Button>
      </div>
    </FieldLabel>
  );
}

/** Boutons d'aperçu d'une œuvre (aucune valeur enregistrée). */
export const previewField: CustomField<null> = {
  type: 'custom',
  label: 'Aperçu',
  render: ({ name }) => <PreviewUI name={name} />,
};

function FocusOffsetUI({ value, onChange, readOnly }: { value: Vec3; onChange: (v: Vec3) => void; readOnly?: boolean }) {
  const viewer = useViewer();
  const c = viewer?.reference.center;
  return (
    <FieldLabel label="Point de focus (décalage depuis le centre de la bbox, m)" readOnly={readOnly}>
      <div style={{ display: 'grid', gap: 6 }}>
        <XYZ value={value} onChange={onChange} readOnly={readOnly} />
        <div style={row}>
          <GizmoButton
            markerKey="orbitFocus"
            onMove={(p) => c && onChange(p.map((v, k) => Math.round((v - c.getComponent(k)) * 100) / 100) as Vec3)}
          />
          <Button onClick={() => onChange([0, value?.[1] ?? 0, 0])} title="Recentrer horizontalement sur la bbox">
            Recentrer X/Z
          </Button>
        </div>
      </div>
    </FieldLabel>
  );
}

/** Décalage du point de focus de l'orbite : [x, hauteur, z]. */
export const focusOffsetField: CustomField<Vec3> = {
  type: 'custom',
  label: 'Point de focus',
  render: (p) => <FocusOffsetUI value={p.value} onChange={p.onChange} readOnly={p.readOnly} />,
};
