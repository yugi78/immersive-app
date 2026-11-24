import { FieldLabel, type CustomField } from '@puckeditor/core';
import type { CSSProperties } from 'react';
import type { MapView, Vec3 } from '../viewer/config/types';
import { useViewer } from './bridge';
import { Button, XYZ } from './tourFields';

/**
 * Champs Puck de la carte interactive : les 4 vues de face des murs (centre du
 * plan de coupe, direction du regard, cadre) avec cadrage depuis la caméra et aperçu.
 */

const row: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' };
const card: CSSProperties = { display: 'grid', gap: 6, padding: 8, border: '1px solid #dfe3e8', borderRadius: 6, background: '#fafbfc' };
const small: CSSProperties = { font: '11px system-ui', color: '#5c6370' };

function Num({ label, value, onChange, step = 1, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, font: '11px system-ui' }}>
      {label}
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{ width: 64 }}
      />
    </label>
  );
}

function MapViewsUI({ value, onChange, readOnly }: { value: MapView[]; onChange: (v: MapView[]) => void; readOnly?: boolean }) {
  const viewer = useViewer();
  const views = value ?? [];
  const set = (i: number, patch: Partial<MapView>) => onChange(views.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <FieldLabel label="Vues de face des murs (vignettes 2 à 5)" readOnly={readOnly}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={row}>
          <Button disabled={!viewer} onClick={() => viewer?.map.open(0)}>
            Aperçu du plan
          </Button>
          <Button disabled={!viewer} onClick={() => viewer?.map.close()}>
            Fermer la carte
          </Button>
        </div>
        <p style={{ ...small, margin: 0 }}>
          Astuce : en vol libre (onglet Debug), placez-vous face au mur, puis « Cadrer depuis la caméra » : le plan de coupe passe par
          la caméra et tout ce qui est devant est coupé.
        </p>
        {views.map((v, i) => (
          <div key={i} style={card}>
            <input value={v.name} disabled={readOnly} onChange={(e) => set(i, { name: e.currentTarget.value })} style={{ font: '600 12px system-ui' }} />
            <span style={small}>Centre du plan de coupe (x, y, z)</span>
            <XYZ value={v.center} onChange={(c: Vec3) => set(i, { center: c })} readOnly={readOnly} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={small}>Regard</span>
              <input type="range" min={-180} max={180} step={0.5} value={v.yaw} disabled={readOnly} onChange={(e) => set(i, { yaw: Number(e.currentTarget.value) })} style={{ flex: 1 }} />
              <Num label="°" value={v.yaw} step={0.5} onChange={(yaw) => set(i, { yaw })} />
            </div>
            <div style={row}>
              <Num label="Largeur (m)" value={v.width} min={1} onChange={(width) => set(i, { width: Math.max(width, 1) })} />
              <Num label="Hauteur (m)" value={v.height} min={1} onChange={(height) => set(i, { height: Math.max(height, 1) })} />
            </div>
            <div style={row}>
              <Button
                disabled={!viewer || readOnly}
                title="Centre = position de la caméra, regard = sa direction (horizontale)"
                onClick={() => {
                  const f = viewer!.map.frameFromCamera();
                  set(i, { center: f.center, yaw: f.yaw });
                }}
              >
                Cadrer depuis la caméra
              </Button>
              <Button disabled={!viewer} onClick={() => viewer?.map.open(i + 1)}>
                Aperçu
              </Button>
            </div>
          </div>
        ))}
      </div>
    </FieldLabel>
  );
}

export const mapViewsField: CustomField<MapView[]> = {
  type: 'custom',
  label: 'Vues de face',
  render: ({ value, onChange, readOnly }) => <MapViewsUI value={value} onChange={onChange} readOnly={readOnly} />,
};
