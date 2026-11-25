import { FieldLabel, type CustomField } from '@puckeditor/core';
import { useState, type CSSProperties } from 'react';
import type { MapView, Vec3 } from '../viewer/config/types';
import { useViewer } from './bridge';
import { Icon } from './icons';
import { Button, XYZ } from './tourFields';

/**
 * Champs Puck de la carte interactive : les 4 vues de face des murs (centre du
 * plan de coupe, direction du regard, cadre) avec cadrage depuis la caméra et aperçu.
 */

const row: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' };
const small: CSSProperties = { fontSize: 12, color: 'var(--bo-muted)' };

function Num({ label, value, onChange, step = 1, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="bo-mini">
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
      />
    </label>
  );
}

const KIND_LABEL: Record<MapView['kind'], string> = { plan: 'Plan · regard vers le bas', wall: 'Vue de face', ceiling: 'Plafonds · regard vers le haut' };

function MapViewsUI({ value, onChange, readOnly }: { value: MapView[]; onChange: (v: MapView[]) => void; readOnly?: boolean }) {
  const viewer = useViewer();
  const views = value ?? [];
  const set = (i: number, patch: Partial<MapView>) => onChange(views.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  /** Change l'ordre des vues (= ordre des vignettes de la carte). */
  const move = (from: number, to: number) => {
    if (to < 0 || to >= views.length || from === to) return;
    const next = [...views];
    const [v] = next.splice(from, 1);
    next.splice(to, 0, v);
    onChange(next);
  };
  const [drag, setDrag] = useState<number | null>(null);
  const addWall = () => {
    const ref = views.find((v) => v.kind === 'wall') ?? views[0];
    const wall: MapView = {
      name: `Vue ${views.filter((v) => v.kind === 'wall').length + 1}`,
      kind: 'wall',
      center: ref ? ([...ref.center] as Vec3) : [0, 100, 0],
      yaw: 0,
      width: ref?.width ?? 130,
      height: ref?.height ?? 90,
    };
    // Avant les plafonds (dernière vignette), s'ils existent.
    const at = views.findIndex((v) => v.kind === 'ceiling');
    onChange(at < 0 ? [...views, wall] : [...views.slice(0, at), wall, ...views.slice(at)]);
  };
  return (
    <FieldLabel label="Points de vue (une vignette chacun)" readOnly={readOnly}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={row}>
          <Button variant="primary" icon={<Icon.map size={15} />} disabled={!viewer} onClick={() => viewer?.map.open(0)}>
            Ouvrir la carte
          </Button>
          <Button icon={<Icon.close size={15} />} disabled={!viewer} onClick={() => viewer?.map.close()}>
            Fermer
          </Button>
        </div>
        <p style={{ ...small, margin: 0 }}>
          Chaque vue est un point : le plan de coupe y passe, perpendiculaire au regard, et tout ce qui est devant est coupé. La carte
          glisse d'un point à l'autre. Astuce : en vol libre, placez-vous au bon endroit puis « Depuis la caméra ».
        </p>
        {views.map((v, i) => (
          <div
            key={i}
            className={`bo-item${drag === i ? ' is-drag' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag !== null) move(drag, i);
              setDrag(null);
            }}
          >
            <div className="bo-item__head">
              <span className="bo-item__handle">
                <span
                  className="bo-grip"
                  draggable={!readOnly}
                  title="Glisser pour changer l'ordre"
                  onDragStart={(e) => {
                    setDrag(i);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  <Icon.grip size={16} />
                </span>
                <span className="bo-num">{i + 1}</span>
                <input className="bo-input bo-input--title" value={v.name} disabled={readOnly} aria-label="Nom de la vue" onChange={(e) => set(i, { name: e.currentTarget.value })} />
              </span>
              <span style={{ ...row, flexWrap: 'nowrap', gap: 2 }}>
                <Button variant="ghost" icon={<Icon.chevronUp size={15} />} title="Monter (vignette précédente)" disabled={readOnly || i === 0} onClick={() => move(i, i - 1)} />
                <Button variant="ghost" icon={<Icon.chevronDown size={15} />} title="Descendre (vignette suivante)" disabled={readOnly || i === views.length - 1} onClick={() => move(i, i + 1)} />
              {v.kind === 'wall' && views.filter((x) => x.kind === 'wall').length > 1 && (
                <Button variant="ghost" icon={<Icon.trash size={15} />} title="Supprimer cette vue" onClick={() => onChange(views.filter((_, j) => j !== i))} />
              )}
              </span>
            </div>
            <span style={small}>{KIND_LABEL[v.kind]}</span>
            <span style={small}>{v.kind === 'wall' ? 'Point de la vue (le plan de coupe y passe)' : 'Point de la vue · Y = hauteur de coupe'}</span>
            <XYZ value={v.center} onChange={(c: Vec3) => set(i, { center: c })} readOnly={readOnly} />
            {v.kind === 'wall' && (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={small}>Regard</span>
                  <span className="bo-slider" style={{ flex: 1, display: 'flex' }}>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={0.5}
                      value={v.yaw}
                      aria-label="Direction du regard"
                      disabled={readOnly}
                      onChange={(e) => set(i, { yaw: Number(e.currentTarget.value) })}
                      style={{ ['--bo-fill' as string]: `${((v.yaw + 180) / 360) * 100}%` }}
                    />
                  </span>
                  <Num label="°" value={v.yaw} step={0.5} onChange={(yaw) => set(i, { yaw })} />
                </div>
                <div style={row}>
                  <Num label="Largeur (m)" value={v.width} min={1} onChange={(width) => set(i, { width: Math.max(width, 1) })} />
                  <Num label="Hauteur (m)" value={v.height} min={1} onChange={(height) => set(i, { height: Math.max(height, 1) })} />
                </div>
              </>
            )}
            <div style={row}>
              <Button
                variant="primary"
                icon={<Icon.camera size={15} />}
                disabled={!viewer || readOnly}
                title={v.kind === 'wall' ? 'Point = position de la caméra, regard = sa direction (horizontale)' : 'Point = position de la caméra (sa hauteur = hauteur de coupe)'}
                onClick={() => {
                  const f = viewer!.map.frameFromCamera();
                  set(i, v.kind === 'wall' ? { center: f.center, yaw: f.yaw } : { center: f.center });
                }}
              >
                Depuis la caméra
              </Button>
              <Button icon={<Icon.eye size={15} />} disabled={!viewer} onClick={() => viewer?.map.open(i)}>
                Aperçu
              </Button>
            </div>
          </div>
        ))}
        <Button variant="dashed" icon={<Icon.plus size={15} />} disabled={readOnly} onClick={addWall}>
          Ajouter une vue de face
        </Button>
      </div>
    </FieldLabel>
  );
}

export const mapViewsField: CustomField<MapView[]> = {
  type: 'custom',
  label: 'Points de vue',
  render: ({ value, onChange, readOnly }) => <MapViewsUI value={value} onChange={onChange} readOnly={readOnly} />,
};
