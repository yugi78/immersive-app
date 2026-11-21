import { FieldLabel, type CustomField } from '@puckeditor/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Vec3 } from '../viewer/config/types';
import { bridge, useGizmoKey, useViewer } from './bridge';

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

/** Bouton « Gizmo » : attache le repère `key` au gizmo ; les déplacements appellent onMove. */
function GizmoButton({ markerKey, onMove }: { markerKey: string; onMove: (v: Vec3) => void }) {
  const viewer = useViewer();
  const active = useGizmoKey() === markerKey;
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  // Détache le gizmo si le champ disparaît (œuvre repliée, point supprimé).
  useEffect(() => () => {
    if (bridge.gizmoKey === markerKey) {
      bridge.viewer?.editor?.detachGizmo(markerKey);
      bridge.setGizmoKey(null);
    }
  }, [markerKey]);
  return (
    <Button
      on={active}
      disabled={!viewer?.editor}
      title="Déplacer ce point dans la vue 3D"
      onClick={() => {
        const ed = viewer?.editor;
        if (!ed) return;
        if (active) {
          ed.detachGizmo();
          bridge.setGizmoKey(null);
        } else if (ed.attachGizmo(markerKey, (v) => moveRef.current(v))) {
          bridge.setGizmoKey(markerKey);
        }
      }}
    >
      Gizmo
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

function PreviewUI({ name }: { name: string }) {
  const viewer = useViewer();
  const i = workIndex(name);
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
